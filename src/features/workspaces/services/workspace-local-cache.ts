// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — local cache
//
// Workspace projects are SERVER-AUTHORITATIVE. The device keeps a small
// cache metadata record (via the persistence adapter's generic metadata API)
// so the dashboard can label/filter projects and the editor knows how to
// route saves. This record is scoped by userId + workspaceId + projectId and
// is NEVER an authorization source (the server decides access).
// ---------------------------------------------------------------------------

import type { ProjectPersistenceAdapter } from "@/features/persistence/types";
import { DashboardMetadataService } from "@/features/projects/services/dashboard-metadata-service";
import { WORKSPACE_META_KEY } from "../constants";
import type { WorkspaceProjectCacheMeta } from "../types";

function serviceOf(adapter: ProjectPersistenceAdapter): DashboardMetadataService {
  return new DashboardMetadataService(adapter);
}

/** Read the workspace cache meta for a project (null when not a workspace project). */
export async function getWorkspaceCacheMeta(
  adapter: ProjectPersistenceAdapter,
  projectId: string,
): Promise<WorkspaceProjectCacheMeta | null> {
  try {
    const result = await adapter.getDashboardMetadata(projectId);
    if (!result.success) return null;
    const raw = result.metadata?.[WORKSPACE_META_KEY];
    if (!raw || typeof raw !== "object") return null;
    const meta = raw as WorkspaceProjectCacheMeta;
    if (
      typeof meta.workspaceId === "string" &&
      typeof meta.userId === "string" &&
      typeof meta.serverRevision === "number"
    ) {
      return meta;
    }
    return null;
  } catch {
    return null;
  }
}

/** Set (or update) the workspace cache meta for a project. */
export async function setWorkspaceCacheMeta(
  adapter: ProjectPersistenceAdapter,
  projectId: string,
  meta: WorkspaceProjectCacheMeta,
): Promise<void> {
  try {
    const current = await adapter.getDashboardMetadata(projectId);
    const metadata = current.success
      ? { ...current.metadata, [WORKSPACE_META_KEY]: meta }
      : { [WORKSPACE_META_KEY]: meta };
    await adapter.setDashboardMetadata(projectId, metadata);
  } catch {
    // Cache metadata is best-effort — a failure must never break editing.
  }
}

/** Remove the workspace cache meta (move-out / delete / copy-to-personal). */
export async function clearWorkspaceCacheMeta(
  adapter: ProjectPersistenceAdapter,
  projectId: string,
): Promise<void> {
  try {
    const current = await adapter.getDashboardMetadata(projectId);
    if (!current.success || !current.metadata) return;
    const metadata = { ...current.metadata };
    delete metadata[WORKSPACE_META_KEY];
    if (Object.keys(metadata).length === 0) {
      await serviceOf(adapter).removeMetadata(projectId);
    } else {
      await adapter.setDashboardMetadata(projectId, metadata);
    }
  } catch {
    // Best-effort.
  }
}
