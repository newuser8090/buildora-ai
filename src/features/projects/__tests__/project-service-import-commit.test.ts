// ---------------------------------------------------------------------------
// ProjectService.commitImportedProject — Phase E.2 metadata-rollback tests
//
// The documented policy:
//   1. Save project (revision 1)
//   2. Initialize dashboard metadata (unpinned)
//   3. If metadata init fails → rollback: delete the saved project + metadata
//
// Tests verify:
//   - save failure creates no project and no metadata
//   - metadata failure triggers exactly one rollback delete
//   - successful rollback leaves no imported project or metadata
//   - rollback failure returns a distinct structured error explaining that a
//     recoverable orphan may remain
//   - successful commit saves exactly once and initializes metadata exactly once
//   - imported project starts unpinned
//   - retry after a rollback-failure avoids duplicating the orphan
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectService } from "../services/project-service";
import { INITIAL_REVISION } from "@/features/persistence/constants";
import type {
  ProjectPersistenceAdapter,
  SaveProjectResult,
  ProjectLoadResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";
import type { ImportProjectPreview } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Mock adapter (metadata-aware)
// ---------------------------------------------------------------------------

function createMockAdapter() {
  const projects = new Map<string, { project: Project; revision: number; savedAt: string }>();
  const metadata = new Map<string, Record<string, unknown>>();

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
    listProjects: vi.fn(async (): Promise<ProjectSummaryResult> => {
      return {
        success: true as const,
        projects: Array.from(projects.entries()).map(([, p]) => ({
          id: p.project.id,
          name: p.project.name,
          createdAt: p.project.createdAt,
          updatedAt: p.project.updatedAt,
          savedAt: p.savedAt,
          revision: p.revision,
          pageCount: p.project.pages?.length ?? 0,
          assetCount: p.project.assets?.length ?? 0,
          approximateAssetBytes: 0,
        })),
      };
    }),
    getActiveProjectId: vi.fn(async () => ({ success: true as const, projectId: null })),
    setActiveProjectId: vi.fn(async (): Promise<ProjectPersistenceResult> => ({ success: true as const })),
    getDashboardMetadata: vi.fn(async (id: string) => ({
      success: true as const,
      metadata: metadata.get(id) ?? {},
    })),
    setDashboardMetadata: vi.fn(async (id: string, md: Record<string, unknown>): Promise<ProjectPersistenceResult> => {
      metadata.set(id, md);
      return { success: true as const };
    }),
    removeDashboardMetadata: vi.fn(async (id: string): Promise<ProjectPersistenceResult> => {
      metadata.delete(id);
      return { success: true as const };
    }),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };

  return { adapter, projects, metadata };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-original",
    name: "Imported Project",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    theme: {} as any,
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePreview(overrides?: Partial<ImportProjectPreview>): ImportProjectPreview {
  return {
    sourceFilename: "import.buildora.json",
    project: makeProject(),
    originalProjectId: "proj-original",
    originalProjectName: "Imported Project",
    schemaVersion: 1,
    migrationApplied: false,
    warnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectService.commitImportedProject — metadata rollback", () => {
  let mock: ReturnType<typeof createMockAdapter>;
  let service: ProjectService;

  beforeEach(() => {
    mock = createMockAdapter();
    service = new ProjectService(mock.adapter);
  });

  it("successful commit saves exactly once and initializes metadata exactly once", async () => {
    const preview = makePreview();
    const result = await service.commitImportedProject(preview, []);

    expect(result.ok).toBe(true);
    expect(mock.adapter.saveProject).toHaveBeenCalledTimes(1);
    expect(mock.adapter.setDashboardMetadata).toHaveBeenCalledTimes(1);

    if (result.ok) {
      expect(mock.adapter.setDashboardMetadata).toHaveBeenCalledWith(
        result.project.id,
        expect.objectContaining({ isPinned: false }),
      );
    }
  });

  it("imported project starts clean (revision 1)", async () => {
    const preview = makePreview();
    const result = await service.commitImportedProject(preview, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const loaded = await mock.adapter.loadProject(result.project.id);
      expect(loaded.success).toBe(true);
      if (loaded.success) expect(loaded.revision).toBe(INITIAL_REVISION);
    }
  });

  it("imported project starts unpinned", async () => {
    const preview = makePreview();
    const result = await service.commitImportedProject(preview, []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const metaResult = await mock.adapter.getDashboardMetadata(result.project.id);
      expect(metaResult.success).toBe(true);
      if (metaResult.success) {
        expect(metaResult.metadata.isPinned).toBe(false);
      }
    }
  });

  it("project save failure creates no project and no metadata", async () => {
    vi.spyOn(mock.adapter, "saveProject").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Save failed" },
    });

    const result = await service.commitImportedProject(makePreview(), []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("IMPORT_SAVE_FAILED");
    }
    expect(mock.adapter.setDashboardMetadata).not.toHaveBeenCalled();
    const listResult = await mock.adapter.listProjects();
    expect(listResult.success).toBe(true);
    if (listResult.success) expect(listResult.projects).toHaveLength(0);
    expect(mock.metadata.size).toBe(0);
  });

  it("metadata failure triggers exactly one rollback delete", async () => {
    vi.spyOn(mock.adapter, "setDashboardMetadata").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Metadata failed" },
    });

    const result = await service.commitImportedProject(makePreview(), []);

    expect(result.ok).toBe(false);
    expect(mock.adapter.removeProject).toHaveBeenCalledTimes(1);
    expect(mock.adapter.removeDashboardMetadata).toHaveBeenCalledTimes(1);
    if (!result.ok) {
      expect(result.error.details).toMatchObject({
        rollbackFailed: false,
        metadataInitFailed: true,
      });
    }
  });

  it("successful rollback leaves no imported project and no metadata", async () => {
    vi.spyOn(mock.adapter, "setDashboardMetadata").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Metadata failed" },
    });

    const result = await service.commitImportedProject(makePreview(), []);
    expect(result.ok).toBe(false);

    // Determine the saved-then-rolled-back project id via save call.
    const savedId = vi.mocked(mock.adapter.saveProject).mock.calls[0][0].project.id;
    const loaded = await mock.adapter.loadProject(savedId);
    expect(loaded.success).toBe(false);
    expect(mock.metadata.size).toBe(0);
  });

  it("rollback failure returns a distinct structured error and explains the orphan", async () => {
    // Metadata init fails...
    vi.spyOn(mock.adapter, "setDashboardMetadata").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Metadata failed" },
    });
    // ...and the rollback delete throws (simulating adapter failure).
    vi.spyOn(mock.adapter, "removeProject").mockRejectedValue(new Error("remove failed"));

    const result = await service.commitImportedProject(makePreview(), []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("IMPORT_SAVE_FAILED");
      expect(result.error.details).toMatchObject({
        rollbackFailed: true,
        metadataInitFailed: true,
        orphanMayRemain: true,
      });
      expect(String(result.error.message)).toContain("recoverable orphan");
      expect((result.error.details as Record<string, unknown>).orphanProjectId).toBe(
        vi.mocked(mock.adapter.saveProject).mock.calls[0][0].project.id,
      );
    }
  });

  it("retry after rollback failure avoids duplicating the orphan", async () => {
    // First commit: metadata fails and rollback fails → orphan may remain.
    vi.spyOn(mock.adapter, "setDashboardMetadata")
      .mockResolvedValueOnce({
        success: false,
        error: { code: "TRANSACTION_FAILED", message: "Metadata failed" },
      });
    vi.spyOn(mock.adapter, "removeProject").mockRejectedValueOnce(new Error("remove failed"));

    const first = await service.commitImportedProject(makePreview(), []);
    expect(first.ok).toBe(false);
    const orphanId = vi.mocked(mock.adapter.saveProject).mock.calls[0][0].project.id;

    // Retry: a fresh commit generates a new ID and succeeds cleanly.
    const second = await service.commitImportedProject(makePreview(), []);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.project.id).not.toBe(orphanId);
      // Exactly one additional save for the retry.
      expect(mock.adapter.saveProject).toHaveBeenCalledTimes(2);
    }
  });

  it("no dashboard metadata write occurs until the save reaches a consistent state", async () => {
    vi.spyOn(mock.adapter, "saveProject").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Save failed" },
    });
    const result = await service.commitImportedProject(makePreview(), []);
    expect(result.ok).toBe(false);
    expect(mock.adapter.setDashboardMetadata).not.toHaveBeenCalled();
  });
});
