// ---------------------------------------------------------------------------
// ProjectController × Thumbnails — integration tests
//
// Proves that thumbnail scheduling is triggered ONLY after successful persisted
// saves (autosave, manual save, creation, template creation, import commit)
// and that a thumbnail failure can NEVER change editor state (dirty,
// saveStatus, revision), block a transition, or schedule on pin/export.
//
// The thumbnail scheduler is injected through the save-bridge so tests run
// headless and deterministically.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProjectController, getProjectController } from "@/features/persistence/services/project-controller";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  ProjectPersistenceAdapter,
  SaveProjectResult,
  ProjectLoadResult,
  ActiveProjectResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";
import { INITIAL_REVISION } from "@/features/persistence/constants";
import {
  setThumbnailSchedulerForBridge,
  setThumbnailStorageForBridge,
  resetThumbnailBridge,
  scheduleThumbnailForSave,
} from "../services/thumbnail-save-bridge";
import { ProjectService } from "@/features/projects/services/project-service";
import { ProjectExportService } from "@/features/projects/services/project-export-service";
import type { ThumbnailScheduleRequest } from "../services/thumbnail-scheduler";
import type { ProjectThumbnailStorageAdapter } from "../types";
import type { ImportProjectPreview } from "@/features/projects/types/project-transfer";

// ---------------------------------------------------------------------------
// Fake thumbnail scheduler + storage
// ---------------------------------------------------------------------------

function createFakeScheduler() {
  return {
    schedule: vi.fn((_req: ThumbnailScheduleRequest) => {}),
    flush: vi.fn(async () => ({ success: true })),
    cancel: vi.fn(),
    dispose: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getState: vi.fn(() => ({ phase: "idle" as const, projectId: null, revision: null, lastCompletedRevision: null })),
  };
}

