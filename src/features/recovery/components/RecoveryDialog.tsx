// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — RecoveryDialog
//
// Shows bounded last-known-good backups for a project and offers:
//   - Restore (writes the snapshot back through the persistence save path —
//     NEVER auto-overwrites without explicit confirmation)
//   - Preview backup (read-only details derived from the snapshot)
//   - Keep current version
// ---------------------------------------------------------------------------

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, History, CheckCircle2 } from "lucide-react";
import { getProjectController } from "@/features/persistence/services/project-controller";
import { getRecoveryService } from "../services/recovery-service";
import type { RecoverySnapshot } from "../types";
import { cn } from "@/utils/cn";

export interface RecoveryDialogProps {
  open: boolean;
  projectId: string | null;
  projectName?: string;
  onClose: () => void;
  /** Called after a successful restore — the caller re-opens/re-hydrates. */
  onRestored: () => void;
}

export function RecoveryDialog({
  open,
  projectId,
  projectName,
  onClose,
  onRestored,
}: RecoveryDialogProps) {
  const [snapshots, setSnapshots] = useState<RecoverySnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<RecoverySnapshot | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<RecoverySnapshot | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    const result = await getRecoveryService().listSnapshots(projectId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSnapshots(result.snapshots);
  }, [projectId]);

  // Load on open. Deferred in requestAnimationFrame so the loading state
  // updates land after the effect (matches the codebase set-state-in-effect
  // pattern — see PublishDialog).
  useEffect(() => {
    if (!open || !projectId) return;
    const id = requestAnimationFrame(() => void refresh());
    return () => cancelAnimationFrame(id);
  }, [open, projectId, refresh]);

  // Focus trap + restore.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;

    const getFocusable = (): HTMLElement[] => {
      if (!panelRef.current) return [];
      return Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active && panelRef.current?.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    const handleFocusIn = (e: FocusEvent) => {
      if (!panelRef.current) return;
      if (!panelRef.current.contains(e.target as Node)) {
        getFocusable()[0]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    const raf = window.setTimeout(() => getFocusable()[0]?.focus(), 30);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(raf);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [open, onClose]);

  const handleRestore = useCallback(async () => {
    if (!confirmRestore || !projectId || restoring) return;
    setRestoring(true);
    setError(null);

    const prepared = await getRecoveryService().prepareRestore(
      confirmRestore.id,
      projectId,
    );
    if (!prepared.ok) {
      setRestoring(false);
      setError(prepared.error.message);
      return;
    }

    const controller = getProjectController();
    if (!controller) {
      setRestoring(false);
      setError("Could not restore — the editor is not ready.");
      return;
    }

    try {
      // Restore writes through the normal save path (the only writer).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const saveResult = await (controller as any).adapter.saveProject({
        project: prepared.project,
        revision: Math.max(prepared.revision + 1, 1),
      });
      setRestoring(false);
      if (!saveResult.success) {
        setError(saveResult.error?.message ?? "Could not restore the backup.");
        return;
      }
      setConfirmRestore(null);
      onRestored();
    } catch (err) {
      setRestoring(false);
      setError(err instanceof Error ? err.message : "Could not restore the backup.");
    }
  }, [confirmRestore, projectId, restoring, onRestored]);

  if (!open || !projectId) return null;

  const sectionCount = (snapshot: RecoverySnapshot) =>
    snapshot.project.pages.reduce((n, p) => n + p.sections.length, 0);

  const formatWhen = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const reasonLabel = (reason: string) =>
    reason === "manual" ? "Saved backup" : reason === "open" ? "Saved on open" : "Auto-saved";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-dialog-title"
    >
      <div
        ref={panelRef}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="recovery-dialog-title" tabIndex={-1} className="text-base font-semibold text-text-primary">
              Found a recent backup
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {projectName ?? "This project"} has saved backups. You can restore one — your current version is never overwritten without asking.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close recovery dialog"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-base hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
              data-testid="recovery-error"
            >
              {error}
            </div>
          )}

          {loading && (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg border border-border/60 bg-base" />
              ))}
            </div>
          )}

          {!loading && snapshots.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <History className="h-7 w-7 text-text-dim" />
              <h3 className="mt-3 text-sm font-semibold text-text-primary">No backups found</h3>
              <p className="mt-1 max-w-xs text-xs text-text-muted">
                Backups are saved automatically after edits. Keep working and one will appear here.
              </p>
            </div>
          )}

          {!loading && snapshots.length > 0 && (
            <div className="flex flex-col gap-2">
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="rounded-lg border border-border bg-base p-3"
                  data-testid="recovery-snapshot"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-text-primary">
                          {reasonLabel(snapshot.reason)}
                        </p>
                        <p className="text-[11px] text-text-muted">
                          {formatWhen(snapshot.createdAt)} · {snapshot.project.pages.length} page
                          {snapshot.project.pages.length !== 1 ? "s" : ""} · {sectionCount(snapshot)} section
                          {sectionCount(snapshot) !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewSnapshot(
                            previewSnapshot?.id === snapshot.id ? null : snapshot,
                          )
                        }
                        aria-label={`Preview backup from ${formatWhen(snapshot.createdAt)}`}
                        className="flex h-7 items-center rounded-md border border-border px-2 text-[11px] font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                      >
                        {previewSnapshot?.id === snapshot.id ? "Hide" : "Preview"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRestore(snapshot)}
                        disabled={restoring}
                        className="flex h-7 items-center rounded-md bg-accent px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Restore
                      </button>
                    </div>
                  </div>

                  {previewSnapshot?.id === snapshot.id && (
                    <div className="mt-3 rounded-md border border-border bg-card p-3" data-testid="recovery-preview">
                      <p className="text-xs font-semibold text-text-primary">{snapshot.project.name}</p>
                      <ul className="mt-1.5 flex flex-col gap-0.5">
                        {snapshot.project.pages.map((page) => (
                          <li key={page.id} className="text-[11px] text-text-muted">
                            {page.title} — {page.sections.length} part
                            {page.sections.length !== 1 ? "s" : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-[11px] text-text-dim/70">
            Up to 5 backups per project, newest kept.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-base hover:text-text-primary active:scale-95"
          >
            Keep current version
          </button>
        </div>
      </div>

      {/* Confirm restore */}
      {confirmRestore && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm restore"
        >
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-elevated">
            <h3 className="text-sm font-semibold text-text-primary">Restore this backup?</h3>
            <p className="mt-1 text-xs text-text-muted">
              This replaces the current project with the backup from{" "}
              {formatWhen(confirmRestore.createdAt)}. Your current version is kept as the newest
              backup, so nothing is lost.
            </p>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmRestore(null)}
                disabled={restoring}
                className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-base hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={restoring}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
                )}
                data-testid="recovery-confirm-restore"
              >
                {restoring ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
                ) : null}
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
