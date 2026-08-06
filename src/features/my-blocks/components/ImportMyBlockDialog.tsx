"use client";

// ---------------------------------------------------------------------------
// ImportMyBlockDialog — import `.buildora-block.json` or `.buildora-blocks.json`
//
// Steps: choose file → validate → review items → choose all/selected →
// optional collection → import → summary (imported / renamed / skipped /
// failed). No silent failures: every item reports its outcome. Raw file
// content is never rendered.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { ensureThumbnailForSavedRecord } from "../thumbnails/my-block-thumbnail-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import {
  importBlocksFile,
  parseBlocksFileJson,
  type BulkImportSummary,
} from "../services/my-block-file";
import type { MyBlockCollection } from "../types";
import {
  MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES,
  type BuildoraBlocksFile,
} from "../schemas/my-block-schema";

type ImportPhase = "choose" | "review" | "importing" | "summary";

interface ReviewItem {
  index: number;
  name: string;
  category: string;
  blockCount: number;
  warningCount: number;
  duplicate: boolean;
}

export function ImportMyBlockDialog() {
  const open = useMyBlocksUiStore((s) => s.importOpen);
  const close = useMyBlocksUiStore((s) => s.closeImport);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [phase, setPhase] = useState<ImportPhase>("choose");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<BuildoraBlocksFile | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [collections, setCollections] = useState<MyBlockCollection[]>([]);
  const [targetCollectionId, setTargetCollectionId] = useState<string>("");
  const [summary, setSummary] = useState<BulkImportSummary | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Reset when opened.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPhase("choose");
      setFileName(null);
      setError(null);
      setFile(null);
      setItems([]);
      setSelectedIndexes(new Set());
      setTargetCollectionId("");
      setSummary(null);
    }
  }

  // Focus + Escape.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "importing") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", onKey);
      prevFocusRef.current?.focus?.();
      prevFocusRef.current = null;
    };
  }, [open, phase, close]);

  const handleFile = useCallback(
    async (fileEntry: File | undefined) => {
      if (!fileEntry) return;
      setError(null);
      setFileName(fileEntry.name);
      if (fileEntry.size > MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES) {
        setError(
          `This file is too large to import (${Math.ceil(fileEntry.size / 1024)} KB, the limit is ${Math.ceil(MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES / 1024)} KB).`,
        );
        return;
      }
      setPhase("importing");
      try {
        const text = await fileEntry.text();
        const parsed = parseBlocksFileJson(text);
        if (!parsed.ok) {
          setError(parsed.message);
          setPhase("choose");
          return;
        }
        setFile(parsed.file);
        await buildReviewItems(parsed.file, setItems, setError);
        setSelectedIndexes(new Set(parsed.file.blocks.map((_, i) => i)));
        // Load existing collections for the optional target.
        const collectionsResult = await getMyBlocksAdapter().listMyBlockCollections();
        if (collectionsResult.ok) setCollections(collectionsResult.value);
        setPhase("review");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that file.");
        setPhase("choose");
      }
    },
    [],
  );

  const allSelected = items.length > 0 && selectedIndexes.size === items.length;

  const handleImport = useCallback(async () => {
    if (!file || phase !== "review") return;
    setPhase("importing");
    const adapter = getMyBlocksAdapter();
    const result = await importBlocksFile(adapter, file, {
      selectedIndexes: [...selectedIndexes],
    });
    if (!result.ok) {
      setError(result.error.message);
      setPhase("review");
      return;
    }
    // Optionally attach imported blocks to a chosen collection.
    if (targetCollectionId && result.value.records.length > 0) {
      for (const record of result.value.records) {
        const merged = [...new Set([...(record.collectionIds ?? []), targetCollectionId])];
        await adapter.updateMyBlock(record.id, { collectionIds: merged });
      }
    }
    setSummary(result.value);
    setPhase("summary");
    bumpRefresh();
    // Phase P5: persistent thumbnails for the freshly imported records.
    for (const record of result.value.records) {
      void ensureThumbnailForSavedRecord(record);
    }
    const count = result.value.records.length;
    showToast(
      `${count} ${count === 1 ? "saved block" : "saved blocks"} imported to My Blocks`,
    );
  }, [file, phase, selectedIndexes, targetCollectionId, bumpRefresh, showToast]);

  const counts = useMemo(() => {
    if (!summary) return null;
    return {
      imported: summary.imported,
      renamed: summary.renamed,
      failed: summary.failed,
      skipped: summary.skipped,
      total: summary.results.length + summary.skipped,
    };
  }, [summary]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-my-block-title"
      data-testid="import-my-block-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "importing") close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-border bg-base shadow-2xl outline-none"
        data-testid="import-my-block-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div>
            <h3 id="import-my-block-title" className="text-sm font-semibold text-text-primary">
              Import saved blocks
            </h3>
            <p className="text-[11px] text-text-dim">
              {phase === "choose"
                ? "Bring back blocks you exported before."
                : fileName}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="import-my-block-close"
            disabled={phase === "importing"}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 border-b border-border px-5 py-2 text-[10px] font-medium text-text-dim">
          {["Choose file", "Review", "Import", "Summary"].map((label, i) => {
            const step = phase === "choose" ? 0 : phase === "review" ? 1 : phase === "importing" ? 2 : 3;
            return (
              <span key={label} className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full ${
                    i <= step ? "bg-accent/15 text-accent" : "bg-secondary text-text-dim/50"
                  }`}
                >
                  {i + 1}
                </span>
                {label}
                {i < 3 && <span className="text-text-dim/30">—</span>}
              </span>
            );
          })}
        </div>

        <div className="max-h-[60dvh] overflow-y-auto p-5">
          {/* Step 1: choose */}
          {phase === "choose" && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.buildora-block.json,.buildora-blocks.json"
                data-testid="import-my-block-file"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
              <button
                type="button"
                data-testid="import-my-block-choose"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-accent/30 bg-accent/5 px-4 py-8 text-center transition-colors hover:border-accent/50 hover:bg-accent/10"
              >
                <Upload className="h-6 w-6 text-accent" aria-hidden="true" />
                <span className="text-xs font-medium text-text-primary">
                  Choose a block file
                </span>
                <span className="text-[10px] text-text-dim">
                  .buildora-block.json (one block) or .buildora-blocks.json (many)
                </span>
              </button>
            </>
          )}

          {/* Step 2: review */}
          {phase === "review" && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium text-text-primary">
                  {items.length} {items.length === 1 ? "item" : "items"} to import
                </p>
                <button
                  type="button"
                  data-testid="import-review-toggle-all"
                  onClick={() =>
                    setSelectedIndexes(
                      allSelected ? new Set() : new Set(items.map((i) => i.index)),
                    )
                  }
                  className="text-[11px] font-medium text-accent hover:underline"
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>
              <ul className="grid gap-1.5" data-testid="import-review-list">
                {items.map((item) => {
                  const selected = selectedIndexes.has(item.index);
                  return (
                    <li key={item.index}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={selected}
                        data-testid={`import-review-item-${item.index}`}
                        onClick={() =>
                          setSelectedIndexes((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.index)) next.delete(item.index);
                            else next.add(item.index);
                            return next;
                          })
                        }
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                          selected
                            ? "border-accent/50 bg-accent/5"
                            : "border-border bg-secondary hover:bg-card"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 flex-none items-center justify-center rounded-md border ${
                            selected
                              ? "border-accent bg-accent text-white"
                              : "border-border bg-card"
                          }`}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-text-primary">
                            {item.name}
                            {item.duplicate && (
                              <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
                                will be renamed
                              </span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-text-dim">
                            {item.category} · {item.blockCount} blocks
                            {item.warningCount > 0 ? ` · ${item.warningCount} warnings at import` : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {collections.length > 0 && (
                <label className="mt-4 flex items-center gap-2 text-[11px] text-text-dim">
                  Add imported blocks to a collection (optional)
                  <select
                    value={targetCollectionId}
                    onChange={(e) => setTargetCollectionId(e.target.value)}
                    data-testid="import-target-collection"
                    className="h-8 flex-1 rounded-lg border border-border bg-secondary px-2 text-xs text-text-primary focus:border-accent/40 focus:outline-none"
                  >
                    <option value="">None</option>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          {/* Step 3: importing */}
          {phase === "importing" && (
            <div className="flex items-center justify-center gap-3 py-10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
              <p className="text-xs text-text-dim">
                {file ? "Importing blocks…" : "Reading file…"}
              </p>
            </div>
          )}

          {/* Step 4: summary */}
          {phase === "summary" && summary && counts && (
            <div data-testid="import-summary">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden="true" />
                <p className="text-sm font-semibold text-text-primary">
                  {counts.failed === 0
                    ? "All blocks imported"
                    : "Import finished with some issues"}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Imported</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-emerald-400" data-testid="import-summary-imported">
                    {counts.imported}
                  </dd>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Renamed</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-amber-300" data-testid="import-summary-renamed">
                    {counts.renamed}
                  </dd>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Skipped</dt>
                  <dd className="mt-0.5 text-sm font-semibold text-text-primary" data-testid="import-summary-skipped">
                    {counts.skipped}
                  </dd>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Failed</dt>
                  <dd className={`mt-0.5 text-sm font-semibold ${counts.failed > 0 ? "text-red-400" : "text-text-primary"}`} data-testid="import-summary-failed">
                    {counts.failed}
                  </dd>
                </div>
              </div>
              {counts.failed > 0 && (
                <ul className="mt-3 space-y-1">
                  {summary.results
                    .filter((r) => r.outcome === "failed")
                    .map((r) => (
                      <li key={r.index} className="flex items-start gap-1.5 text-[11px] text-red-400">
                        <AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />
                        <span>
                          <span className="font-medium">{r.originalName}</span> — {r.error}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              {/* Collection restoration outcome — never silent. */}
              {summary.collectionsCreated > 0 && (
                <p className="mt-3 text-[11px] text-text-dim" data-testid="import-summary-collections-created">
                  {summary.collectionsCreated}{" "}
                  {summary.collectionsCreated === 1 ? "collection was" : "collections were"} restored
                </p>
              )}
              {summary.collectionsFailed > 0 && (
                <p
                  className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300"
                  role="alert"
                  data-testid="import-summary-collections-failed"
                >
                  <AlertTriangle className="h-3 w-3 flex-none" aria-hidden="true" />
                  {summary.collectionsFailed}{" "}
                  {summary.collectionsFailed === 1 ? "collection could not" : "collections could not"} be
                  restored — your blocks are safe.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" data-testid="import-my-block-error" className="mt-3 text-xs text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {phase === "review" ? (
            <span className="text-[11px] text-text-dim">
              {selectedIndexes.size} of {items.length} selected
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {phase === "review" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase("choose");
                  setFile(null);
                  setItems([]);
                }}
                data-testid="import-review-back"
              >
                Back
              </Button>
            )}
            {phase === "review" && (
              <Button
                type="button"
                size="sm"
                disabled={selectedIndexes.size === 0}
                onClick={() => void handleImport()}
                data-testid="import-review-confirm"
              >
                Import {selectedIndexes.size > 0 ? `${selectedIndexes.size} ` : ""}blocks
              </Button>
            )}
            {(phase === "summary" || phase === "choose") && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={close}
                data-testid="import-my-block-done"
              >
                {phase === "summary" ? "Done" : "Close"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review-item builder — computes duplicate-name + counts against the library
// ---------------------------------------------------------------------------

async function buildReviewItems(
  file: BuildoraBlocksFile,
  setItems: (items: ReviewItem[]) => void,
  setError: (message: string) => void,
): Promise<void> {
  try {
    const siblings = await getMyBlocksAdapter().listMyBlocks();
    if (!siblings.ok) {
      setError(siblings.error.message);
      return;
    }
    const existing = new Set(siblings.value.map((b) => b.name.toLowerCase()));
    const items: ReviewItem[] = file.blocks.map((block, index) => {
      const blockCount = Object.keys(block.tree.nodes).length;
      return {
        index,
        name: block.name,
        category: block.category,
        blockCount,
        warningCount: block.sourceMetadata?.originalWarningCount ?? 0,
        duplicate: existing.has(block.name.toLowerCase()),
      };
    });
    setItems(items);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Could not prepare the import review.");
  }
}
