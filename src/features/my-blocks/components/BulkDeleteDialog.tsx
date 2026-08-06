"use client";

// ---------------------------------------------------------------------------
// BulkDeleteDialog (Phase P5) — confirm deleting several saved blocks.
// Shows the exact count; deletes the library records + their thumbnails.
// Project copies are never touched.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { getMyBlockThumbnailStorage } from "../thumbnails/my-block-thumbnail-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";

export function BulkDeleteDialog() {
  const blockIds = useMyBlocksUiStore((s) => s.bulkDeleteBlockIds);
  const close = useMyBlocksUiStore((s) => s.closeBulkDelete);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!blockIds) return;
    const prev = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(raf);
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [blockIds, busy, close]);

  const handleDelete = useCallback(async () => {
    if (!blockIds || blockIds.length === 0 || busy) return;
    setBusy(true);
    const adapter = getMyBlocksAdapter();
    const thumbStorage = getMyBlockThumbnailStorage();
    let deleted = 0;
    for (const id of blockIds) {
      const result = await adapter.deleteMyBlock(id);
      if (result.ok) {
        deleted += 1;
        void thumbStorage.removeThumbnail(id);
      }
    }
    setBusy(false);
    bumpRefresh();
    close();
    showToast(
      deleted === blockIds.length
        ? `Deleted ${deleted} saved ${deleted === 1 ? "block" : "blocks"}`
        : `Deleted ${deleted} of ${blockIds.length} saved blocks`,
    );
  }, [blockIds, busy, bumpRefresh, showToast, close]);

  if (!blockIds) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-delete-title"
      data-testid="bulk-delete-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-border bg-base p-5 shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between">
          <h3 id="bulk-delete-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Trash2 className="h-4 w-4 text-red-400" aria-hidden="true" />
            Delete {blockIds.length} saved {blockIds.length === 1 ? "block" : "blocks"}?
          </h3>
          <button
            type="button"
            aria-label="Close"
            data-testid="bulk-delete-close"
            disabled={busy}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          This removes {blockIds.length === 1 ? "this block" : `these ${blockIds.length} blocks`} from
          your library. Pages that already use {blockIds.length === 1 ? "it" : "them"} are not affected.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleDelete()}
            data-testid="bulk-delete-confirm"
            className="bg-red-600 text-white hover:bg-red-500"
          >
            {busy ? "Deleting…" : `Delete ${blockIds.length}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
