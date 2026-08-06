"use client";

// ---------------------------------------------------------------------------
// MoveToCollectionDialog (Phase P5) — put one or more saved blocks into a
// personal collection (or remove them from all collections).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderInput, FolderPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { MyBlockCollection } from "../types";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";

export function MoveToCollectionDialog() {
  const blockIds = useMyBlocksUiStore((s) => s.moveBlockIds);
  const close = useMyBlocksUiStore((s) => s.closeMoveToCollection);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);
  const openCreateCollection = useMyBlocksUiStore((s) => s.openCreateCollection);

  const [collections, setCollections] = useState<MyBlockCollection[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | "none">("none");
  const dialogRef = useRef<HTMLDivElement>(null);

  // Load collections when opened.
  useEffect(() => {
    if (!blockIds) return;
    let cancelled = false;
    getMyBlocksAdapter()
      .listMyBlockCollections()
      .then((result) => {
        if (cancelled) return;
        setCollections(result.ok ? result.value : []);
      });
    return () => {
      cancelled = true;
    };
  }, [blockIds]);

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

  const handleMove = useCallback(async () => {
    if (!blockIds || blockIds.length === 0 || busy) return;
    setBusy(true);
    const adapter = getMyBlocksAdapter();
    const targetId = selectedCollectionId === "none" ? null : selectedCollectionId;

    // Read current membership for each block, then apply the choice.
    // "No collection" removes membership; a chosen collection is appended if
    // not already present (blocks may belong to several collections).
    const failures: string[] = [];
    for (const id of blockIds) {
      const current = await adapter.getMyBlock(id);
      if (!current.ok) {
        failures.push(id);
        continue;
      }
      const currentIds = current.value.collectionIds ?? [];
      const applied =
        targetId === null
          ? []
          : currentIds.includes(targetId)
            ? currentIds
            : [...currentIds, targetId];
      const result = await adapter.updateMyBlock(id, { collectionIds: applied });
      if (!result.ok) failures.push(id);
    }
    setBusy(false);
    bumpRefresh();
    close();
    if (failures.length === 0) {
      showToast(
        blockIds.length === 1
          ? targetId
            ? "Moved to collection"
            : "Removed from collections"
          : `${blockIds.length - failures.length} of ${blockIds.length} blocks moved`,
      );
    } else {
      showToast(`${blockIds.length - failures.length} of ${blockIds.length} moved — ${failures.length} could not be updated.`);
    }
  }, [blockIds, busy, selectedCollectionId, bumpRefresh, showToast, close]);

  const label = useMemo(() => {
    if (!blockIds) return "";
    return blockIds.length === 1 ? "this block" : `these ${blockIds.length} blocks`;
  }, [blockIds]);

  if (!blockIds) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-to-collection-title"
      data-testid="move-to-collection-dialog"
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
          <h3 id="move-to-collection-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <FolderInput className="h-4 w-4 text-accent" aria-hidden="true" />
            Move {label}
          </h3>
          <button
            type="button"
            aria-label="Close"
            data-testid="move-to-collection-close"
            disabled={busy}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-1.5">
          <button
            type="button"
            data-testid="move-collection-none"
            onClick={() => setSelectedCollectionId("none")}
            className={`rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
              selectedCollectionId === "none"
                ? "border-accent/60 bg-accent/10 text-text-primary"
                : "border-border bg-secondary text-text-muted hover:bg-card"
            }`}
          >
            No collection
            <span className="block text-[10px] text-text-dim">Remove from all collections</span>
          </button>
          {collections.map((collection) => (
            <button
              key={collection.id}
              type="button"
              data-testid={`move-collection-${collection.id}`}
              onClick={() => setSelectedCollectionId(collection.id)}
              className={`rounded-xl border px-3 py-2.5 text-left text-xs transition-colors ${
                selectedCollectionId === collection.id
                  ? "border-accent/60 bg-accent/10 text-text-primary"
                  : "border-border bg-secondary text-text-muted hover:bg-card"
              }`}
            >
              {collection.name}
              {collection.description ? (
                <span className="block truncate text-[10px] text-text-dim">{collection.description}</span>
              ) : null}
            </button>
          ))}
          {collections.length === 0 && (
            <button
              type="button"
              data-testid="move-collection-create"
              onClick={() => {
                close();
                openCreateCollection();
              }}
              className="flex items-center gap-2 rounded-xl border border-dashed border-accent/30 px-3 py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              New collection
            </button>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void handleMove()}
            data-testid="move-to-collection-confirm"
          >
            {busy ? "Moving…" : "Move"}
          </Button>
        </div>
      </div>
    </div>
  );
}
