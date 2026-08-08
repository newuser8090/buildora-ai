// ---------------------------------------------------------------------------
// Project Archive (Phase P9) — dashboard metadata tests
//
//   - setArchived persists through the adapter metadata API
//   - getArchivedMap returns only archived projects
//   - archiving never touches the Project document (metadata only)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { DashboardMetadataService } from "../services/dashboard-metadata-service";
import type { ProjectPersistenceAdapter } from "@/features/persistence/types";

/** Minimal in-memory adapter exposing the metadata surface used here. */
function makeMetadataAdapter() {
  const metadata = new Map<string, Record<string, unknown>>();
  const adapter: ProjectPersistenceAdapter = {
    loadProject: async () => ({ success: false, error: { code: "PROJECT_NOT_FOUND", message: "stub" } }),
    saveProject: async () => ({ success: true, revision: 1 }),
    removeProject: async () => ({ success: true }),
    listProjects: async () => ({ success: true, projects: [] }),
    getActiveProjectId: async () => ({ success: true, projectId: null }),
    setActiveProjectId: async () => ({ success: true }),
    getDashboardMetadata: async (projectId) => ({
      success: true,
      metadata: metadata.get(projectId) ?? {},
    }),
    setDashboardMetadata: async (projectId, value) => {
      metadata.set(projectId, value);
      return { success: true };
    },
    removeDashboardMetadata: async (projectId) => {
      metadata.delete(projectId);
      return { success: true };
    },
    estimateUsage: async () => ({
      success: true,
      estimate: { available: true },
    }),
    close: () => {},
  };
  return adapter;
}

describe("DashboardMetadataService — archive (Phase P9)", () => {
  it("persists and reads the archived flag", async () => {
    const adapter = makeMetadataAdapter();
    const service = new DashboardMetadataService(adapter);
    const set = await service.setArchived("proj-1", true);
    expect(set.success).toBe(true);

    const map = await service.getArchivedMap(["proj-1", "proj-2"]);
    expect(map.get("proj-1")).toBe(true);
    expect(map.get("proj-2")).toBeUndefined();
  });

  it("restoring clears the archived flag", async () => {
    const adapter = makeMetadataAdapter();
    const service = new DashboardMetadataService(adapter);
    await service.setArchived("proj-1", true);
    await service.setArchived("proj-1", false);
    const map = await service.getArchivedMap(["proj-1"]);
    expect(map.get("proj-1")).toBeUndefined();
  });

  it("archiving does not modify pin state (metadata is merged, not replaced)", async () => {
    const adapter = makeMetadataAdapter();
    const service = new DashboardMetadataService(adapter);
    await service.setPinned("proj-1", true);
    await service.setArchived("proj-1", true);

    const meta = await adapter.getDashboardMetadata("proj-1");
    expect(meta.success).toBe(true);
    if (meta.success) {
      expect(meta.metadata.isPinned).toBe(true);
      expect(meta.metadata.isArchived).toBe(true);
    }
  });
});
