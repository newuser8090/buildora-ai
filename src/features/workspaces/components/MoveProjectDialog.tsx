"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — MoveProjectDialog
//
// Moves a PERSONAL project into a workspace (controlled flow):
//   1. choose the destination workspace (owner/editor — creation permission)
//   2. confirm (never silent)
//   3. load the full project locally, create it on the server with a fresh
//      workspace record (same project id; server-authoritative)
//   4. the local copy becomes a workspace cache (routed to server saves)
//
// Only workspaces where the user can create projects are offered. The local
// project remains intact if the server call fails (nothing is deleted).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { X, FolderInput, Loader2, AlertTriangle } from "lucide-react";
import { getProjectController } from "@/features/persistence/services/project-controller";
import { useAuthStore } from "@/features/auth/auth-store";
import { useWorkspaceDashboardStore } from "../store/workspace-dashboard-store";
import { getWorkspaceProvider, WorkspaceService } from "../services/workspace-service";
import { setWorkspaceCacheMeta } from "../services/workspace-local-cache";
import { canCreateProjects } from "../permissions/workspace-permissions";
import type { Workspace } from "../types";

export interface MoveProjectDialogProps {
  open: boolean;
  projectId: string;
  projectName: string;
  /** Loads the full personal project (returns the project object). */
  onLoadProject: (projectId: string) => Promise<{ ok: boolean; project?: unknown; error?: string }>;
  onClose: () => void;
  onMoved: (workspaceId: string) => void;
}

export function MoveProjectDialog({
  open,
  projectId,
  projectName,
  onLoadProject,
  onClose,
  onMoved,
}: MoveProjectDialogProps) {
  const owned = useWorkspaceDashboardStore((s) => s.owned);
  const shared = useWorkspaceDashboardStore((s) => s.shared);

  // Eligible destinations: workspaces where this user can create projects.
  const destinations: Workspace[] = [...owned, ...shared].filter((w) =>
    canCreateProjects(w.memberRole ?? "viewer"),
  );

  // Default to the first eligible destination. Initialized lazily so the
  // dialog also works when mounted directly in the open state (the app mounts
  // it closed and toggles open — both paths are covered).
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>(
    () => destinations[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);

  // Reset per open — adjust state during render (React's documented
  // "derive state from props" pattern) instead of an effect, so the reset
  // happens before commit and can't cause cascading renders.
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setTargetWorkspaceId(destinations[0]?.id ?? "");
      setError(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  const handleMove = useCallback(async () => {
    if (busy || !targetWorkspaceId) return;
    setBusy(true);
    setError(null);

    const loaded = await onLoadProject(projectId);
    if (!loaded.ok || loaded.project === undefined) {
      setError(loaded.error ?? "Couldn't load this project to move it.");
      setBusy(false);
      return;
    }

    const provider = getWorkspaceProvider();
    if (!provider) {
      setError("Workspaces aren't set up for this app yet.");
      setBusy(false);
      return;
    }
    const service = new WorkspaceService(provider);
    const name =
      loaded.project && typeof loaded.project === "object" && "name" in loaded.project &&
      typeof (loaded.project as { name?: unknown }).name === "string"
        ? (loaded.project as { name: string }).name
        : projectName;

    const result = await service.createWorkspaceProject(targetWorkspaceId, {
      projectId,
      name,
      project: loaded.project,
    });
    if (!result.ok) {
      setError(result.error.message);
      setBusy(false);
      return;
    }

    // Mark the local copy as a workspace cache (server-authoritative).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapter = (getProjectController() as any)?.adapter ?? null;
    const userId = useAuthStore.getState().session?.user?.id ?? null;
    if (adapter && userId) {
      // Best-effort cache metadata — never blocks the move.
      void setWorkspaceCacheMeta(adapter, projectId, {
        workspaceId: targetWorkspaceId,
        userId,
        serverRevision: result.value.revision,
        serverUpdatedAt: result.value.updatedAt,
      }).catch(() => undefined);
    }
    setBusy(false);
    onMoved(targetWorkspaceId);
    onClose();
  }, [busy, targetWorkspaceId, projectId, projectName, onLoadProject, onMoved, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-project-title"
      data-testid="move-project-dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-elevated">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent/10">
            <FolderInput className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="move-project-title" className="text-base font-semibold text-text-primary">
              Move to workspace
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              <span className="font-medium text-text-primary">&quot;{projectName}&quot;</span>{" "}
              will be shared with everyone in the workspace you choose. Teammates
              with edit access will be able to edit it.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close move dialog"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-text-dim transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4">
          <label htmlFor="move-workspace-select" className="block text-xs font-medium text-text-primary">
            Move into
          </label>
          {destinations.length === 0 ? (
            <p className="mt-2 text-xs text-text-muted">
              You don&apos;t have any workspaces where you can create projects yet.
            </p>
          ) : (
            <select
              id="move-workspace-select"
              value={targetWorkspaceId}
              onChange={(e) => setTargetWorkspaceId(e.target.value)}
              disabled={busy}
              data-testid="move-workspace-select"
              className="mt-1.5 h-9 w-full rounded-lg border border-border bg-base px-2.5 text-sm text-text-primary focus:border-accent/40 focus:outline-none"
            >
              {destinations.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.memberRole === "owner" ? "owner" : "editor"})
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400"
            data-testid="move-project-error"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex h-9 items-center rounded-lg border border-border px-4 text-sm font-medium text-text-muted transition-colors hover:bg-card hover:text-text-primary disabled:opacity-40"
            type="button"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleMove()}
            disabled={busy || destinations.length === 0 || !targetWorkspaceId}
            data-testid="move-project-confirm"
            className="flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            type="button"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderInput className="h-4 w-4" />}
            {busy ? "Moving…" : "Move project"}
          </button>
        </div>
      </div>
    </div>
  );
}
