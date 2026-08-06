"use client";

// ---------------------------------------------------------------------------
// CollectionDialog (Phase P5) — create / rename / delete a personal folder
//
// Beginner language: "Collections — organize your saved pieces". Deleting a
// collection NEVER deletes blocks — it only removes the folder.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderPlus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";

export function CollectionDialog() {
  const dialog = useMyBlocksUiStore((s) => s.collectionDialog);
  const close = useMyBlocksUiStore((s) => s.closeCollectionDialog);
  const showToast = useMyBlocksUiStore((s) => s.showToast);
  const bumpRefresh = useMyBlocksUiStore((s) => s.bumpRefresh);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset when opened. The reset happens in a render-phase adjustment; the
  // focus happens in an effect (never sync setState during render).
  const [prevKey, setPrevKey] = useState("");
  const dialogKey = dialog ? `${dialog.mode}:${dialog.mode === "rename" ? dialog.collection.id : ""}` : "";
  if (dialogKey !== prevKey) {
    setPrevKey(dialogKey);
    if (dialog) {
      setName(dialog.mode === "rename" ? dialog.collection.name : "");
      setDescription(dialog.mode === "rename" ? (dialog.collection.description ?? "") : "");
      setError(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!dialog) return;
    const prev = document.activeElement as HTMLElement | null;
    const raf = window.setTimeout(() => nameRef.current?.focus(), 20);
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
  }, [dialog, busy, close]);

  const handleSave = useCallback(async () => {
    if (!dialog || busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your collection a name.");
      return;
    }
    setBusy(true);
    setError(null);
    const adapter = getMyBlocksAdapter();
    const result =
      dialog.mode === "create"
        ? await adapter.createMyBlockCollection({
            name: trimmed,
            description: description.trim() || undefined,
          })
        : await adapter.updateMyBlockCollection(dialog.collection.id, {
            name: trimmed,
            description: description.trim() || undefined,
          });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    bumpRefresh();
    showToast(
      dialog.mode === "create"
        ? `Collection "${result.value.name}" created`
        : `Collection renamed to "${result.value.name}"`,
    );
    close();
  }, [dialog, name, description, busy, bumpRefresh, showToast, close]);

  const handleDelete = useCallback(async () => {
    if (!dialog || dialog.mode !== "rename" || busy) return;
    setBusy(true);
    setError(null);
    const result = await getMyBlocksAdapter().deleteMyBlockCollection(dialog.collection.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    bumpRefresh();
    showToast(`Collection "${dialog.collection.name}" deleted — your blocks are safe.`);
    close();
  }, [dialog, busy, bumpRefresh, showToast, close]);

  if (!dialog) return null;

  const isCreate = dialog.mode === "create";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collection-dialog-title"
      data-testid="collection-dialog"
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
          <h3 id="collection-dialog-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <FolderPlus className="h-4 w-4 text-accent" aria-hidden="true" />
            {isCreate ? "New collection" : `Rename “${dialog.collection.name}”`}
          </h3>
          <button
            type="button"
            aria-label="Close"
            data-testid="collection-dialog-close"
            disabled={busy}
            onClick={close}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {isCreate
            ? "Group related pieces so they are easier to find."
            : "Renaming never changes the blocks inside."}
        </p>

        <label className="mt-4 block">
          <span className="text-[11px] font-medium text-text-dim">Name</span>
          <input
            ref={nameRef}
            type="text"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            data-testid="collection-name"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
            placeholder="e.g. Landing pages"
          />
        </label>

        <label className="mt-3 block">
          <span className="text-[11px] font-medium text-text-dim">Description (optional)</span>
          <input
            type="text"
            value={description}
            maxLength={160}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="collection-description"
            className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary px-3 text-sm text-text-primary placeholder:text-text-dim/50 focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/10"
            placeholder="What goes in here?"
          />
        </label>

        {error && (
          <p role="alert" data-testid="collection-error" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          {!isCreate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void handleDelete()}
              data-testid="collection-delete"
              className="text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !name.trim()}
              onClick={() => void handleSave()}
              data-testid="collection-save"
            >
              {busy ? "Saving…" : isCreate ? "Create collection" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
