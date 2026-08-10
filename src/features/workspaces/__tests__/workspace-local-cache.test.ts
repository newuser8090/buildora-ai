// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — local cache tests
//
// The workspace cache metadata is scoped by userId + workspaceId + projectId
// and is never an authorization source. These tests verify the helpers read,
// set, and clear that metadata without leaking across projects.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { ProjectPersistenceAdapter } from "@/features/persistence/types";
import {
  getWorkspaceCacheMeta,
  setWorkspaceCacheMeta,
  clearWorkspaceCacheMeta,
} from "../services/workspace-local-cache";

/** In-memory adapter that mimics the IndexedDB metadata API. */
function createMemoryAdapter(): ProjectPersistenceAdapter {
  const metadata = new Map<string, Record<string, unknown>>();
  const adapter = {
    loadProject: async () => ({ success: false as const, error: { code: "PROJECT_NOT_FOUND" as const, message: "n/a" } }),
    saveProject: async () => ({ success: true as const, revision: 1 }),
    removeProject: async () => ({ success: true as const }),
    listProjects: async () => ({ success: true as const, projects: [] }),
    getActiveProjectId: async () => ({ success: true as const, projectId: null }),
    setActiveProjectId: async () => ({ success: true as const }),
    getDashboardMetadata: async (projectId: string) => {
      const value = metadata.get(projectId);
      return value
        ? { success: true as const, metadata: value }
        : { success: false as const, error: { code: "PROJECT_NOT_FOUND" as const, message: "n/a" } };
    },
    setDashboardMetadata: async (projectId: string, value: Record<string, unknown>) => {
      metadata.set(projectId, value);
      return { success: true as const };
    },
    removeDashboardMetadata: async (projectId: string) => {
      metadata.delete(projectId);
      return { success: true as const };
    },
    estimateUsage: async () => ({ success: true as const, estimate: { available: false } }),
    close: () => {},
  };
  return adapter as ProjectPersistenceAdapter;
}

const metaA = {
  workspaceId: "ws-a",
  userId: "user-a",
  serverRevision: 3,
  serverUpdatedAt: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  // nothing shared between tests
});

describe("workspace local cache meta", () => {
  it("returns null for projects without workspace metadata", async () => {
    const adapter = createMemoryAdapter();
    expect(await getWorkspaceCacheMeta(adapter, "proj-personal")).toBeNull();
  });

  it("set → get round-trips workspace-scoped metadata", async () => {
    const adapter = createMemoryAdapter();
    await setWorkspaceCacheMeta(adapter, "proj-1", metaA);
    const meta = await getWorkspaceCacheMeta(adapter, "proj-1");
    expect(meta).toEqual(metaA);
  });

  it("metadata is per-project: one project's workspace meta never leaks to another", async () => {
    const adapter = createMemoryAdapter();
    await setWorkspaceCacheMeta(adapter, "proj-1", metaA);
    expect(await getWorkspaceCacheMeta(adapter, "proj-2")).toBeNull();
    expect(await getWorkspaceCacheMeta(adapter, "proj-personal")).toBeNull();
  });

  it("clear removes only the workspace key, preserving other dashboard metadata", async () => {
    const adapter = createMemoryAdapter();
    await adapter.setDashboardMetadata("proj-1", { isPinned: true });
    await setWorkspaceCacheMeta(adapter, "proj-1", metaA);
    await clearWorkspaceCacheMeta(adapter, "proj-1");
    expect(await getWorkspaceCacheMeta(adapter, "proj-1")).toBeNull();
    const current = await adapter.getDashboardMetadata("proj-1");
    expect(current.success).toBe(true);
    if (current.success) expect(current.metadata.isPinned).toBe(true);
  });

  it("malformed or partial metadata is ignored (never trusted as authorization)", async () => {
    const adapter = createMemoryAdapter();
    await adapter.setDashboardMetadata("proj-1", { workspace: { workspaceId: "ws-a" } });
    expect(await getWorkspaceCacheMeta(adapter, "proj-1")).toBeNull();
    await adapter.setDashboardMetadata("proj-2", {
      workspace: { workspaceId: "ws-a", userId: "u", serverRevision: "not-a-number" },
    });
    expect(await getWorkspaceCacheMeta(adapter, "proj-2")).toBeNull();
  });

  it("best-effort: adapter failures never throw", async () => {
    const failing = {
      ...createMemoryAdapter(),
      getDashboardMetadata: async () => {
        throw new Error("boom");
      },
      setDashboardMetadata: async () => {
        throw new Error("boom");
      },
    };
    await expect(setWorkspaceCacheMeta(failing, "p", metaA)).resolves.toBeUndefined();
    await expect(getWorkspaceCacheMeta(failing, "p")).resolves.toBeNull();
    await expect(clearWorkspaceCacheMeta(failing, "p")).resolves.toBeUndefined();
  });
});
