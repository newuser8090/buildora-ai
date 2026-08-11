"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14/P16) — useWorkspaceEditorAccess
//
// Mounted once in EditorShell. Owns the workspace editor ACCESS session:
//   1. detects whether the active project is a workspace project (local cache
//      metadata, scoped by user + workspace + project)
//   2. fetches the SERVER-authoritative project and re-hydrates the editor
//      through the controller (fresh copy in IndexedDB, suppressed dirty)
//   3. resolves the current user's role
//   4. sets the editor access boundary (editable for editor/owner, read-only
//      for viewers / offline / unauthorized)
//
// Phase P16 — SIMULTANEOUS EDITING: editors/owners no longer hold an exclusive
// edit lease. The exclusive lease gates nothing for ordinary collaborative
// editing; multiple editors edit at once, and the collaboration session
// (useCollaborationSession) owns realtime sync + durable checkpoints. The P14
// lease endpoints remain for backward compatibility and are reused by the
// maintenance lock (version restore / import), which is owned by the session.
//
// Personal projects resolve to "editable" with no lease, exactly as before.
// The store starts each project open in a transient read-only "not-loaded"
// state so no mutation can slip through before access is resolved.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { getProjectController } from "@/features/persistence/services/project-controller";
import type { ProjectPersistenceAdapter } from "@/features/persistence/types";
import { useAuth } from "@/features/auth/useAuth";
import { toWorkspaceError } from "../errors";
import {
  getWorkspaceCacheMeta,
  setWorkspaceCacheMeta,
} from "../services/workspace-local-cache";
import { getWorkspaceProvider } from "../services/workspace-service";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import type {
  Workspace,
  WorkspaceError,
  WorkspaceProjectFull,
} from "../types";

// ---------------------------------------------------------------------------
// Adapter access (the controller owns the adapter singleton)
// ---------------------------------------------------------------------------

function controllerAdapter(): ProjectPersistenceAdapter | null {
  const controller = getProjectController();
  if (!controller) return null;
  // The controller's adapter is private; the dashboard already reaches it via
  // this exact accessor pattern for metadata operations.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (controller as any).adapter ?? null;
}

