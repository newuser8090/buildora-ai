"use client";

// ---------------------------------------------------------------------------
// Phase P15 — useProjectVersionHistory
//
// Client bridge between the version-history UI and WorkspaceService. Scoped to
// the active workspace project. Restore uses the P14 server revision as the
// expectedRevision (optimistic concurrency) so a stale restore can never
// overwrite newer server state. Copy-to-personal reuses the project controller
// for a fresh personal project (payload snapshots are Project-shaped only).
//
// The version LIST is gated by `opts.active`: the dialog that shows the list
// is always mounted in the editor (it renders nothing while closed), so an
// ungated "fetch on mount" would capture the list BEFORE the first save ever
// exists and then never refresh. Fetching only while `active` makes every
// dialog open a fresh fetch — the list always reflects the current server
// timeline (newest versions appear as soon as the dialog is opened).
//
// Concurrency: every fetch bumps a request sequence; a response only commits
// if it is still the latest request. The scope key + effect cleanup ensure an
// in-flight older fetch can never commit after a project switch. The
// effect-driven fetch is an inline async IIFE (state commits after the awaited
// call — the same pattern as the P14 settings dialog); `reload` (with its
// synchronous loading flip) is only ever called from event handlers.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { getProjectController } from "@/features/persistence/services/project-controller";
import { useRouter } from "next/navigation";
import { getWorkspaceProvider } from "../services/workspace-service";
import { WorkspaceService } from "../services/workspace-service";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import type { ProjectVersionMeta } from "../types";

export interface CopyResult {
  ok: boolean;
  error?: string;
  /** Set when the copy was created as a personal project (navigate there). */
  projectId?: string;
}

