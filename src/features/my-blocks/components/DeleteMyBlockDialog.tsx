"use client";

// ---------------------------------------------------------------------------
// DeleteMyBlockDialog — delete a saved block from the library
//
// Removes ONLY the library record. Existing copies already inserted into
// projects remain completely intact.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import type { MyBlockRecord } from "../types";

export function DeleteMyBlockDialog() {
  const blockId = useMyBlocksUiStore((s) => s.deleteBlockId);
  const close = useMyBlocksUiStore((s) => s.closeDelete);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [block, setBlock] = useState<MyBlockRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Load the record when opened.
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

  // Focus + Escape.
  useEffect(() => {
    if (!blockId) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => dialogRef.current?.focus(), 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) {
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
  }, [blockId, deleting, close]);

  const handleDelete = useCallback(async () => {
    if (!blockId || deleting) return;
    setDeleting(true);
    setError(null);
    const result = await getMyBlocksAdapter().deleteMyBlock(blockId);
    setDeleting(false);
    if (result.ok) {
      bumpRefresh();
      showToast(block ? `"${block.name}" deleted` : "Saved block deleted");
      close();
    } else {
      setError(result.error.message);
    }
  }, [blockId, deleting, block, bumpRefresh, showToast, close]);

  if (!blockId) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-my-block-title"
      data-testid="delete-my-block-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-sm rounded-2xl border border-border bg-base p-5 shadow-2xl outline-none"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-red-500/10">
            <Trash2 className="h-4 w-4 text-red-400" aria-hidden="true" />
          </span>
          <div>
            <h3 id="delete-my-block-title" className="text-sm font-semibold text-text-primary">
              Delete saved block?
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              {block ? (
                <>
                  <span className="font-semibold text-text-primary">{block.name}</span> will be
                  removed from your library. Blocks you already added to pages stay
                  exactly where they are.
                </>
              ) : (
                "This will remove the saved block from your library. Blocks already added to pages stay where they are."
              )}
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" data-testid="delete-my-block-error" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={deleting} data-testid="delete-my-block-cancel">
            Keep block
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={handleDelete}
            disabled={deleting || !block}
            isLoading={deleting}
            data-testid="delete-my-block-confirm"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
