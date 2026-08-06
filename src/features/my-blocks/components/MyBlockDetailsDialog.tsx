"use client";

// ---------------------------------------------------------------------------
// MyBlockDetailsDialog — full preview + metadata + export for one saved block
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { MyBlockRecord } from "../types";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { MyBlockPreview } from "./MyBlockPreview";

const CATEGORY_LABELS: Record<string, string> = {
  layout: "Layout",
  text: "Text",
  media: "Media",
  buttons: "Buttons",
  cards: "Cards",
  forms: "Forms",
  navigation: "Navigation",
  "complete-section": "Complete section",
  other: "Other",
};

export function MyBlockDetailsDialog() {
  const blockId = useMyBlocksUiStore((s) => s.detailsBlockId);
  const close = useMyBlocksUiStore((s) => s.closeDetails);
  const showToast = useMyBlocksUiStore((s) => s.showToast);

  const [block, setBlock] = useState<MyBlockRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset + load when opened. The reset happens in a render-phase adjustment
  // and the load resolves inside a promise callback (never sync setState).
  const [prevId, setPrevId] = useState<string | null>(null);
  if (blockId !== prevId) {
    setPrevId(blockId);
    if (blockId) {
      setBlock(null);
      setError(null);
    }
  }

  useEffect(() => {
    if (!blockId) return;
    let cancelled = false;
    getMyBlocksAdapter()
      .getMyBlock(blockId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setBlock(result.value);
        else setError(result.error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [blockId]);

  useEffect(() => {
    if (!blockId) return;
    const prevFocusRef = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", onKey);
      prevFocusRef?.focus?.();
    };
  }, [blockId, close]);

  const formattedDate = useMemo(() => {
    if (!block?.updatedAt) return "";
    const d = new Date(block.updatedAt);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
  }, [block]);

  const handleExport = useCallback(async () => {
    if (!block) return;
    const { buildBlockFile } = await import("../services/my-block-file");
    const payload = buildBlockFile(block);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = block.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "saved-block";
    a.href = url;
    a.download = `${safeName}.buildora-block.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Block exported");
  }, [block, showToast]);

  if (!blockId) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Saved block details"
      data-testid="my-block-details"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        data-testid="my-block-details-panel"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-base shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">{block?.name ?? "Saved block"}</h3>
            <p className="text-[11px] text-text-dim">
              {block ? `${CATEGORY_LABELS[block.category] ?? "Other"}${formattedDate ? ` · updated ${formattedDate}` : ""}` : ""}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            data-testid="my-block-details-close"
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto p-4">
          {error ? (
            <p role="alert" className="text-xs text-red-400">{error}</p>
          ) : !block ? (
            <div className="flex justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            </div>
          ) : (
            <>
              {block.tree && <MyBlockPreview tree={block.tree} height={180} maxNodes={80} />}

              {block.description && (
                <div>
                  <p className="mb-1 text-xs font-medium text-text-dim">Description</p>
                  <p className="text-sm leading-relaxed text-text-muted">{block.description}</p>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Blocks</dt>
                  <dd className="mt-0.5 font-semibold text-text-primary">{block.previewMetadata.blockCount}</dd>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Media</dt>
                  <dd className="mt-0.5 font-semibold text-text-primary">
                    {block.previewMetadata.containsMedia ? "Yes" : "No"}
                  </dd>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Interactive</dt>
                  <dd className="mt-0.5 font-semibold text-text-primary">
                    {block.previewMetadata.containsInteractive ? "Yes" : "No"}
                  </dd>
                </div>
                <div className="rounded-lg bg-secondary px-3 py-2">
                  <dt className="text-text-dim">Used</dt>
                  <dd className="mt-0.5 font-semibold text-text-primary">{block.useCount ?? 0}×</dd>
                </div>
              </dl>

              {block.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {block.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {block.sourceMetadata && (
                <p className="text-[10px] text-text-dim/70">
                  Source: {block.sourceMetadata.source}
                  {block.sourceMetadata.language ? ` · ${block.sourceMetadata.language}` : ""}
                  {typeof block.sourceMetadata.originalWarningCount === "number"
                    ? ` · ${block.sourceMetadata.originalWarningCount} warnings at import`
                    : ""}
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={!block} data-testid="my-block-details-export">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button type="button" size="sm" onClick={close} data-testid="my-block-details-done">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