async function writeLocalCacheProject(
  projectId: string,
  project: Parameters<ProjectPersistenceAdapter["saveProject"]>[0]["project"],
  revision: number,
): Promise<boolean> {
  const adapter = controllerAdapter();
  if (!adapter) return false;
  const result = await adapter.saveProject({ project, revision });
  return result.success;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkspaceEditorAccess(): void {
  const { status, user } = useAuth();
  const activeProjectId = useEditorStore((s) => s.activeProjectId);
  const isHydrated = useEditorStore((s) => s.isHydrated);

  // Refs to keep per-project session state.
  const processedRef = useRef<string | null>(null);
  const activeSessionRef = useRef<{ projectId: string; workspaceId: string } | null>(null);
  const unsubStoreRef = useRef<(() => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (unsubStoreRef.current) {
      unsubStoreRef.current();
      unsubStoreRef.current = null;
    }
  }, []);

  const resetSession = useCallback(() => {
    // Capture everything synchronously BEFORE any await so a StrictMode re-run
    // (setup → cleanup → setup) sees a clean slate. The collab session's own
    // stop() resets the collab UI store, so nothing more is needed here.
    clearTimers();
    activeSessionRef.current = null;
    processedRef.current = null;
    useWorkspaceAccessStore.getState().reset();
  }, [clearTimers]);

  // -------------------------------------------------------------------------
  // Access resolution for the active project
  // -------------------------------------------------------------------------

  const resolveAccess = useCallback(
    async (projectId: string) => {
      const store = useWorkspaceAccessStore.getState();
      store.setLoading(true);
      // Transient read-only until access is resolved — no mutation can slip
      // through in the window between mount and resolution.
      store.setAccess({ mode: "readonly", reason: "not-loaded" });

      const adapter = controllerAdapter();
      const provider = getWorkspaceProvider();
      if (!adapter || !provider || !user) {
        // No backend → treat as personal (editable, no lease).
        store.setLoading(false);
        store.setAccess({ mode: "editable" });
        return;
      }

      const meta = await getWorkspaceCacheMeta(adapter, projectId);
      if (!meta || meta.userId !== user.id) {
        // Personal project (or cache owned by another account — never trust
        // another account's workspace context).
        store.setLoading(false);
        store.setAccess({ mode: "editable" });
        return;
      }

      const { workspaceId } = meta;

      // Resolve the workspace + role.
      let workspace: Workspace | undefined;
      try {
        const listing = await provider.listWorkspaces();
        workspace = [...listing.owned, ...listing.shared].find((w) => w.id === workspaceId);
      } catch {
        // Workspace list failure is handled below by the fetch result.
      }

      // Fetch the server-authoritative project.
      let full: WorkspaceProjectFull | null = null;
      let fetchError: WorkspaceError | null = null;
      try {
        const fetched = await provider.fetchWorkspaceProject(workspaceId, projectId);
        full = fetched;
      } catch (err) {
        fetchError = toWorkspaceError(err);
      }

      if (!full) {
        if (fetchError?.code === "NETWORK_FAILED" || fetchError?.code === "OFFLINE") {
          // Offline: open the local cache read-only (honest copy). The
          // collaboration session does not start while offline.
          store.setWorkspaceContext({
            workspaceId,
            workspaceName: workspace?.name ?? null,
            role: workspace?.memberRole ?? "viewer",
            serverRevision: meta.serverRevision,
          });
          store.setOffline(true);
          store.setLoading(false);
          store.setAccess({ mode: "readonly", reason: "offline" });
          return;
        }
        // Not a member / project missing → authorized read-only from cache or
        // blocked.
        store.setWorkspaceContext({
          workspaceId,
          workspaceName: workspace?.name ?? null,
          role: null,
          serverRevision: meta.serverRevision,
        });
        store.setLoading(false);
        store.setAccess({ mode: "readonly", reason: "unauthorized" });
        return;
      }

      // Write the server project to the local cache + re-hydrate through the
      // controller (suppressed dirty) so the editor shows the latest state.
      await writeLocalCacheProject(projectId, full.project, full.revision);
      const controller = getProjectController();
      if (controller) {
        await controller.discardAndOpenProject(projectId).catch(() => undefined);
      }

      activeSessionRef.current = { projectId, workspaceId };

      const role = workspace?.memberRole ?? "viewer";
      store.setWorkspaceContext({
        workspaceId,
        workspaceName: workspace?.name ?? null,
        role,
        serverRevision: full.revision,
      });
      store.setLoading(false);

      if (role === "viewer") {
        store.setAccess({ mode: "readonly", reason: "viewer" });
        return;
      }

      // Editor/owner — Phase P16: editable WITHOUT an exclusive lease. The
      // collaboration session (mounted in EditorShell) joins the room, applies
      // realtime updates, and owns durable checkpoints. Viewer keeps live
      // read-only via the same session.
      store.setAccess({ mode: "editable" });
      store.setLease(null);
      store.setLeaseHolderName(null);
      store.setOffline(false);

      // Keep the device cache metadata fresh so reopens are accurate.
      const cacheAdapter = controllerAdapter();
      if (cacheAdapter && user?.id) {
        void setWorkspaceCacheMeta(cacheAdapter, projectId, {
          workspaceId,
          userId: user.id,
          serverRevision: full.revision,
          serverUpdatedAt: new Date().toISOString(),
        });
      }
    },
    [user],
  );

  // -------------------------------------------------------------------------
  // Main lifecycle effect
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isHydrated || !activeProjectId) return;

    // Account switch / sign-out: reset everything (no remote deletion).
    if (status !== "signed-in" || !user) {
      if (processedRef.current !== null) {
        resetSession();
      }
      return;
    }

    // Resolve the project once per id. NOTE: the cleanup below must be
    // returned on EVERY run of this branch — a run that returns early after
    // the guard would replace the previously-registered cleanup with none,
    // so unmounting the editor would never release resources (React only
    // runs the cleanup of the last effect run).
    if (processedRef.current !== activeProjectId) {
      processedRef.current = activeProjectId;
      void resolveAccess(activeProjectId);
    }

    return () => {
      // Project switch / unmount: reset the access session. The collab
      // session (useCollaborationSession) tears itself down independently.
      resetSession();
    };
  }, [activeProjectId, isHydrated, status, user, resolveAccess, resetSession]);

  // Sign-out while mounted (AuthProvider changes status → cleanup above).
  useEffect(() => {
    if (status === "signed-out") {
      resetSession();
    }
  }, [status, resetSession]);
}