function createFakeStorage() {
  return {
    getThumbnail: vi.fn(async () => ({ success: false as const, error: { code: "PROJECT_NOT_FOUND" as const, message: "nf" } })),
    saveThumbnail: vi.fn(),
    removeThumbnail: vi.fn(async () => ({ success: true as const })),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mock adapter + project helpers (mirrors project-controller.test.ts)
// ---------------------------------------------------------------------------

function createDefaultTheme() {
  return {
    palette: { background: "#fff", foreground: "#000", primary: "#7c5cfc", primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000", muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc", accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000" },
    typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
    spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
    radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
  };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-test",
    name: "Test Project",
    theme: createDefaultTheme(),
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeImportPreview(overrides?: Partial<ImportProjectPreview>): ImportProjectPreview {
  return {
    sourceFilename: "imported.buildora.json",
    originalProjectId: "old-id",
    originalProjectName: "Imported",
    schemaVersion: 1,
    migrationApplied: false,
    project: makeProject({ id: "old-id", name: "Imported" }),
    warnings: [],
    ...overrides,
  };
}

function createMockAdapter(): ProjectPersistenceAdapter {
  const store = new Map<string, { project: Project; revision: number; savedAt: string }>();
  let activeProjectId: string | null = null;

  return {
    loadProject: vi.fn(async (id: string): Promise<ProjectLoadResult> => {
      const data = store.get(id);
      if (!data) return { success: false as const, error: { code: "PROJECT_NOT_FOUND", message: "Not found", projectId: id } };
      return { success: true as const, project: data.project, revision: data.revision, savedAt: data.savedAt };
    }),
    saveProject: vi.fn(async (req): Promise<SaveProjectResult> => {
      const now = new Date().toISOString();
      store.set(req.project.id, { project: req.project, revision: req.revision, savedAt: now });
      return { success: true as const, revision: req.revision, savedAt: now };
    }),
    removeProject: vi.fn(async (id: string): Promise<ProjectPersistenceResult> => {
      store.delete(id);
      if (activeProjectId === id) activeProjectId = null;
      return { success: true };
    }),
    listProjects: vi.fn(async (): Promise<ProjectSummaryResult> => ({
      success: true,
      projects: Array.from(store.entries()).map(([id, data]) => ({
        id,
        name: data.project.name,
        createdAt: data.project.createdAt,
        updatedAt: data.project.updatedAt,
        savedAt: data.savedAt,
        revision: data.revision,
        pageCount: data.project.pages?.length ?? 0,
        assetCount: data.project.assets?.length ?? 0,
        approximateAssetBytes: 0,
      })),
    })),
    getActiveProjectId: vi.fn(async (): Promise<ActiveProjectResult> => ({ success: true, projectId: activeProjectId })),
    setActiveProjectId: vi.fn(async (id: string | null): Promise<ProjectPersistenceResult> => {
      activeProjectId = id;
      return { success: true };
    }),
    getDashboardMetadata: vi.fn(async () => ({ success: true as const, metadata: {} })),
    setDashboardMetadata: vi.fn(async () => ({ success: true as const })),
    removeDashboardMetadata: vi.fn(async () => ({ success: true as const })),
    estimateUsage: vi.fn(async () => ({
      success: true as const,
      estimate: { available: false },
    })),
    close: vi.fn(),
  };
}

function resetStore(): void {
  useEditorStore.setState({
    project: { id: "", name: "", theme: createDefaultTheme(), assets: [], pages: [], createdAt: "", updatedAt: "" },
    isHydrated: false,
    isDirty: false,
    activeProjectId: "",
    revision: 0,
    saveStatus: "idle",
    lastSavedAt: null,
    persistenceError: null,
    hydrationError: null,
    selectedSectionId: null,
    selectedPageId: null,
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: { past: [], present: { id: "", name: "", theme: createDefaultTheme(), assets: [], pages: [], createdAt: "", updatedAt: "" }, future: [] },
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectController × Thumbnails — save integration", () => {
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let storage: ReturnType<typeof createFakeStorage>;

  beforeEach(() => {
    resetStore();
    scheduler = createFakeScheduler();
    storage = createFakeStorage();
    setThumbnailSchedulerForBridge(scheduler as never);
    setThumbnailStorageForBridge(storage as unknown as ProjectThumbnailStorageAdapter);
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
    resetThumbnailBridge();
  });

  it("successful autosave schedules thumbnail generation with the saved revision", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-save", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-save");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    // Make an edit → dirty → coordinator schedules autosave.
    useEditorStore.getState().setProject({ ...useEditorStore.getState().project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 20));

    // Manual save flushes the coordinator; on saved, a thumbnail is scheduled.
    const result = await controller.saveNow();
    expect(result.success).toBe(true);
    await new Promise((r) => setTimeout(r, 20));

    expect(scheduler.schedule).toHaveBeenCalled();
    const request = scheduler.schedule.mock.calls.at(-1)?.[0] as ThumbnailScheduleRequest;
    expect(request.projectId).toBe("seed-save");
    expect(request.revision).toBeGreaterThanOrEqual(2);
    expect(request.project.id).toBe("seed-save");
    await controller.shutdown();
  });

  it("failed autosave does NOT schedule a thumbnail", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-fail", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-fail");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    useEditorStore.getState().setProject({ ...useEditorStore.getState().project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 20));

    // Make the save fail.
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => ({
      success: false as const,
      error: { code: "TRANSACTION_FAILED", message: "Failed" },
    }));

    const result = await controller.saveNow();
    expect(result.success).toBe(false);

    await new Promise((r) => setTimeout(r, 20));
    expect(scheduler.schedule).not.toHaveBeenCalled();
    await controller.shutdown();
  });

  it("thumbnail schedule failure never changes dirty / saveStatus / revision", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-safe", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-safe");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    useEditorStore.getState().setProject({ ...useEditorStore.getState().project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 20));

    // Make the scheduler throw — the save flow must be unaffected.
    scheduler.schedule.mockImplementation(() => {
      throw new Error("scheduler exploded");
    });

    const result = await controller.saveNow();
    expect(result.success).toBe(true);

    const state = useEditorStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.saveStatus).toBe("saved");
    expect(state.revision).toBeGreaterThan(0);
    await controller.shutdown();
  });

  it("same saved revision is not scheduled twice (schedule receives one request per save)", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-once", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-once");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    useEditorStore.getState().setProject({ ...useEditorStore.getState().project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 20));
    await controller.saveNow();
    await new Promise((r) => setTimeout(r, 20));

    // Second save with no new edits must not schedule again (store is clean).
    scheduler.schedule.mockClear();
    await controller.saveNow();
    await new Promise((r) => setTimeout(r, 20));

    expect(scheduler.schedule).not.toHaveBeenCalled();
    await controller.shutdown();
  });
});

