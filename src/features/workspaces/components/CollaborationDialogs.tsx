"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — CollaborationDialogs
//
// Editor-mounted dialogs for the collaboration session:
//   1. "Being edited" blocker — someone else holds the edit lease. The user
//      may open read-only, retry (wait for expiry), or go back.
//   2. Stale-revision save conflict — the server copy moved on since this
//      editor session opened; never overwrite silently.
//   3. Read-only banner — a persistent, non-modal notice for viewers /
//      blocked / offline sessions.
//
// Keyboard-accessible (Escape closes what is closable), beginner-friendly.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { Eye, RefreshCw, ArrowLeft, AlertTriangle, WifiOff, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import { getWorkspaceProvider, WorkspaceService } from "../services/workspace-service";
import { getProjectController } from "@/features/persistence/services/project-controller";
import type { WorkspaceProjectFull } from "../types";

export function CollaborationDialogs() {
  const router = useRouter();
  const access = useWorkspaceAccessStore((s) => s.access);
  const leaseHolderName = useWorkspaceAccessStore((s) => s.leaseHolderName);
  const saveConflict = useWorkspaceAccessStore((s) => s.saveConflict);
  const offline = useWorkspaceAccessStore((s) => s.offline);
  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);
  const workspaceName = useWorkspaceAccessStore((s) => s.workspaceName);
  const activeProjectId = useEditorStore((s) => s.activeProjectId);

  const [retrying, setRetrying] = useState(false);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);
  const [savingConflict, setSavingConflict] = useState(false);

  const beingEdited = access.mode === "readonly" && access.reason === "being-edited";
  const showReadonlyBanner =
    access.mode === "readonly" &&
    (access.reason === "viewer" ||
      access.reason === "offline" ||
      access.reason === "unauthorized") &&
    !beingEdited;

  // Close conflict dialog on Escape when idle.
  useEffect(() => {
    if (!saveConflict) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !savingConflict) {
        useWorkspaceAccessStore.getState().setSaveConflict(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveConflict, savingConflict]);

  // ---- Retry lease acquisition (take over after expiry) ----
  const handleRetry = useCallback(async () => {
    if (!workspaceId || !activeProjectId) return;
    setRetrying(true);
    setTakeoverError(null);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setRetrying(false);
      return;
    }
    const service = new WorkspaceService(provider);
    const result = await service.acquireEditLease(workspaceId, activeProjectId);
    if (result.ok && result.value.ok) {
      // Lease acquired — the access hook re-resolves on project reload. Reload
      // the server project so the editor becomes fully editable.
      const fetched = await service.fetchWorkspaceProject(workspaceId, activeProjectId);
      if (fetched.ok) {
        await writeServerProjectToEditor(fetched.value);
      }
      // Re-run access resolution by reloading the page (simplest, honest path).
      window.location.reload();
      return;
    }
    setTakeoverError(
      result.ok
        ? "Someone is still editing this project. You can open it read-only, or try again shortly."
        : result.error.message,
    );
    setRetrying(false);
  }, [workspaceId, activeProjectId]);

  // ---- Open read-only: dismiss the blocker and stay (already read-only). ----
  const handleOpenReadOnly = useCallback(() => {
    // Transition from the being-edited blocker to the persistent read-only
    // banner (reason "viewer" copy — "a workspace editor must make changes"
    // is accurate whether the blocker is a lease holder or a viewer role).
    useWorkspaceAccessStore.getState().setLeaseHolderName(null);
    useWorkspaceAccessStore.getState().setAccess({
      mode: "readonly",
      reason: "viewer",
    });
  }, []);

  const handleBack = useCallback(() => {
    router.push("/");
  }, [router]);

  // ---- Stale revision: reload the latest server copy ----
  const handleReloadLatest = useCallback(async () => {
    if (!workspaceId || !activeProjectId) return;
    setSavingConflict(true);
    const provider = getWorkspaceProvider();
    if (!provider) {
      setSavingConflict(false);
      return;
    }
    const service = new WorkspaceService(provider);
    const fetched = await service.fetchWorkspaceProject(workspaceId, activeProjectId);
    setSavingConflict(false);
    if (fetched.ok) {
      await writeServerProjectToEditor(fetched.value);
      window.location.reload();
    } else {
      useWorkspaceAccessStore.getState().setSaveConflict({
        kind: "stale-revision",
        currentRevision: useEditorStore.getState().revision,
        serverRevision: 0,
      });
    }
  }, [workspaceId, activeProjectId]);

  // ---- Save a personal copy instead (copy-on-conflict) ----
  const handleSavePersonalCopy = useCallback(async () => {
    const editor = useEditorStore.getState();
    if (!editor.project.id) return;
    const controller = getProjectController();
    if (!controller) return;
    // Copy the current in-memory project under a fresh id.
    const fresh = {
      ...editor.project,
      id: `copy-${Date.now().toString(36)}`,
      name: `${editor.project.name} Copy`,
    };
    const saved = await (controller as unknown as { adapter: { saveProject: (req: { project: unknown; revision: number }) => Promise<{ success: boolean }> } }).adapter.saveProject({
      project: fresh,
      revision: 1,
    });
    if (saved.success) {
      useWorkspaceAccessStore.getState().setSaveConflict(null);
      router.push(`/editor/${fresh.id}`);
    } else {
      useWorkspaceAccessStore.getState().setSaveConflict({
        kind: "stale-revision",
        currentRevision: editor.revision,
        serverRevision: useWorkspaceAccessStore.getState().serverRevision ?? 0,
      });
    }
  }, [router]);

  const bannerText = offline
    ? "You're offline. Shared projects are read-only until you reconnect."
    : access.reason === "viewer"
      ? "You're viewing this project read-only. Ask a workspace editor to make changes."
      : access.reason === "unauthorized"
        ? "Your access to this project was removed. You can view it, but changes can't be saved."
        : null;

  return (
    <>
      {/* Read-only banner (non-modal) */}
      {showReadonlyBanner && bannerText && (
        <div
          role="status"
          data-testid="workspace-readonly-banner"
          className="flex items-center gap-2 border-b border-yellow-500/20 bg-yellow-500/[0.08] px-4 py-2 text-xs text-yellow-600 dark:text-yellow-400"
        >
          {offline ? <WifiOff className="h-3.5 w-3.5 flex-shrink-0" /> : <Eye className="h-3.5 w-3.5 flex-shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{bannerText}</span>
          {access.reason === "unauthorized" && (
            <button
              onClick={handleBack}
              className="flex-shrink-0 font-medium text-yellow-700 underline-offset-2 hover:underline dark:text-yellow-300"
              type="button"
            >
              Back to dashboard
            </button>
          )}
        </div>
      )}

      {/* Being-edited blocker */}
      {beingEdited && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collab-being-edited-title"
          data-testid="workspace-being-edited-dialog"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <Users className="h-5 w-5 text-amber-500" />
              </div>
              <div className="min-w-0">
                <h2 id="collab-being-edited-title" className="text-base font-semibold text-text-primary">
                  Currently being edited
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                  {leaseHolderName ? (
                    <>
                      <span className="font-medium text-text-primary">{leaseHolderName}</span>{" "}
                      is editing this project right now.
                    </>
                  ) : (
                    "Someone is editing this project right now."
                  )}{" "}
                  To avoid two people overwriting each other, it&apos;s open
                  read-only until they finish.
                </p>
              </div>
            </div>

            {takeoverError && (
              <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400" data-testid="workspace-lease-error">
                {takeoverError}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={handleBack}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                type="button"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to dashboard
              </button>
              <button
                onClick={handleOpenReadOnly}
                data-testid="workspace-open-readonly"
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary"
                type="button"
              >
                <Eye className="h-3.5 w-3.5" />
                Open read-only
              </button>
              <button
                onClick={() => void handleRetry()}
                disabled={retrying}
                data-testid="workspace-retry-lease"
                className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                type="button"
              >
                {retrying ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {retrying ? "Trying…" : "Try again"}
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-text-dim">
              {workspaceName ? `In “${workspaceName}”` : "Workspace project"} · editing is
              handed over automatically when the other editor leaves or their session expires.
            </p>
          </div>
        </div>
      )}

      {/* Stale-revision save conflict */}
      {saveConflict && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collab-save-conflict-title"
          data-testid="workspace-save-conflict-dialog"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-elevated">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <h2 id="collab-save-conflict-title" className="text-base font-semibold text-text-primary">
                  This project changed since you opened it
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
                  Someone else saved a newer version while you were editing.
                  Your changes weren&apos;t overwritten — choose what happens next.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => void handleReloadLatest()}
                disabled={savingConflict}
                data-testid="workspace-reload-latest"
                className="flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                type="button"
              >
                {savingConflict ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Reload the latest version
              </button>
              <button
                onClick={() => void handleSavePersonalCopy()}
                disabled={savingConflict}
                data-testid="workspace-save-personal-copy"
                className="flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
                type="button"
              >
                Save my version as a personal copy
              </button>
              <button
                onClick={() => useWorkspaceAccessStore.getState().setSaveConflict(null)}
                disabled={savingConflict}
                className="flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-50"
                type="button"
              >
                Keep editing anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Write a fetched server project into the editor via the controller. */
async function writeServerProjectToEditor(full: WorkspaceProjectFull): Promise<void> {
  const controller = getProjectController();
  if (!controller) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = (controller as any).adapter;
  if (!adapter) return;
  try {
    const saved = await adapter.saveProject({
      project: full.project,
      revision: full.revision,
    });
    if (saved.success) {
      await controller.discardAndOpenProject(full.projectId).catch(() => undefined);
    }
  } catch {
    // Best-effort — the reload path surfaces failures via the conflict dialog.
  }
}