export function useProjectVersionHistory(
  workspaceId: string | null,
  projectId: string | null,
  opts?: { active?: boolean },
) {
  const router = useRouter();
  // When false, the version-list effect is dormant (no fetch) — used by the
  // history dialog so the list is fetched fresh on EVERY open instead of once
  // at editor mount (see header comment). Other consumers default to active.
  const active = opts?.active ?? true;
  const scopeKey = workspaceId && projectId ? `${workspaceId}:${projectId}` : "";

  const [versions, setVersions] = useState<ProjectVersionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The scope the currently-committed data belongs to. Data is only exposed
  // for the matching scope, so a project switch never shows stale versions.
  const [loadedScope, setLoadedScope] = useState("");
  // Monotonic request sequence: an in-flight fetch that gets superseded by a
  // newer one (scope change) must never commit its stale response.
  const requestSeqRef = useRef(0);

  const service = (): WorkspaceService | null => {
    const provider = getWorkspaceProvider();
    return provider ? new WorkspaceService(provider) : null;
  };

  // Fetch on mount/scope change. Inline async IIFE (P14 pattern): all state
  // commits happen after the awaited fetch, so the effect body itself has no
  // synchronous setState. The cleanup invalidates any in-flight fetch so a
  // stale scope can't commit after a switch/unmount.
  useEffect(() => {
    if (!workspaceId || !projectId || !active) return;
    let cancelled = false;
    void (async () => {
      const svc = service();
      if (!svc) return;
      const seq = ++requestSeqRef.current;
      const result = await svc.listProjectVersions(workspaceId, projectId);
      if (cancelled || seq !== requestSeqRef.current) return;
      setLoadedScope(scopeKey);
      if (result.ok) {
        setVersions(result.value);
        setError(null);
      } else {
        setError(result.error.message);
      }
    })();
    return () => {
      cancelled = true;
      requestSeqRef.current += 1;
    };
  }, [workspaceId, projectId, scopeKey, active]);

  // Event-handler refresh (checkpoint creation): the synchronous loading flip
  // is fine here — reload is only ever called from event handlers, never from
  // an effect.
  const reload = useCallback(async () => {
    if (!workspaceId || !projectId) return;
    const svc = service();
    if (!svc) return;
    setLoading(true);
    setError(null);
    const seq = ++requestSeqRef.current;
    const result = await svc.listProjectVersions(workspaceId, projectId);
    if (seq !== requestSeqRef.current) return;
    setLoadedScope(scopeKey);
    if (result.ok) {
      setVersions(result.value);
      setError(null);
    } else {
      setError(result.error.message);
    }
    setLoading(false);
  }, [workspaceId, projectId, scopeKey]);

  // Derived display values: stale-scope data is never shown.
  const visibleVersions = loadedScope === scopeKey ? versions : [];
  const visibleLoading = loading || (loadedScope !== scopeKey && scopeKey !== "");
  const visibleError = loadedScope === scopeKey ? error : null;

  /** Manual checkpoint of the current server content (editor/owner). */
  const createCheckpoint = useCallback(
    async (label?: string): Promise<{ ok: boolean; error?: string }> => {
      if (!workspaceId || !projectId) return { ok: false, error: "No project open." };
      const svc = service();
      if (!svc) return { ok: false, error: "Workspaces aren't set up." };
      const result = await svc.createManualVersion(workspaceId, projectId, label);
      if (!result.ok) return { ok: false, error: result.error.message };
      await reload();
      return { ok: true };
    },
    [workspaceId, projectId, reload],
  );

  /** Restore a version as a NEW revision (owner-only; stale-restore safe). */
  const restore = useCallback(
    async (versionId: string): Promise<{ ok: boolean; error?: string; stale?: boolean }> => {
      if (!workspaceId || !projectId) return { ok: false, error: "No project open." };
      const svc = service();
      if (!svc) return { ok: false, error: "Workspaces aren't set up." };
      const expectedRevision = useWorkspaceAccessStore.getState().serverRevision;
      if (expectedRevision === null) {
        return { ok: false, error: "This project isn't ready to restore yet." };
      }
      const result = await svc.restoreProjectVersion(
        workspaceId,
        projectId,
        versionId,
        expectedRevision,
      );
      if (!result.ok) {
        return {
          ok: false,
          error: result.error.message,
          stale: result.error.code === "STALE_REVISION",
        };
      }
      return { ok: true };
    },
    [workspaceId, projectId],
  );

  /** Copy a version's content into the SAME workspace (fresh identity). */
  const copyToWorkspace = useCallback(
    async (version: ProjectVersionMeta, name: string): Promise<{ ok: boolean; error?: string }> => {
      if (!workspaceId || !projectId) return { ok: false, error: "No project open." };
      const svc = service();
      if (!svc) return { ok: false, error: "Workspaces aren't set up." };
      const newProjectId = `ws-copy-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      const result = await svc.copyProjectFromVersion(
        workspaceId,
        projectId,
        version.id,
        newProjectId,
        name,
      );
      if (!result.ok) return { ok: false, error: result.error.message };
      return { ok: true };
    },
    [workspaceId, projectId],
  );

  /** Copy a version's content into a fresh PERSONAL project. */
  const copyToPersonal = useCallback(
    async (version: ProjectVersionMeta, name: string): Promise<CopyResult> => {
      if (!workspaceId || !projectId) return { ok: false, error: "No project open." };
      const svc = service();
      if (!svc) return { ok: false, error: "Workspaces aren't set up." };
      const full = await svc.fetchProjectVersion(workspaceId, projectId, version.id);
      if (!full.ok) return { ok: false, error: full.error.message };
      const controller = getProjectController();
      if (!controller) {
        return { ok: false, error: "Editor isn't ready yet. Try again." };
      }
      const created = await controller.createProjectFromPayload(full.value.project, name);
      if (!created.success) {
        return {
          ok: false,
          error: created.error?.message ?? "Couldn't create the copy.",
        };
      }
      if (!created.data) {
        return { ok: false, error: "Couldn't create the copy." };
      }
      return { ok: true, projectId: created.data.projectId };
    },
    [workspaceId, projectId],
  );

  /** Open a personal copy in the editor. */
  const openPersonalCopy = useCallback(
    (createdProjectId: string) => {
      router.push(`/editor/${createdProjectId}`);
    },
    [router],
  );

  return {
    versions: visibleVersions,
    loading: visibleLoading,
    error: visibleError,
    reload,
    createCheckpoint,
    restore,
    copyToWorkspace,
    copyToPersonal,
    openPersonalCopy,
  };
}
