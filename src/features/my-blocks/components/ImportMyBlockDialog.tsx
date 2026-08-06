"use client";

// ---------------------------------------------------------------------------
// ImportMyBlockDialog — import a `.buildora-block.json` file into the library
//
// Flow: pick a file → read (size-capped) → parse (schema validation, version
// check) → import (fresh library id, fresh timestamps, duplicate-safe name,
// deep-cloned independent tree). Structured, user-safe errors. Import is
// never mixed with project import/export.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { importBlockFileJson } from "../services/my-block-file";
import { MY_BLOCK_MAX_FILE_SIZE_BYTES } from "../schemas/my-block-schema";

export function ImportMyBlockDialog() {
  const open = useMyBlocksUiStore((s) => s.importOpen);
  const close = useMyBlocksUiStore((s) => s.closeImport);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Reset when opened.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFileName(null);
      setError(null);
      setImporting(false);
    }
  }

  // Focus + Escape.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !importing) {
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
  }, [open, importing, close]);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setError(null);
      setFileName(file.name);
      if (file.size > MY_BLOCK_MAX_FILE_SIZE_BYTES) {
        setError(
          `This file is too large to import (${Math.ceil(file.size / 1024)} KB, the limit is ${Math.ceil(MY_BLOCK_MAX_FILE_SIZE_BYTES / 1024)} KB).`,
        );
        return;
      }
      setImporting(true);
      try {
        const text = await file.text();
        const result = await importBlockFileJson(getMyBlocksAdapter(), text);
        if (result.ok) {
          bumpRefresh();
          showToast(`"${result.value.name}" imported to My Blocks`);
          close();
        } else {
          setError(result.error.message);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that file.");
      } finally {
        setImporting(false);
      }
    },
    [bumpRefresh, showToast, close],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-my-block-title"
      data-testid="import-my-block-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-border bg-base p-5 shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between">
          <h3 id="import-my-block-title" className="text-sm font-semibold text-text-primary">
            Import a saved block
          </h3>
          <button
            type="button"
            aria-label="Close"
            data-testid="import-my-block-close"
            disabled={importing}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Choose a <span className="font-medium text-text-primary">.buildora-block.json</span> file
          exported from Buildora. It becomes a fresh, independent saved block.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json,.buildora-block.json"
          data-testid="import-my-block-file"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />

        <button
          type="button"
          data-testid="import-my-block-choose"
          disabled={importing}
          onClick={() => fileRef.current?.click()}
          className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-accent/30 bg-accent/5 px-4 py-8 text-center transition-colors hover:border-accent/50 hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload className="h-6 w-6 text-accent" aria-hidden="true" />
          <span className="text-xs font-medium text-text-primary">
            {importing ? "Importing…" : fileName ? fileName : "Choose a block file"}
          </span>
          <span className="text-[10px] text-text-dim">Buildora saves the editable block, not the original code.</span>
        </button>

        {error && (
          <p role="alert" data-testid="import-my-block-error" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={importing} data-testid="import-my-block-cancel">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