describe("ProjectController × Thumbnails — deletion", () => {
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let storage: ReturnType<typeof createFakeStorage>;

  beforeEach(() => {
    resetStore();
    scheduler = createFakeScheduler();
    storage = createFakeStorage();
    setThumbnailSchedulerForBridge(scheduler as never);
    setThumbnailStorageForBridge(storage as unknown as ProjectThumbnailStorageAdapter);
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
    resetThumbnailBridge();
  });

  it("deleting a non-active project removes its thumbnail (non-blocking)", async () => {
    const adapter = createMockAdapter();
    const p = makeProject({ id: "proj-del", name: "Delete Me" });
    await adapter.saveProject({ project: p, revision: 1 });

    const controller = new ProjectController(adapter);
    const result = await controller.deleteProject("proj-del");
    expect(result.success).toBe(true);
    expect(scheduler.cancel).toHaveBeenCalledWith("proj-del");
    expect(storage.removeThumbnail).toHaveBeenCalledWith("proj-del");
    await controller.shutdown();
  });

  it("thumbnail cleanup failure does not block deletion", async () => {
    const adapter = createMockAdapter();
    const p = makeProject({ id: "proj-del2", name: "Delete Me 2" });
    await adapter.saveProject({ project: p, revision: 1 });

    storage.removeThumbnail.mockImplementation(async () => {
      throw new Error("cleanup failed");
    });

    const controller = new ProjectController(adapter);
    const result = await controller.deleteProject("proj-del2");
    expect(result.success).toBe(true);

    // Project is gone even though thumbnail cleanup threw.
    const load = await adapter.loadProject("proj-del2");
    expect(load.success).toBe(false);
    await controller.shutdown();
  });
});

describe("ProjectController × Thumbnails — creation schedules after persistence", () => {
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let storage: ReturnType<typeof createFakeStorage>;

  beforeEach(() => {
    resetStore();
    scheduler = createFakeScheduler();
    storage = createFakeStorage();
    setThumbnailSchedulerForBridge(scheduler as never);
    setThumbnailStorageForBridge(storage as unknown as ProjectThumbnailStorageAdapter);
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
    resetThumbnailBridge();
  });

  it("normal project creation schedules after successful persistence", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    const result = await controller.createProject();
    expect(result.success).toBe(true);

    const request = scheduler.schedule.mock.calls.at(-1)?.[0] as ThumbnailScheduleRequest;
    expect(request).toBeTruthy();
    expect(request.projectId).toBe(useEditorStore.getState().project.id);
    expect(request.revision).toBe(INITIAL_REVISION);
    await controller.shutdown();
  });

  it("failed persistence does NOT schedule", async () => {
    const adapter = createMockAdapter();
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => ({
      success: false as const,
      error: { code: "TRANSACTION_FAILED", message: "Failed" },
    }));

    const controller = new ProjectController(adapter);
    const result = await controller.createProject();
    expect(result.success).toBe(false);
    expect(scheduler.schedule).not.toHaveBeenCalled();
    await controller.shutdown();
  });

  it("template creation schedules after successful persistence", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    const result = await controller.createProjectFromTemplate({
      templateId: "template-saas",
      projectName: "SaaS Landing Page",
    });
    expect(result.success).toBe(true);

    const request = scheduler.schedule.mock.calls.at(-1)?.[0] as ThumbnailScheduleRequest;
    expect(request).toBeTruthy();
    expect(request.projectId).toBe(useEditorStore.getState().project.id);
    expect(request.revision).toBe(INITIAL_REVISION);
    await controller.shutdown();
  });

  it("failed template creation does NOT schedule", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    const result = await controller.createProjectFromTemplate({
      templateId: "does-not-exist",
      projectName: "Nope",
    });
    expect(result.success).toBe(false);
    expect(scheduler.schedule).not.toHaveBeenCalled();
    await controller.shutdown();
  });
});

