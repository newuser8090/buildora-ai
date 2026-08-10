"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — useWorkspaceDashboard
//
// Wires the workspace dashboard store to the service layer:
//   - lazy-fetches workspaces + invitations ONLY when signed in (the personal
//     dashboard never depends on workspace network calls)
//   - manages the selected workspace + its project listing
//   - exposes workspace actions (create, invite, accept, move, open)
//
// All authorization is server-enforced; this hook only surfaces results.
// ---------------------------------------------------------------------------

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/useAuth";
import { getProjectController } from "@/features/persistence/services/project-controller";
import {
  getWorkspaceProvider,
  WorkspaceService,
  workspaceBackendAvailable,
} from "../services/workspace-service";
import { setWorkspaceCacheMeta } from "../services/workspace-local-cache";
import { useWorkspaceDashboardStore } from "../store/workspace-dashboard-store";
import type {
  Workspace,
  WorkspaceProjectFull,
  WorkspaceProjectSummary,
  WorkspaceResult,
} from "../types";

function providerAvailable(): boolean {
  return workspaceBackendAvailable();
}

export function useWorkspaceDashboard() {
  const router = useRouter();
  const { status, user } = useAuth();
  const store = useWorkspaceDashboardStore;

  // Load workspaces + invitations once per sign-in (lazy — never blocks the
  // personal dashboard; personal loads happen even when the workspace backend
  // is down or the user is signed out).
  useEffect(() => {
    if (status !== "signed-in" || !user) {
      // Sign-out / account switch → never leak one account's workspace context
      // into the next session.
      store.getState().reset();
      return;
    }
    if (!providerAvailable()) {
      store.getState().setUnavailable(true);
      store.getState().setLoading(false);
      return;
    }
    let cancelled = false;
    const provider = getWorkspaceProvider();
    if (!provider) {
      store.getState().setUnavailable(true);
      store.getState().setLoading(false);
      return;
    }
    const service = new WorkspaceService(provider);
    store.getState().setLoading(true);
    store.getState().setUnavailable(false);
    void (async () => {
      const [listing, invitations] = await Promise.all([
        service.listWorkspaces(),
        service.listInvitations(),
      ]);
      if (cancelled) return;
      if (listing.ok) {
        store.getState().setWorkspaces(listing.value.owned, listing.value.shared);
      } else {
        store.getState().setError(listing.error.message);
      }
      if (invitations.ok) {
        store.getState().setInvitations(invitations.value);
      }
      store.getState().setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.id]);

  // Load the selected workspace's projects whenever the selection changes.
  const selectedWorkspaceId = useWorkspaceDashboardStore((s) => s.selectedWorkspaceId);
  useEffect(() => {
    if (!selectedWorkspaceId) {
      store.getState().setWorkspaceProjects([]);
      return;
    }
    const provider = getWorkspaceProvider();
    if (!provider) return;
    let cancelled = false;
    const service = new WorkspaceService(provider);
    store.getState().setLoading(true);
    void (async () => {
      const result = await service.listWorkspaceProjects(selectedWorkspaceId);
      if (cancelled) return;
      if (result.ok) {
        store.getState().setWorkspaceProjects(result.value);
        store.getState().setError(null);
      } else {
        store.getState().setWorkspaceProjects([]);
        store.getState().setError(result.error.message);
      }
      store.getState().setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkspaceId]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const selectWorkspace = useCallback((id: string | null) => {
    store.getState().setSelectedWorkspaceId(id);
  }, [store]);

  const reloadWorkspaces = useCallback(async () => {
    const provider = getWorkspaceProvider();
    if (!provider) return;
    const service = new WorkspaceService(provider);
    const [listing, invitations] = await Promise.all([
      service.listWorkspaces(),
      service.listInvitations(),
    ]);
    if (listing.ok) {
      store.getState().setWorkspaces(listing.value.owned, listing.value.shared);
    }
    if (invitations.ok) {
      store.getState().setInvitations(invitations.value);
    }
  }, [store]);

  const createWorkspace = useCallback(
    async (name: string): Promise<WorkspaceResult<Workspace>> => {
      const provider = getWorkspaceProvider();
      if (!provider) {
        return {
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "Workspaces aren't set up for this app yet.", retryable: false },
        };
      }
      const service = new WorkspaceService(provider);
      const result = await service.createWorkspace(name);
      if (result.ok) {
        await reloadWorkspaces();
        store.getState().setSelectedWorkspaceId(result.value.id);
      }
      return result;
    },
    [reloadWorkspaces, store],
  );

  const acceptInvitation = useCallback(
    async (invitationId: string): Promise<boolean> => {
      const provider = getWorkspaceProvider();
      if (!provider) return false;
      const service = new WorkspaceService(provider);
      const result = await service.acceptInvitation(invitationId);
      if (result.ok) {
        await reloadWorkspaces();
      }
      return result.ok;
    },
    [reloadWorkspaces],
  );

  const revokeInvitation = useCallback(
    async (invitationId: string): Promise<boolean> => {
      const provider = getWorkspaceProvider();
      if (!provider) return false;
      const service = new WorkspaceService(provider);
      const result = await service.revokeInvitation(invitationId);
      if (result.ok) await reloadWorkspaces();
      return result.ok;
    },
    [reloadWorkspaces],
  );

  /**
   * Open a workspace project: fetch the server-authoritative project, write a
   * local cache copy (fresh id-scoped record), then navigate to the editor.
   * The editor's useWorkspaceEditorAccess re-validates access + lease.
   */
  const openWorkspaceProject = useCallback(
    async (workspaceId: string, projectId: string): Promise<WorkspaceResult<WorkspaceProjectFull>> => {
      const provider = getWorkspaceProvider();
      if (!provider) {
        return {
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "Workspaces aren't set up for this app yet.", retryable: false },
        };
      }
      const service = new WorkspaceService(provider);
      const result = await service.fetchWorkspaceProject(workspaceId, projectId);
      if (!result.ok) return result;

      // Write the local cache copy so the editor's controller can open it.
      const controller = getProjectController();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = (controller as any)?.adapter ?? null;
      if (adapter && user) {
        const saved = await adapter.saveProject({
          project: result.value.project,
          revision: result.value.revision,
        });
        if (saved.success) {
          await setWorkspaceCacheMeta(adapter, projectId, {
            workspaceId,
            userId: user.id,
            serverRevision: result.value.revision,
            serverUpdatedAt: result.value.updatedAt,
          });
        }
      }
      router.push(`/editor/${projectId}`);
      return result;
    },
    [router, user],
  );

  /** Move a personal project into a workspace (create-on-server + cache meta). */
  const moveProjectToWorkspace = useCallback(
    async (
      workspaceId: string,
      projectId: string,
      project: unknown,
      name: string,
    ): Promise<WorkspaceResult<WorkspaceProjectSummary>> => {
      const provider = getWorkspaceProvider();
      if (!provider) {
        return {
          ok: false,
          error: { code: "NOT_CONFIGURED", message: "Workspaces aren't set up for this app yet.", retryable: false },
        };
      }
      const service = new WorkspaceService(provider);
      const result = await service.createWorkspaceProject(workspaceId, {
        projectId,
        name,
        project,
      });
      if (!result.ok) return result;

      // Mark the local copy as a workspace cache (server-authoritative).
      const controller = getProjectController();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const adapter = (controller as any)?.adapter ?? null;
      if (adapter && user) {
        await setWorkspaceCacheMeta(adapter, projectId, {
          workspaceId,
          userId: user.id,
          serverRevision: result.value.revision,
          serverUpdatedAt: result.value.updatedAt,
        });
      }
      // Refresh the workspace project list + select it (covers create-in-
      // workspace where the workspace is already selected — the selection
      // effect alone would not re-run).
      store.getState().setSelectedWorkspaceId(workspaceId);
      const listResult = await service.listWorkspaceProjects(workspaceId);
      if (listResult.ok) {
        store.getState().setWorkspaceProjects(listResult.value);
      }
      return result;
    },
    [store, user],
  );

  /** Refresh the project list for the currently selected workspace. */
  const refreshSelectedWorkspaceProjects = useCallback(async () => {
    const workspaceId = store.getState().selectedWorkspaceId;
    if (!workspaceId) return;
    const provider = getWorkspaceProvider();
    if (!provider) return;
    const service = new WorkspaceService(provider);
    const result = await service.listWorkspaceProjects(workspaceId);
    if (result.ok) {
      store.getState().setWorkspaceProjects(result.value);
    }
  }, [store]);

  /** Load the FULL project for a personal project (for move-to-workspace). */
  const loadPersonalProject = useCallback(
    async (projectId: string): Promise<{ ok: boolean; project?: unknown; error?: string }> => {
      const controller = getProjectController();
      if (!controller) return { ok: false, error: "Controller not initialized" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loadResult = await (controller as any).adapter.loadProject(projectId);
      if (loadResult.success) return { ok: true, project: loadResult.project };
      return { ok: false, error: loadResult.error?.message ?? "Failed to load project" };
    },
    [],
  );

  return {
    selectedWorkspaceId,
    owned: useWorkspaceDashboardStore((s) => s.owned),
    shared: useWorkspaceDashboardStore((s) => s.shared),
    invitations: useWorkspaceDashboardStore((s) => s.invitations),
    workspaceProjects: useWorkspaceDashboardStore((s) => s.workspaceProjects),
    loading: useWorkspaceDashboardStore((s) => s.loading),
    error: useWorkspaceDashboardStore((s) => s.error),
    unavailable: useWorkspaceDashboardStore((s) => s.unavailable),
    selectWorkspace,
    reloadWorkspaces,
    createWorkspace,
    acceptInvitation,
    revokeInvitation,
    openWorkspaceProject,
    moveProjectToWorkspace,
    refreshSelectedWorkspaceProjects,
    loadPersonalProject,
  };
}
