"use client";

// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — add pieces dialog (owner/editor)
//
// Lets the owner pick saved pieces from their own My Blocks and share them.
// Only pieces that have synced (a cloud id exists) can be shared — local-only
// pieces show a "Sync first" hint instead of a checkbox. Selection is
// multi-select; adding is idempotent server-side. Permission is enforced
// server-side (addBlocksToLibrary) — this dialog never decides access.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Loader2, Plus, Package, CloudOff } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { getCloudProvider } from "@/features/cloud-sync/providers/provider-factory";
import { getSyncMarkers } from "@/features/cloud-sync/sync-runtime";
import { SharedLibraryService } from "../services/shared-library-service";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import { useSharedLibrariesUiStore } from "../store/shared-libraries-ui-store";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import type { MyBlockRecord } from "@/features/my-blocks/types";

export interface AddBlocksToLibraryDialogProps {
  libraryId: string;
  onAdded: () => void;
  /** Injectable local→cloud id resolver (marker-based by default). */
  resolveCloudId?: (userId: string, blockId: string) => Promise<string | null>;
}

export function AddBlocksToLibraryDialog({
  libraryId,
  onAdded,
  resolveCloudId,
}: AddBlocksToLibraryDialogProps) {
  const open = useSharedLibrariesUiStore((s) => s.addBlocksDialog?.libraryId === libraryId);
  const close = useSharedLibrariesUiStore((s) => s.closeAddBlocks);
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const [blocks, setBlocks] = useState<MyBlockRecord[]>([]);
  const [cloudIds, setCloudIds] = useState<Map<string, string>>(new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusTrap(open, dialogRef);

  // Render-phase reset when the dialog opens (never sync setState in an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSelected(new Set());
      setError(null);
      setLoading(true);
    }
  }

  // Resolve the cloud id for a local block through the sync markers.
  const defaultResolveCloudId = useCallback(
    async (userId: string, blockId: string): Promise<string | null> => {
      const markers = getSyncMarkers();
      if (!markers) return null;
      const marker = await markers.getMarker(userId, "myBlock", blockId);
      return marker?.cloudEntityId ?? null;
    },
    [],
  );
  const resolve = resolveCloudId ?? defaultResolveCloudId;

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    void (async () => {
      const result = await getMyBlocksAdapter().listMyBlocks();
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setError("Couldn't load your saved pieces.");
        return;
      }
      setBlocks(result.value);
      const resolved = new Map<string, string>();
      for (const block of result.value) {
        const cloudId = await resolve(user.id, block.id);
        if (cloudId) resolved.set(block.id, cloudId);
      }
      if (!cancelled) setCloudIds(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, resolve]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const shareable = useMemo(
    () => blocks.filter((b) => cloudIds.has(b.id)),
    [blocks, cloudIds],
  );

  const handleAdd = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setError(null);
    const provider = getCloudProvider();
    if (!provider) {
      setError("Cloud backup isn't configured for this app yet.");
      setBusy(false);
      return;
    }
    const service = new SharedLibraryService(provider);
    const ids = [...selected].map((id) => cloudIds.get(id)).filter((id): id is string => !!id);
    if (ids.length === 0) {
      setError("None of the selected pieces have synced yet. Sync first, then try again.");
      setBusy(false);
      return;
    }
    const result = await service.addBlocks(libraryId, ids);
    setBusy(false);
    if (result.ok) {
      close();
      onAdded();
    } else {
      setError(result.error.message);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-blocks-title"
        data-testid="add-blocks-dialog"
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div>
            <h2 id="add-blocks-title" className="text-lg font-semibold text-text-primary">
              Add saved pieces
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Choose pieces from your own saved blocks to share. Only you can add to your library.
            </p>
          </div>
          <button
            onClick={close}
            aria-label="Close"
            data-testid="add-blocks-close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto px-6 py-5">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </div>
          )}

          {loading ? (
            <p className="flex items-center gap-2 py-8 text-center text-sm text-text-dim">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your saved pieces…
            </p>
          ) : blocks.length === 0 ? (
            <div className="py-10 text-center">
              <Package className="mx-auto h-8 w-8 text-text-dim" />
              <p className="mt-3 text-sm font-medium text-text-primary">No saved pieces yet</p>
              <p className="mt-1 text-sm text-text-muted">
                Save a design to My Blocks first, then share it here.
              </p>
            </div>
          ) : (
            <>
              {blocks.map((block) => {
                const cloudId = cloudIds.get(block.id);
                const checked = selected.has(block.id);
                const row = (
                  <>
                    <span className="flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors" aria-hidden="true">
                      {checked && <span className="h-2 w-2 rounded-sm bg-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">{block.name}</span>
                      <span className="block text-[11px] text-text-dim">
                        {block.previewMetadata.blockCount} block{block.previewMetadata.blockCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </>
                );
                return cloudId ? (
                  <label
                    key={block.id}
                    className={`relative flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                      checked ? "border-accent/50 bg-accent/5" : "border-border hover:bg-base"
                    }`}
                  >
                    {/* Overlay input covers the whole row so clicks land on the
                        real checkbox (sr-only inputs intercept clicks). */}
                    <input
                      type="checkbox"
                      className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      checked={checked}
                      onChange={() => toggle(block.id)}
                      data-testid={`add-blocks-block-${block.id}`}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none flex h-4 w-4 flex-none items-center justify-center rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40"
                    >
                      {checked && <span className="h-2 w-2 rounded-sm bg-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text-primary">{block.name}</span>
                      <span className="block text-[11px] text-text-dim">
                        {block.previewMetadata.blockCount} block{block.previewMetadata.blockCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </label>
                ) : (
                  <div
                    key={block.id}
                    className="flex items-center gap-3 rounded-xl border border-border/60 px-4 py-3 opacity-70"
                    title="Sync this piece to your account before sharing it"
                  >
                    <CloudOff className="h-4 w-4 flex-none text-text-dim" aria-hidden="true" />
                    {row}
                    <span className="flex-none text-[10px] font-medium text-text-dim">Sync first</span>
                  </div>
                );
              })}
              {shareable.length < blocks.length && (
                <p className="pt-1 text-[11px] leading-relaxed text-text-dim">
                  Pieces marked “Sync first” need to finish backing up before you can share them.
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border p-4">
          <button
            onClick={() => void handleAdd()}
            disabled={busy || selected.size === 0}
            data-testid="add-blocks-submit"
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add selected ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