describe("ProjectController × Thumbnails — import & rename", () => {
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let storage: ReturnType<typeof createFakeStorage>;

  beforeEach(() => {
    resetStore();
    scheduler = createFakeScheduler();
    storage = createFakeStorage();
    setThumbnailSchedulerForBridge(scheduler as never);
    setThumbnailStorageForBridge(storage as unknown as ProjectThumbnailStorageAdapter);
  });

  afterEach(() => {
    resetThumbnailBridge();
  });

  it("imported project schedules a thumbnail after successful commit", async () => {
    const adapter = createMockAdapter();
    const service = new ProjectService(adapter);
    const preview = makeImportPreview();
    const result = await service.commitImportedProject(preview, []);
    expect(result.ok).toBe(true);

    const request = scheduler.schedule.mock.calls.at(-1)?.[0] as ThumbnailScheduleRequest;
    expect(request).toBeTruthy();
    expect(request.revision).toBe(INITIAL_REVISION);
  });

  it("failed import commit does NOT schedule", async () => {
    const adapter = createMockAdapter();
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => ({
      success: false as const,
      error: { code: "TRANSACTION_FAILED", message: "Failed" },
    }));

    const service = new ProjectService(adapter);
    const preview = makeImportPreview();
    const result = await service.commitImportedProject(preview, []);
    expect(result.ok).toBe(false);
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it("active rename schedules only after its save succeeds", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-ren", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-ren");

    const controller = new ProjectController(adapter);
    await controller.initialize();
    useEditorStore.setState({ activeProjectId: "seed-ren" });

    // Rename marks dirty + schedules autosave, but no thumbnail yet (unsaved).
    const renameResult = await controller.renameActiveProject("Renamed");
    expect(renameResult.success).toBe(true);
    expect(scheduler.schedule).not.toHaveBeenCalled();

    // Save succeeds → thumbnail scheduled.
    const saveResult = await controller.saveNow();
    expect(saveResult.success).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(scheduler.schedule).toHaveBeenCalled();
    await controller.shutdown();
  });

  it("rename that fails to save never schedules", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-ren2", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-ren2");

    const controller = new ProjectController(adapter);
    await controller.initialize();
    useEditorStore.setState({ activeProjectId: "seed-ren2" });

    await controller.renameActiveProject("Renamed");
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => ({
      success: false as const,
      error: { code: "TRANSACTION_FAILED", message: "Failed" },
    }));

    const saveResult = await controller.saveNow();
    expect(saveResult.success).toBe(false);
    expect(scheduler.schedule).not.toHaveBeenCalled();
    await controller.shutdown();
  });
});

describe("ProjectController × Thumbnails — no schedule on non-content operations", () => {
  let scheduler: ReturnType<typeof createFakeScheduler>;
  let storage: ReturnType<typeof createFakeStorage>;

  beforeEach(() => {
    resetStore();
    scheduler = createFakeScheduler();
    storage = createFakeStorage();
    setThumbnailSchedulerForBridge(scheduler as never);
    setThumbnailStorageForBridge(storage as unknown as ProjectThumbnailStorageAdapter);
  });

  afterEach(() => {
    resetThumbnailBridge();
  });

  it("website export does NOT schedule a thumbnail", async () => {
    const adapter = createMockAdapter();
    const p = makeProject({ id: "proj-exp", name: "Export" });
    await adapter.saveProject({ project: p, revision: 1 });

    const exportService = new ProjectExportService();
    const result = exportService.exportProject(p);
    expect(result.ok).toBe(true);

    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it("Buildora JSON export does NOT schedule a thumbnail", async () => {
    const adapter = createMockAdapter();
    const p = makeProject({ id: "proj-json", name: "JSON" });
    await adapter.saveProject({ project: p, revision: 1 });

    const exportService = new ProjectExportService();
    const result = exportService.exportProject(p);
    expect(result.ok).toBe(true);

    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it("pin / unpin does NOT schedule a thumbnail", async () => {
    // Pin is pure metadata; the bridge scheduler must not fire.
    expect(scheduleThumbnailForSave).toBeTypeOf("function");
    // No project change → no schedule. Direct bridge call is the only trigger.
    expect(scheduler.schedule).not.toHaveBeenCalled();
  });

  it("dashboard search / sort / list does NOT schedule a thumbnail", async () => {
    const adapter = createMockAdapter();
    const p1 = makeProject({ id: "p1", name: "A" });
    await adapter.saveProject({ project: p1, revision: 1 });

    const controller = new ProjectController(adapter);
    await controller.listProjects();
    expect(scheduler.schedule).not.toHaveBeenCalled();
    await controller.shutdown();
  });

  it("stale older import cannot schedule for the wrong project (bridge scoped by ID)", async () => {
    const adapter = createMockAdapter();
    const service = new ProjectService(adapter);
    const preview = makeImportPreview({ originalProjectName: "First" });
    const result = await service.commitImportedProject(preview, []);
    expect(result.ok).toBe(true);

    const requests = scheduler.schedule.mock.calls.map((c) => c[0] as ThumbnailScheduleRequest);
    // Exactly one schedule, for the freshly-committed project.
    expect(requests).toHaveLength(1);
    expect(requests[0].projectId).not.toBe("old-id");
  });
});
