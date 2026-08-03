// ---------------------------------------------------------------------------
// ProjectService Tests
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectService } from "../services/project-service";
import type {
  ProjectPersistenceAdapter,
  ProjectSummary,
  SaveProjectResult,
  ProjectLoadResult,
  ProjectPersistenceResult,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function createMockAdapter() {
  const projects = new Map<string, { project: Project; revision: number; savedAt: string }>();

  const adapter: ProjectPersistenceAdapter = {
    loadProject: vi.fn(async (id: string): Promise<ProjectLoadResult> => {
      const existing = projects.get(id);
      if (!existing) {
        return { success: false, error: { code: "PROJECT_NOT_FOUND", message: "Not found" } };
      }
      return { success: true, project: existing.project, revision: existing.revision, savedAt: existing.savedAt };
    }),
    saveProject: vi.fn(async (req): Promise<SaveProjectResult> => {
      const now = new Date().toISOString();
      projects.set(req.project.id, { project: req.project, revision: req.revision, savedAt: now });
      return { success: true, revision: req.revision, savedAt: now };
    }),
    removeProject: vi.fn(async (id: string): Promise<ProjectPersistenceResult> => {
      projects.delete(id);
      return { success: true };
    }),
    listProjects: vi.fn(async (): Promise<import("@/features/persistence/types").ProjectSummaryResult> => {
      const projectsList: ProjectSummary[] = Array.from(projects.entries()).map(([, p]) => ({
        id: p.project.id,
        name: p.project.name,
        createdAt: p.project.createdAt,
        updatedAt: p.project.updatedAt,
        savedAt: p.savedAt,
        revision: p.revision,
        pageCount: p.project.pages?.length ?? 0,
        assetCount: p.project.assets?.length ?? 0,
        approximateAssetBytes: 0,
      }));
      return { success: true as const, projects: projectsList };
    }),
    getActiveProjectId: vi.fn(),
    setActiveProjectId: vi.fn(),
    getDashboardMetadata: vi.fn(),
    setDashboardMetadata: vi.fn(),
    removeDashboardMetadata: vi.fn(),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };

  return { adapter, projects };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-test",
    name: "Test Project",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    theme: {} as any,
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectService", () => {
  let service: ProjectService;
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    service = new ProjectService(mockAdapter.adapter);
  });

  describe("listProjects", () => {
    it("returns empty list when no projects exist", async () => {
      const result = await service.listProjects();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.projects).toHaveLength(0);
      }
    });

    it("returns all projects as summaries", async () => {
      const p1 = makeProject({ id: "proj-1", name: "Project A" });
      await mockAdapter.adapter.saveProject({ project: p1, revision: 1 });
      const p2 = makeProject({ id: "proj-2", name: "Project B" });
      await mockAdapter.adapter.saveProject({ project: p2, revision: 1 });

      const result = await service.listProjects();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.projects).toHaveLength(2);
        expect(result.projects.map((p) => p.name).sort()).toEqual(["Project A", "Project B"]);
      }
    });
  });

  describe("renameProject", () => {
    it("renames an existing project", async () => {
      const project = makeProject({ id: "proj-1", name: "Old Name" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const result = await service.renameProject("proj-1", "New Name");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.name).toBe("New Name");
        expect(result.revision).toBe(2);
      }
    });

    it("rejects empty names", async () => {
      const project = makeProject({ id: "proj-1", name: "Test" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const result = await service.renameProject("proj-1", "  ");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_PROJECT_NAME");
      }
    });

    it("rejects names over 80 characters", async () => {
      const project = makeProject({ id: "proj-1", name: "Test" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const longName = "a".repeat(81);
      const result = await service.renameProject("proj-1", longName);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_PROJECT_NAME");
      }
    });

    it("returns PROJECT_NOT_FOUND for nonexistent project", async () => {
      const result = await service.renameProject("nonexistent", "New Name");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PROJECT_NOT_FOUND");
      }
    });

    it("inactive rename preserves project ID", async () => {
      const project = makeProject({ id: "proj-inactive", name: "Inactive" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const result = await service.renameProject("proj-inactive", "Renamed");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.id).toBe("proj-inactive");
      }
    });

    it("inactive rename preserves createdAt", async () => {
      const project = makeProject({ id: "proj-inactive", name: "Original", createdAt: "2026-01-15T00:00:00.000Z" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const result = await service.renameProject("proj-inactive", "Renamed");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.createdAt).toBe("2026-01-15T00:00:00.000Z");
      }
    });

    it("inactive rename increments revision exactly once", async () => {
      const project = makeProject({ id: "proj-inactive", name: "Original" });
      await mockAdapter.adapter.saveProject({ project, revision: 5 });

      const result = await service.renameProject("proj-inactive", "Renamed");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.revision).toBe(6);
      }
    });

    it("inactive rename updates updatedAt", async () => {
      const project = makeProject({ id: "proj-inactive", name: "Original" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const oldUpdatedAt = project.updatedAt;
      const result = await service.renameProject("proj-inactive", "Renamed");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.updatedAt).not.toBe(oldUpdatedAt);
      }
    });

    it("inactive rename uses canonical validator (same as controller)", async () => {
      // Verify service returns same error codes as controller would
      const project = makeProject({ id: "proj-inactive", name: "Test" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const emptyResult = await service.renameProject("proj-inactive", "");
      expect(emptyResult.success).toBe(false);
      if (!emptyResult.success) {
        expect(emptyResult.error.code).toBe("INVALID_PROJECT_NAME");
      }

      const longResult = await service.renameProject("proj-inactive", "a".repeat(81));
      expect(longResult.success).toBe(false);
      if (!longResult.success) {
        expect(longResult.error.code).toBe("INVALID_PROJECT_NAME");
      }

      const validResult = await service.renameProject("proj-inactive", "Valid Name");
      expect(validResult.success).toBe(true);
      if (validResult.success) {
        expect(validResult.project.name).toBe("Valid Name");
      }
    });
  });

  describe("duplicateProject", () => {
    it("duplicates a project with new identity", async () => {
      const project = makeProject({ id: "proj-1", name: "Landing Page" });
      await mockAdapter.adapter.saveProject({ project, revision: 5 });

      const result = await service.duplicateProject("proj-1", []);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.id).not.toBe("proj-1");
        expect(result.project.name).toBe("Landing Page Copy");
        expect(result.project.createdAt).not.toBe(project.createdAt);
        expect(result.project.updatedAt).not.toBe(project.updatedAt);
      }
    });

    it("generates collision-safe duplicate names (Copy 2, Copy 3, etc.)", async () => {
      const project = makeProject({ id: "proj-1", name: "Landing Page" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      // First duplicate
      const result1 = await service.duplicateProject("proj-1", ["Landing Page Copy"]);
      expect(result1.success).toBe(true);
      if (result1.success) {
        expect(result1.project.name).toBe("Landing Page Copy 2");
      }

      // Second duplicate
      const result2 = await service.duplicateProject("proj-1", ["Landing Page Copy", "Landing Page Copy 2"]);
      expect(result2.success).toBe(true);
      if (result2.success) {
        expect(result2.project.name).toBe("Landing Page Copy 3");
      }
    });

    it("deep clones nested objects (no shared references)", async () => {
      const project = makeProject({
        id: "proj-1",
        assets: [{ id: "asset-1", name: "logo.png", type: "image", mimeType: "image/png", extension: ".png", size: 100, source: { type: "data-url", value: "data:..." }, createdAt: "2026-01-01T00:00:00.000Z" }],
      });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const result = await service.duplicateProject("proj-1", []);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.project.assets).toHaveLength(1);
        expect(result.project.assets[0].id).toBe("asset-1");
        // Verify deep clone: modifying source doesn't affect clone
        project.assets[0].name = "changed";
        expect(result.project.assets[0].name).toBe("logo.png");
      }
    });

    it("returns PROJECT_NOT_FOUND for nonexistent project", async () => {
      const result = await service.duplicateProject("nonexistent", []);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("PROJECT_NOT_FOUND");
      }
    });
  });

  describe("deleteProject", () => {
    it("deletes an existing project", async () => {
      const project = makeProject({ id: "proj-1" });
      await mockAdapter.adapter.saveProject({ project, revision: 1 });

      const result = await service.deleteProject("proj-1");
      expect(result.success).toBe(true);

      const list = await service.listProjects();
      expect(list.success).toBe(true);
      if (list.success) {
        expect(list.projects).toHaveLength(0);
      }
    });
  });
});
