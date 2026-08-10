"use client";

// ---------------------------------------------------------------------------
// Phase P15 — RestoreVersionDialog
//
// Explicit, confirmed restore of an older workspace version. Restoring:
//   - verifies the expected server revision (stale restore fails safely)
//   - saves a safety version of the current state first
//   - applies the snapshot as a NEW revision (older versions stay in history)
// After a successful restore the editor reloads so the server content
// re-hydrates authoritatively. A stale restore offers "Reload latest".
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, X } from "lucide-react";
import { useWorkspaceHistoryUiStore } from "../store/workspace-history-ui-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import { useProjectVersionHistory } from "../hooks/useProjectVersionHistory";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { relativeTime } from "../utils/time";
import { reasonLabel } from "./version-labels";

export function RestoreVersionDialog() {
  const { restoreVersion, setRestoreVersion } = useWorkspaceHistoryUiStore();
  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);
  const projectId = useEditorStore((s) => s.activeProjectId);
  const projectName = useEditorStore((s) => s.project.name);
  // The restore flow only needs the server revision for optimistic
  // concurrency — never the version LIST — so the list fetch stays dormant.
  const { restore } = useProjectVersionHistory(workspaceId, projectId, {
    active: false,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!restoreVersion) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setRestoreVersion(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      prevFocusRef.current?.focus();
      prevFocusRef.current = null;
    };
  }, [restoreVersion, setRestoreVersion]);

  if (!restoreVersion || !workspaceId || !projectId) return null;

  const handleRestore = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStale(false);
    const result = await restore(restoreVersion.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "This version couldn't be restored.");
      setStale(!!result.stale);
      return;
    }
    // Server content is authoritative — reload so the restored state hydrates.
    window.location.reload();
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Restore version"
      onClick={() => setRestoreVersion(null)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
        data-testid="restore-version-dialog"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
          </span>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-text-primary">Restore this version?</h3>
            <p className="mt-1 text-sm text-text-muted">
              {reasonLabel(restoreVersion)} · {relativeTime(restoreVersion.createdAt)} · v
              {restoreVersion.revision}
            </p>
          </div>
          <button
            onClick={() => setRestoreVersion(null)}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-base px-3 py-2.5 text-xs leading-relaxed text-text-muted">
          Restoring replaces <span className="font-medium text-text-primary">{projectName}</span>{" "}
          with this older version as a <span className="font-medium text-text-primary">new version</span>.
          The current state is kept safe in your history first, and newer versions stay
          available. Any unsaved changes in this editor will be replaced.
        </div>

        {stale && (
          <div
            className="mt-3 flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-xs text-yellow-600 dark:text-yellow-400"
            data-testid="restore-stale"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span>
              This project changed while you were reviewing history.{" "}
              <button
                onClick={() => window.location.reload()}
                className="font-medium underline hover:no-underline"
                type="button"
              >
                Reload latest
              </button>
            </span>
          </div>
        )}

        {error && !stale && <p className="mt-3 text-xs text-red-400">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => setRestoreVersion(null)}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-all duration-200 hover:bg-card hover:text-text-primary"
            type="button"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={() => void handleRestore()}
            disabled={busy}
            data-testid="restore-version-confirm"
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-all duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-50"
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Restore version
          </button>
        </div>
      </div>
    </div>
  );
}
