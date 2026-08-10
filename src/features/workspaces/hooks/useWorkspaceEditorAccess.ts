"use client";

// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — useWorkspaceEditorAccess
//
// Mounted once in EditorShell. Owns the full workspace editor session:
//   1. detects whether the active project is a workspace project (local cache
//      metadata, scoped by user + workspace + project)
//   2. fetches the SERVER-authoritative project and re-hydrates the editor
//      through the controller (fresh copy in IndexedDB, suppressed dirty)
//   3. resolves the current user's role + the edit lease
//   4. holds/renews the lease (heartbeat) while editable
//   5. pushes debounced server saves with optimistic concurrency
//   6. detects authorization loss / stale revisions / offline and transitions
//      to a safe read-only state
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
import { recordPerf } from "@/features/perf/perf-instrumentation";
import { toWorkspaceError } from "../errors";
import {
  EDIT_LEASE_HEARTBEAT_MS,
  WORKSPACE_SAVE_DEBOUNCE_MS,
} from "../constants";
import {
  getWorkspaceCacheMeta,
  setWorkspaceCacheMeta,
} from "../services/workspace-local-cache";
import { getWorkspaceProvider } from "../services/workspace-service";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import type {
  LeaseAcquireResult,
  ProjectEditLease,
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
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaseRef = useRef<ProjectEditLease | null>(null);
  const serverRevisionRef = useRef<number | null>(null);
  const activeSessionRef = useRef<{ projectId: string; workspaceId: string } | null>(null);
  const dirtyArmedRef = useRef(false);
  const unsubStoreRef = useRef<(() => void) | null>(null);

  // -------------------------------------------------------------------------
  // Cleanup helpers
  // -------------------------------------------------------------------------

  const clearTimers = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (unsubStoreRef.current) {
      unsubStoreRef.current();
      unsubStoreRef.current = null;
    }
  }, []);

  const resetSession = useCallback(async () => {
    // Capture the lease synchronously and clear every ref BEFORE any await so
    // a StrictMode re-run (setup → cleanup → setup) sees a clean slate and
    // re-registers its own cleanup instead of discarding it.
    const lease = leaseRef.current;
    clearTimers();
    leaseRef.current = null;
    serverRevisionRef.current = null;
    activeSessionRef.current = null;
    dirtyArmedRef.current = false;
    processedRef.current = null;
    useWorkspaceAccessStore.getState().reset();
    if (!lease) return;
    const provider = getWorkspaceProvider();
    if (!provider) return;
    try {
      await provider.releaseEditLease(lease.leaseId);
    } catch {
      // Best-effort — an expired/released lease is fine.
    }
  }, [clearTimers]);

  // -------------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------------

  const startHeartbeat = useCallback(() => {
    clearTimers();
    heartbeatRef.current = setInterval(async () => {
      const lease = leaseRef.current;
      if (!lease) return;
      const provider = getWorkspaceProvider();
      if (!provider) return;
      try {
        const renewed = await provider.heartbeatEditLease(lease.leaseId);
        leaseRef.current = renewed;
      } catch {
        // Authorization loss while open → safe read-only transition (member
        // removal / role change / lease expiry) without waiting for a reload.
        clearTimers();
        leaseRef.current = null;
        useWorkspaceAccessStore.getState().setLease(null);
        useWorkspaceAccessStore.getState().setAccess({
          mode: "readonly",
          reason: "unauthorized",
        });
      }
    }, EDIT_LEASE_HEARTBEAT_MS);
  }, [clearTimers]);

  // -------------------------------------------------------------------------
  // Server save (optimistic concurrency)
  // -------------------------------------------------------------------------

  const pushServerSave = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) return;
    const store = useEditorStore.getState();
    if (!store.project || store.project.id !== session.projectId) return;
    const expectedRevision = serverRevisionRef.current;
    if (expectedRevision === null) return;

    const provider = getWorkspaceProvider();
    if (!provider) return;

    let summary;
    try {
      summary = await provider.saveWorkspaceProject({
        workspaceId: session.workspaceId,
        projectId: store.project.id,
        project: store.project,
        expectedRevision,
      });
    } catch (err) {
      const error: WorkspaceError = toWorkspaceError(err);
      if (error.code === "STALE_REVISION") {
        useWorkspaceAccessStore.getState().setSaveConflict({
          kind: "stale-revision",
          currentRevision: store.revision,
          serverRevision: expectedRevision,
        });
        return;
      }
      if (
        error.code === "PERMISSION_DENIED" ||
        error.code === "LEASE_INVALID" ||
        error.code === "SESSION_EXPIRED"
      ) {
        // Authorization loss while open → safe read-only transition.
        clearTimers();
        leaseRef.current = null;
        useWorkspaceAccessStore.getState().setLease(null);
        useWorkspaceAccessStore.getState().setAccess({
          mode: "readonly",
          reason: "unauthorized",
        });
        return;
      }
      if (error.code === "NETWORK_FAILED" || error.code === "OFFLINE") {
        useWorkspaceAccessStore.getState().setOffline(true);
      }
      return;
    }

    serverRevisionRef.current = summary.revision;
    const accessStore = useWorkspaceAccessStore.getState();
    accessStore.setWorkspaceContext({
      workspaceId: session.workspaceId,
      workspaceName: accessStore.workspaceName,
      role: accessStore.role,
      serverRevision: summary.revision,
    });
    recordPerf("workspace_project_saved", 0, { count: 1 });

    // Keep the device cache metadata fresh so reopens are accurate.
    const adapter = controllerAdapter();
    if (adapter && user?.id) {
      void setWorkspaceCacheMeta(adapter, store.project.id, {
        workspaceId: session.workspaceId,
        userId: user.id,
        serverRevision: summary.revision,
        serverUpdatedAt: new Date().toISOString(),
      });
    }
  }, [user, clearTimers]);

  const subscribeToSaves = useCallback(() => {
    if (unsubStoreRef.current) {
      unsubStoreRef.current();
      unsubStoreRef.current = null;
    }
    unsubStoreRef.current = useEditorStore.subscribe((state) => {
      const session = activeSessionRef.current;
      if (!session) return;
      if (state.project.id !== session.projectId) return;

      // Arm on the first real edit (dirty), then debounce-push once.
      if (state.isDirty) {
        if (!dirtyArmedRef.current) {
          dirtyArmedRef.current = true;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            dirtyArmedRef.current = false;
            void pushServerSave();
          }, WORKSPACE_SAVE_DEBOUNCE_MS);
        }
        return;
      }
      // Clean (markSaved) → re-arm for the next edit.
      dirtyArmedRef.current = false;
    });
  }, [pushServerSave]);

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
          // Offline: open the local cache read-only (honest copy).
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

      serverRevisionRef.current = full.revision;
      activeSessionRef.current = { projectId, workspaceId };
      dirtyArmedRef.current = false;

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

      // Editor/owner: resolve the lease.
      let lease: ProjectEditLease | null = null;
      try {
        lease = await provider.getEditLease(workspaceId, projectId);
      } catch {
        lease = null;
      }
      if (lease && lease.userId === user.id) {
        leaseRef.current = lease;
        store.setLease(lease);
        store.setAccess({ mode: "editable" });
        startHeartbeat();
        subscribeToSaves();
        return;
      }
      if (lease && lease.userId !== user.id) {
        store.setLease(null);
        store.setLeaseHolderName(holderNameOf(lease));
        store.setAccess({ mode: "readonly", reason: "being-edited" });
        return;
      }

      let acquired: LeaseAcquireResult | null = null;
      try {
        acquired = await provider.acquireEditLease(workspaceId, projectId);
      } catch {
        acquired = null;
      }
      if (acquired && acquired.ok) {
        leaseRef.current = acquired.lease;
        store.setLease(acquired.lease);
        store.setAccess({ mode: "editable" });
        recordPerf("workspace_lease_acquired", 0, { count: 1 });
        startHeartbeat();
        subscribeToSaves();
        return;
      }
      if (acquired && !acquired.ok && acquired.code === "LEASE_HELD") {
        store.setLease(null);
        store.setLeaseHolderName(holderNameOf(acquired.lease));
        store.setAccess({ mode: "readonly", reason: "being-edited" });
        recordPerf("workspace_lease_blocked", 0, { count: 1 });
        return;
      }

      // Lease acquisition failed (offline/permission) → read-only.
      store.setLease(null);
      store.setAccess({ mode: "readonly", reason: "unauthorized" });
    },
    [startHeartbeat, subscribeToSaves, user],
  );

  // -------------------------------------------------------------------------
  // Main lifecycle effect
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!isHydrated || !activeProjectId) return;

    // Account switch / sign-out: reset everything (no remote deletion).
    if (status !== "signed-in" || !user) {
      if (processedRef.current !== null) {
        void resetSession();
      }
      return;
    }

    // Resolve the project once per id. NOTE: the cleanup below must be
    // returned on EVERY run of this branch — a run that returns early after
    // the guard would replace the previously-registered cleanup with none,
    // so unmounting the editor would never release the edit lease (React
    // only runs the cleanup of the last effect run).
    if (processedRef.current !== activeProjectId) {
      processedRef.current = activeProjectId;
      void resolveAccess(activeProjectId);
    }

    return () => {
      // Project switch / unmount: release the lease best-effort and reset.
      void resetSession();
    };
  }, [activeProjectId, isHydrated, status, user, resolveAccess, resetSession]);

  // Sign-out while mounted (AuthProvider changes status → cleanup above).
  useEffect(() => {
    if (status === "signed-out") {
      void resetSession();
    }
  }, [status, resetSession]);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Best-effort display name for a lease holder (same-workspace member). */
function holderNameOf(lease: ProjectEditLease): string {
  // Lease holder emails are only surfaced to members of the same workspace
  // (server-populated). Fall back to a friendly generic label.
  return lease.holderEmail ? emailToName(lease.holderEmail) : "another teammate";
}

function emailToName(email: string): string {
  const local = email.split("@")[0] ?? "";
  if (!local) return "another teammate";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return local;
  return parts
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

