// ---------------------------------------------------------------------------
// DashboardMetadataService tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DashboardMetadataService } from "../services/dashboard-metadata-service";
import type { ProjectPersistenceAdapter } from "@/features/persistence/types";

function createMockAdapter(): ProjectPersistenceAdapter {
  const metadata = new Map<string, Record<string, unknown>>();

  return {
    loadProject: vi.fn(),
    saveProject: vi.fn(),
    removeProject: vi.fn(),
    listProjects: vi.fn(),
    getActiveProjectId: vi.fn(),
    setActiveProjectId: vi.fn(),
    getDashboardMetadata: vi.fn(async (id: string) => {
      const data = metadata.get(id);
      return { success: true as const, metadata: data ?? {} };
    }),
    setDashboardMetadata: vi.fn(async (id: string, data: Record<string, unknown>) => {
      metadata.set(id, data);
      return { success: true as const };
    }),
    removeDashboardMetadata: vi.fn(async (id: string) => {
      metadata.delete(id);
      return { success: true as const };
    }),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };
}

describe("DashboardMetadataService", () => {
  let service: DashboardMetadataService;
  let adapter: ProjectPersistenceAdapter;

  beforeEach(() => {
    adapter = createMockAdapter();
    service = new DashboardMetadataService(adapter);
  });

  it("returns false for unpinned project", async () => {
    const pinned = await service.isPinned("proj-1");
    expect(pinned).toBe(false);
  });

  it("sets and gets pin state", async () => {
    const result = await service.setPinned("proj-1", true);
    expect(result.success).toBe(true);

    const pinned = await service.isPinned("proj-1");
    expect(pinned).toBe(true);
  });

  it("unpins a pinned project", async () => {
    await service.setPinned("proj-1", true);
    await service.setPinned("proj-1", false);

    const pinned = await service.isPinned("proj-1");
    expect(pinned).toBe(false);
  });

  it("returns pin map for pinned projects only (getPinMap only includes pinned)", async () => {
    await service.setPinned("proj-1", true);
    await service.setPinned("proj-2", false);
    await service.setPinned("proj-3", true);

    const pinMap = await service.getPinMap(["proj-1", "proj-2", "proj-3"]);
    expect(pinMap.get("proj-1")).toBe(true);
    // getPinMap only adds pinned=true entries; proj-2 is not in the map
    expect(pinMap.has("proj-2")).toBe(false);
    expect(pinMap.get("proj-3")).toBe(true);
  });

  it("removes metadata on project delete", async () => {
    await service.setPinned("proj-1", true);
    await service.removeMetadata("proj-1");

    const pinned = await service.isPinned("proj-1");
    expect(pinned).toBe(false);
  });

  it("handles getDashboardMetadata errors gracefully", async () => {
    vi.mocked(adapter.getDashboardMetadata).mockRejectedValue(new Error("DB error"));
    const result = await service.setPinned("proj-1", true);
    expect(result.success).toBe(false);
  });
});
