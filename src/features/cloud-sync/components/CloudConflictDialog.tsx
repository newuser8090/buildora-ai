"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — conflict review dialog
//
// Lists open conflicts (bounded rendering) with keyboard-accessible cards.
// BlockTree conflicts are never auto-resolved — every card requires an
// explicit choice. Resolutions are durable + retry-safe.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { X, MessageSquareWarning, RefreshCw } from "lucide-react";
import { useAuth } from "@/features/auth/useAuth";
import { useCloudSyncStore } from "../store/cloud-sync-store";
import { getSyncConflictStore } from "../sync-runtime";
import { CloudConflictCard } from "./CloudConflictCard";
import { useFocusTrap } from "@/features/auth/components/useFocusTrap";
import { SYNC_MAX_CONFLICTS_RENDERED } from "../constants";
import type { CloudConflictRecord } from "../types";

export function CloudConflictDialog() {
  const open = useCloudSyncStore((s) => s.conflictsOpen);
  const close = useCloudSyncStore((s) => s.closeConflicts);
  const { user } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [conflicts, setConflicts] = useState<CloudConflictRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusTrap(open, dialogRef);

  // Render-phase reset when the dialog opens (never sync setState in an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setLoading(true);
  }

  const loadConflicts = useCallback(async () => {
    if (!user) return { list: [] as CloudConflictRecord[], fullCount: 0 };
    const store = getSyncConflictStore();
    const list = (await store?.listOpen(user.id)) ?? [];
    return { list, fullCount: list.length };
  }, [user]);

  // Results are applied through a .then callback — no synchronous setState
  // inside the effect body.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void loadConflicts().then(({ list, fullCount }) => {
      if (cancelled) return;
      setConflicts(list.slice(0, SYNC_MAX_CONFLICTS_RENDERED));
      useCloudSyncStore.getState().setConflictCount(fullCount);
      setLoading(false);
      if (fullCount === 0) useCloudSyncStore.getState().setStatus("synced");
    });
    return () => {
      cancelled = true;
    };
  }, [open, loadConflicts]);

  /** Event-handler reload (refresh button / card resolutions). */
  const reload = useCallback(async () => {
    if (!user) return;
    const { list, fullCount } = await loadConflicts();
    setConflicts(list.slice(0, SYNC_MAX_CONFLICTS_RENDERED));
    useCloudSyncStore.getState().setConflictCount(fullCount);
    setLoading(false);
    if (fullCount === 0) useCloudSyncStore.getState().setStatus("synced");
  }, [user, loadConflicts]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflicts-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-elevated"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <MessageSquareWarning className="h-5 w-5 text-amber-400" />
            <h2 id="conflicts-title" className="text-lg font-semibold text-text-primary">
              Conflicts to review
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void reload()}
              aria-label="Refresh conflicts"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={close}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {loading && conflicts.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-dim">Loading conflicts…</p>
          ) : conflicts.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-text-primary">All caught up</p>
              <p className="mt-1 text-sm text-text-muted">No conflicts need your attention.</p>
            </div>
          ) : (
            <>
              {conflicts.map((conflict) => (
                <CloudConflictCard key={conflict.id} conflict={conflict} onResolved={() => void reload()} />
              ))}
              {conflicts.length >= SYNC_MAX_CONFLICTS_RENDERED && (
                <p className="text-center text-xs text-text-dim">
                  Showing the first {SYNC_MAX_CONFLICTS_RENDERED} — resolve these to see more.
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-border px-6 py-3 text-xs text-text-dim">
          Conflicts happen when a saved piece changes on two devices. Choose which version to keep —
          nothing is overwritten without your say-so.
        </div>
      </div>
    </div>
  );
}
