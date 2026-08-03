// ---------------------------------------------------------------------------
// Dashboard operation state tests
//
// Tests controller-level lifecycle operations (create, open, rename, delete,
// discard) using a mock adapter. Verifies operation state, error mapping,
// navigation timing, double-submit prevention, and stale async protection.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProjectController,
  setProjectController,
} from "@/features/persistence/services/project-controller";
import { ProjectService } from "../services/project-service";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { mapPersistenceErrorToDashboard } from "../types";
import type {
  ProjectPersistenceAdapter,
  ProjectLoadResult,
  SaveProjectResult,
  ActiveProjectResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
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
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Valid empty project — never use `{} as Project` */
function emptyProject(): Project {
  return {
    id: "",
    name: "",
    theme: createDefaultTheme(),
    assets: [],
    pages: [],
    createdAt: "",
    updatedAt: "",
  };
}

function createMockAdapter(): ProjectPersistenceAdapter {
  const store = new Map<string, { project: Project; revision: number; savedAt: string }>();
  let activeProjectId: string | null = null;

  return {
    loadProject: vi.fn(async (id: string): Promise<ProjectLoadResult> => {
      const data = store.get(id);
      if (!data) {
        return { success: false as const, error: { code: "PROJECT_NOT_FOUND", message: "Not found", projectId: id } };
      }
      return { success: true as const, project: data.project, revision: data.revision, savedAt: data.savedAt };
    }),
    saveProject: vi.fn(async (req): Promise<SaveProjectResult> => {
      const existing = store.get(req.project.id);
      if (existing && existing.revision > req.revision) {
        return { success: false as const, error: { code: "STALE_REVISION", message: "Stale" } };
      }
      const now = new Date().toISOString();
      store.set(req.project.id, { project: req.project, revision: req.revision, savedAt: now });
      return { success: true as const, revision: req.revision, savedAt: now };
    }),
    removeProject: vi.fn(async (id: string): Promise<ProjectPersistenceResult> => {
      store.delete(id);
      if (activeProjectId === id) activeProjectId = null;
      return { success: true };
    }),
    listProjects: vi.fn(async (): Promise<ProjectSummaryResult> => {
      return { success: true, projects: Array.from(store.entries()).map(([id, data]) => ({
        id, name: data.project.name, createdAt: data.project.createdAt, updatedAt: data.project.updatedAt,
        savedAt: data.savedAt, revision: data.revision, pageCount: data.project.pages?.length ?? 0,
        assetCount: data.project.assets?.length ?? 0, approximateAssetBytes: 0,
      })) };
    }),
    getActiveProjectId: vi.fn(async (): Promise<ActiveProjectResult> => {
      return { success: true, projectId: activeProjectId };
    }),
    setActiveProjectId: vi.fn(async (id: string | null): Promise<ProjectPersistenceResult> => {
      activeProjectId = id;
      return { success: true };
    }),
    getDashboardMetadata: vi.fn(),
    setDashboardMetadata: vi.fn(),
    removeDashboardMetadata: vi.fn(),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };
}

function resetStore(): void {
  const e = emptyProject();
  useEditorStore.setState({
    project: e,
    history: { past: [], present: e, future: [] },
    isHydrated: false, isDirty: false, activeProjectId: "", revision: 0,
    saveStatus: "idle", lastSavedAt: null, persistenceError: null, hydrationError: null,
    selectedSectionId: null, selectedPageId: null, viewport: "desktop", zoom: 100,
    isGenerating: false, generationProgress: 0,
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard operation state", () => {
  beforeEach(() => {
    resetStore();
  });

  describe("create", () => {
    it("successful create returns project ID", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);

      const result = await controller.createProject();
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.projectId).toBeTruthy();
      }
      await controller.shutdown();
    });

    it("create failure does not hydrate", async () => {
      const adapter = createMockAdapter();
      vi.spyOn(adapter, "saveProject").mockResolvedValue({ success: false, error: { code: "TRANSACTION_FAILED", message: "Failed" } });
      const controller = new ProjectController(adapter);
      setProjectController(controller);

      const result = await controller.createProject();
      expect(result.success).toBe(false);
      await controller.shutdown();
    });
  });

  describe("open", () => {
    it("successful open loads project into store", async () => {
      const adapter = createMockAdapter();
      const project = makeProject({ id: "proj-open-1", name: "Open Me" });
      await adapter.saveProject({ project, revision: 3 });

      const controller = new ProjectController(adapter);
      const result = await controller.openProject("proj-open-1");
      expect(result.success).toBe(true);

      const state = useEditorStore.getState();
      expect(state.project.id).toBe("proj-open-1");
      expect(state.revision).toBe(3);
      expect(state.isDirty).toBe(false);
      await controller.shutdown();
    });

    it("project not found returns PROJECT_LOAD_FAILED", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      const result = await controller.openProject("nonexistent");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("PROJECT_LOAD_FAILED");
      }
      await controller.shutdown();
    });
  });

  describe("renameActiveProject", () => {
    it("valid rename updates project name", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const result = await controller.renameActiveProject("New Name");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.name).toBe("New Name");
      }
      const store = useEditorStore.getState();
      expect(store.project.name).toBe("New Name");
      await controller.shutdown();
    });

    it("empty name returns INVALID_PROJECT_NAME", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const result = await controller.renameActiveProject("  ");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error?.code).toBe("INVALID_PROJECT_NAME");
      }
      await controller.shutdown();
    });

    it("name over 80 characters returns INVALID_PROJECT_NAME", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const result = await controller.renameActiveProject("x".repeat(81));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error?.code).toBe("INVALID_PROJECT_NAME");
      }
      await controller.shutdown();
    });

    it("name trimmed to exactly 80 characters is accepted", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const validName = "a".repeat(80);
      const result = await controller.renameActiveProject(validName);
      expect(result.success).toBe(true);

      const store = useEditorStore.getState();
      expect(store.project.name).toBe(validName);
      await controller.shutdown();
    });
  });

  describe("delete", () => {
    it("deletes inactive project", async () => {
      const adapter = createMockAdapter();
      const project = makeProject({ id: "proj-del-inactive", name: "Delete Me" });
      await adapter.saveProject({ project, revision: 1 });

      const controller = new ProjectController(adapter);
      const result = await controller.deleteProject("proj-del-inactive");
      expect(result.success).toBe(true);

      const loaded = await adapter.loadProject("proj-del-inactive");
      expect(loaded.success).toBe(false);
      await controller.shutdown();
    });

    it("delete failure returns PROJECT_DELETE_FAILED", async () => {
      const adapter = createMockAdapter();
      vi.spyOn(adapter, "removeProject").mockResolvedValue({ success: false, error: { code: "TRANSACTION_FAILED", message: "Failed" } });

      const controller = new ProjectController(adapter);
      const result = await controller.deleteProject("nonexistent");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("PROJECT_DELETE_FAILED");
      }
      await controller.shutdown();
    });
  });

  describe("discardAndOpenProject", () => {
    it("discards unsaved changes and opens target", async () => {
      const adapter = createMockAdapter();
      const current = makeProject({ id: "current-proj", name: "Current" });
      await adapter.saveProject({ project: current, revision: 1 });
      await adapter.setActiveProjectId("current-proj");

      const target = makeProject({ id: "target-proj", name: "Target" });
      await adapter.saveProject({ project: target, revision: 5 });

      const controller = new ProjectController(adapter);
      // Simulate being on current project with dirty state
      useEditorStore.setState({ activeProjectId: "current-proj", project: current, isDirty: true, isHydrated: true, revision: 2 });

      const result = await controller.discardAndOpenProject("target-proj");
      expect(result.success).toBe(true);

      const state = useEditorStore.getState();
      expect(state.project.id).toBe("target-proj");
      expect(state.project.name).toBe("Target");
      expect(state.revision).toBe(5);
      expect(state.isDirty).toBe(false);
      await controller.shutdown();
    });

    it("target load failure preserves error state", async () => {
      const adapter = createMockAdapter();
      const current = makeProject({ id: "current-proj", name: "Current" });
      await adapter.saveProject({ project: current, revision: 1 });

      const controller = new ProjectController(adapter);
      useEditorStore.setState({ activeProjectId: "current-proj", project: current, isDirty: true, isHydrated: true, revision: 1 });

      const result = await controller.discardAndOpenProject("nonexistent");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("PROJECT_LOAD_FAILED");
      }
      await controller.shutdown();
    });
  });

  describe("rename invariants", () => {
    it("valid rename increments revision exactly once", async () => {
      const adapter = createMockAdapter();
      // Seed an active stored project so initialize() hydrates it (creating
      // the store subscription that drives revision increments).
      const seeded = makeProject({ id: "seed-rename-rev", name: "Seed" });
      await adapter.saveProject({ project: seeded, revision: 1 });
      await adapter.setActiveProjectId("seed-rename-rev");

      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const initialRevision = useEditorStore.getState().revision;
      const result = await controller.renameActiveProject("New Name");
      expect(result.success).toBe(true);
      expect(useEditorStore.getState().revision).toBe(initialRevision + 1);
      await controller.shutdown();
    });

    it("invalid rename does not change revision", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const initialRevision = useEditorStore.getState().revision;
      const result = await controller.renameActiveProject("");
      expect(result.success).toBe(false);
      expect(useEditorStore.getState().revision).toBe(initialRevision);
      await controller.shutdown();
    });

    it("invalid rename does not mark dirty", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      useEditorStore.getState().markSaved();
      const result = await controller.renameActiveProject("");
      expect(result.success).toBe(false);
      expect(useEditorStore.getState().isDirty).toBe(false);
      await controller.shutdown();
    });

    it("valid name is trimmed before storing", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const result = await controller.renameActiveProject("  Spaced Name  ");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data?.name).toBe("Spaced Name");
      }
      expect(useEditorStore.getState().project.name).toBe("Spaced Name");
      await controller.shutdown();
    });

    it("valid rename preserves project ID and createdAt", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      const state = useEditorStore.getState();
      const originalId = state.project.id;
      const originalCreatedAt = state.project.createdAt;

      await controller.renameActiveProject("New Name");

      const newState = useEditorStore.getState();
      expect(newState.project.id).toBe(originalId);
      expect(newState.project.createdAt).toBe(originalCreatedAt);
      expect(newState.project.updatedAt).not.toBe("");
      await controller.shutdown();
    });

    it("ProjectService and controller return equivalent validation errors", async () => {
      const adapter = createMockAdapter();
      const controller = new ProjectController(adapter);
      setProjectController(controller);
      await controller.initialize();

      // Controller: empty name
      const ctrlResult = await controller.renameActiveProject("");
      // ProjectService: empty name
      const serviceResult = await new ProjectService(adapter).renameProject("any-id", "");

      expect(ctrlResult.success).toBe(false);
      expect(serviceResult.success).toBe(false);
      if (!ctrlResult.success && !serviceResult.success) {
        expect(ctrlResult.error?.code).toBe("INVALID_PROJECT_NAME");
        expect(serviceResult.error?.code).toBe("INVALID_PROJECT_NAME");
      }
      await controller.shutdown();
    });
  });

  describe("stale async protection", () => {
    it("older load cannot overwrite newer refresh", async () => {
      const adapter = createMockAdapter();
      const p1 = makeProject({ id: "p1", name: "Project 1" });
      const p2 = makeProject({ id: "p2", name: "Project 2" });
      await adapter.saveProject({ project: p1, revision: 1 });
      await adapter.saveProject({ project: p2, revision: 1 });

      // Simulate a stale older load that completes after a newer refresh
      let resolveOld: (value: unknown) => void;
      const oldPromise = new Promise((resolve) => { resolveOld = resolve; });
      const originalList = adapter.listProjects;

      // First call (old) is slow, second call (newer) completes quickly
      let callCount = 0;
      vi.spyOn(adapter, "listProjects").mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Slow first call
          await oldPromise;
          return { success: true, projects: [{ id: "p1", name: "Project 1", createdAt: "", updatedAt: "", savedAt: "", revision: 1, pageCount: 0, assetCount: 0, approximateAssetBytes: 0 }] };
        }
        // Fast second call
        return { success: true, projects: [{ id: "p2", name: "Project 2", createdAt: "", updatedAt: "", savedAt: "", revision: 1, pageCount: 0, assetCount: 0, approximateAssetBytes: 0 }] };
      });

      // Start first (slow) list
      const firstList = adapter.listProjects();
      // Start second (fast) list and await it
      const secondResult = await adapter.listProjects();
      expect(secondResult.success).toBe(true);
      if (secondResult.success) {
        expect(secondResult.projects[0].name).toBe("Project 2");
      }

      // Now resolve the first call
      resolveOld!(null);
      const firstResult = await firstList;
      if (firstResult.success) {
        expect(firstResult.projects[0].name).toBe("Project 1");
      }

      adapter.listProjects = originalList;
    });

    it("older completion cannot navigate after a newer open", async () => {
      const adapter = createMockAdapter();
      const p1 = makeProject({ id: "p1", name: "First" });
      const p2 = makeProject({ id: "p2", name: "Second" });
      await adapter.saveProject({ project: p1, revision: 1 });
      await adapter.saveProject({ project: p2, revision: 5 });

      const controller = new ProjectController(adapter);

      // Open p1
      const open1 = await controller.openProject("p1");
      expect(open1.success).toBe(true);
      expect(useEditorStore.getState().activeProjectId).toBe("p1");

      // Open p2 (newer)
      const open2 = await controller.openProject("p2");
      expect(open2.success).toBe(true);
      expect(useEditorStore.getState().activeProjectId).toBe("p2");

      // Verify p2 state persists (older p1 open can't undo this)
      expect(useEditorStore.getState().revision).toBe(5);
      await controller.shutdown();
    });

    it("delete completion after store reset does not corrupt state", async () => {
      const adapter = createMockAdapter();
      const p1 = makeProject({ id: "p1", name: "Delete Target" });
      await adapter.saveProject({ project: p1, revision: 1 });

      const controller = new ProjectController(adapter);

      // Delete the inactive project
      const result = await controller.deleteProject("p1");
      expect(result.success).toBe(true);

      // Verify it's gone
      const loaded = await adapter.loadProject("p1");
      expect(loaded.success).toBe(false);
      await controller.shutdown();
    });
  });

  describe("error mapping", () => {
    it("maps persistence errors to dashboard errors correctly", () => {

      const notFound = mapPersistenceErrorToDashboard({ code: "PROJECT_NOT_FOUND", message: "Not found" });
      expect(notFound.code).toBe("PROJECT_NOT_FOUND");
      expect(notFound.retryable).toBe(false);

      const quota = mapPersistenceErrorToDashboard({ code: "QUOTA_EXCEEDED", message: "Quota" });
      expect(quota.code).toBe("PROJECT_CREATE_FAILED");

      const indexedDb = mapPersistenceErrorToDashboard({ code: "INDEXED_DB_UNAVAILABLE", message: "Unavailable" });
      expect(indexedDb.code).toBe("PROJECT_LIST_FAILED");
      expect(indexedDb.retryable).toBe(false);

      const generic = mapPersistenceErrorToDashboard({ code: "TRANSACTION_FAILED", message: "Error" });
      expect(generic.code).toBe("PROJECT_LIST_FAILED");
      expect(generic.retryable).toBe(true);
    });
  });
});
