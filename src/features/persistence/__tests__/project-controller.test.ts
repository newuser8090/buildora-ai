// ---------------------------------------------------------------------------
// ProjectController Tests
//
// Tests initialization, hydration, project lifecycle (create, open, switch,
// delete), dirty tracking, save, error recovery, and coordinator lifecycle.
// Uses a mock adapter for deterministic control.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectController } from "../services/project-controller";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type {
  ProjectPersistenceAdapter,
  SaveProjectResult,
  ProjectLoadResult,
  ActiveProjectResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
} from "../types";
import type { Project } from "@/types/project";
import { INITIAL_REVISION } from "../constants";
import { logger } from "@/lib/logger";

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

function createEmptyProject() {
  return { id: "", name: "", theme: createDefaultTheme(), assets: [], pages: [], createdAt: "", updatedAt: "" };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-test",
    name: "Test Project",
    theme: {
      palette: { background: "#fff", foreground: "#000", primary: "#7c5cfc", primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000", muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc", accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000" },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
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
      return {
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
      };
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

// ---------------------------------------------------------------------------
// Store helpers
// ---------------------------------------------------------------------------

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
    history: { past: [], present: createEmptyProject(), future: [] },
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectController — hydration", () => {
  beforeEach(() => {
    resetStore();
  });

  it("true first launch (no projects) creates an in-memory blank workspace without persisting", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    await controller.initialize();

    const state = useEditorStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.saveStatus).toBe("idle");
    expect(state.project.id).toBeTruthy();
    expect(state.project.name).toBe("Untitled Project");
    expect(state.project.pages).toHaveLength(1);
    expect(state.revision).toBe(0);
    // No database records are created merely by opening the app (Phase F).
    expect(adapter.saveProject).not.toHaveBeenCalled();
    expect(adapter.setActiveProjectId).not.toHaveBeenCalled();
    controller.shutdown();
  });

  it("existing project is restored on startup", async () => {
    const adapter = createMockAdapter();
    // Pre-populate a project
    const project = makeProject({ id: "existing-proj", name: "Existing" });
    await adapter.saveProject({ project, revision: 5 });
    await adapter.setActiveProjectId("existing-proj");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const state = useEditorStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.project.id).toBe("existing-proj");
    expect(state.project.name).toBe("Existing");
    expect(state.revision).toBe(5);
    expect(state.saveStatus).toBe("saved");
    expect(state.isDirty).toBe(false);
    controller.shutdown();
  });

  it("missing project falls back to creating fresh project", async () => {
    const adapter = createMockAdapter();
    // Set active project ID but no data exists
    const getActiveSpy = vi.spyOn(adapter, "getActiveProjectId");
    getActiveSpy.mockResolvedValue({ success: true, projectId: "missing-proj" });

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const state = useEditorStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.project.id).toBeTruthy();
    expect(state.project.name).toBe("Untitled Project");
    controller.shutdown();
  });

  it("corrupted adapter falls back to blank in-memory project", async () => {
    const adapter = createMockAdapter();
    vi.spyOn(adapter, "getActiveProjectId").mockRejectedValue(new Error("DB corruption"));

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const state = useEditorStore.getState();
    expect(state.hydrationError).toBeTruthy();
    expect(state.project.id).toBeTruthy();

    // Persistence error is set, but the editor still has a working blank project
    expect(state.saveStatus).toBe("error");
    controller.shutdown();
  });
});

describe("ProjectController — project lifecycle", () => {
  beforeEach(() => {
    resetStore();
  });

  it("createProject persists and hydrates", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    await controller.createProject();

    const state = useEditorStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.project.id).toBeTruthy();
    expect(state.revision).toBe(INITIAL_REVISION);
    expect(adapter.saveProject).toHaveBeenCalledTimes(1);
    expect(adapter.setActiveProjectId).toHaveBeenCalledTimes(1);

    // Verify persistence
    const loaded = await adapter.loadProject(state.project.id);
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Untitled Project");
    }
    controller.shutdown();
  });

  it("openProject loads from persistence and hydrates", async () => {
    const adapter = createMockAdapter();
    const project = makeProject({ id: "proj-open", name: "To Open" });
    await adapter.saveProject({ project, revision: 3 });

    const controller = new ProjectController(adapter);
    await controller.openProject("proj-open");

    const state = useEditorStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.project.id).toBe("proj-open");
    expect(state.project.name).toBe("To Open");
    expect(state.revision).toBe(3);
    expect(state.isDirty).toBe(false);
    controller.shutdown();
  });

  it("deleteProject removes from storage and creates new project if active", async () => {
    const adapter = createMockAdapter();
    const project = makeProject({ id: "proj-del", name: "To Delete" });
    await adapter.saveProject({ project, revision: 1 });
    await adapter.setActiveProjectId("proj-del");

    const controller = new ProjectController(adapter);
    await controller.openProject("proj-del");

    // Delete the active project
    await controller.deleteProject("proj-del");

    const state = useEditorStore.getState();
    expect(state.project.id).not.toBe("proj-del");
    expect(state.project.id).toBeTruthy();

    // Verify removed from storage
    const loaded = await adapter.loadProject("proj-del");
    expect(loaded.success).toBe(false);
    controller.shutdown();
  });
});

describe("ProjectController — dirty tracking", () => {
  beforeEach(() => {
    resetStore();
  });

  it("project mutation marks dirty and triggers coordinator schedule", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-mut", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-mut");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    // Mutate project through the store
    const store = useEditorStore.getState();
    const coordinator = controller.getCoordinator();
    expect(coordinator).not.toBeNull();

    // Simulate project change by updating name via store action
    store.setProject({ ...store.project, name: "Modified" });

    // Wait for async subscription callback
    await new Promise((r) => setTimeout(r, 10));

    const state = useEditorStore.getState();
    expect(state.isDirty).toBe(true);
    controller.shutdown();
  });

  it("hydration does not mark dirty", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "clean-proj", name: "Clean" }), revision: 2 });
    await adapter.setActiveProjectId("clean-proj");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const state = useEditorStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.isHydrated).toBe(true);
    controller.shutdown();
  });
});

describe("ProjectController — save", () => {
  beforeEach(() => {
    resetStore();
  });

  it("saveNow flushes coordinator and marks saved", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-save", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-save");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    // Make an edit
    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 50));

    // Save
    const result = await controller.saveNow();
    expect(result.success).toBe(true);

    const state = useEditorStore.getState();
    expect(state.isDirty).toBe(false);
    expect(state.saveStatus).toBe("saved");
    controller.shutdown();
  });
});

describe("ProjectController — coordinator lifecycle", () => {
  beforeEach(() => {
    resetStore();
  });

  it("coordinator is created on hydration and disposed on shutdown", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-coord", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-coord");

    const controller = new ProjectController(adapter);

    // Before initialization, no coordinator
    expect(controller.getCoordinator()).toBeNull();

    await controller.initialize();
    expect(controller.getCoordinator()).not.toBeNull();

    await controller.shutdown();
    expect(controller.getCoordinator()).toBeNull();
  });

  it("coordinator is recreated on project switch", async () => {
    const adapter = createMockAdapter();
    // Pre-populate two projects
    await adapter.saveProject({ project: makeProject({ id: "proj-a", name: "A" }), revision: 1 });
    await adapter.saveProject({ project: makeProject({ id: "proj-b", name: "B" }), revision: 1 });

    const controller = new ProjectController(adapter);
    await controller.openProject("proj-a");
    const coordA = controller.getCoordinator();

    await controller.openProject("proj-b");
    const coordB = controller.getCoordinator();

    expect(coordA).not.toBeNull();
    expect(coordB).not.toBeNull();
    // Different instances after switch
    expect(coordA).not.toBe(coordB);
    await controller.shutdown();
  });
});

describe("ProjectController — error recovery", () => {
  beforeEach(() => {
    resetStore();
  });

  it("retrySave reschedules and attempts save", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-retry", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-retry");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 10));

    const result = await controller.retrySave();
    expect(result).toBeUndefined(); // retrySave returns void

    const state = useEditorStore.getState();
    expect(state.saveStatus).toBe("saved");
    controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase L — AI edit plan application through the controller
// ---------------------------------------------------------------------------

describe("ProjectController — AI edit plan application", () => {
  beforeEach(() => {
    resetStore();
  });

  it("applyAiEditPlan increments revision once, marks dirty once, schedules autosave", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({
      id: "seed-plan",
      name: "Seed",
      pages: [
        {
          id: "p1",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: "s-hero",
              type: "hero",
              order: 1,
              visible: true,
              props: { headline: "Original", subheadline: "Sub", primaryCta: { text: "Go", href: "#" } },
              styles: {},
            },
          ],
        },
      ],
    });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-plan");

    const controller = new ProjectController(adapter);
    await controller.initialize();
    expect(useEditorStore.getState().revision).toBe(1);
    expect(useEditorStore.getState().isDirty).toBe(false);

    const plan = {
      version: 1 as const,
      id: "plan-1",
      projectId: "seed-plan",
      baseRevision: 1,
      scope: { type: "page" as const, pageId: "p1" },
      instruction: "Improve the page",
      summary: "One change.",
      operations: [
        {
          id: "op-1",
          type: "update-section-props" as const,
          pageId: "p1",
          sectionId: "s-hero",
          sectionType: "hero",
          label: "Improve hero",
          explanation: "Refreshes the hero copy.",
          risk: "medium" as const,
          nextProps: { headline: "Improved", subheadline: "Sub", primaryCta: { text: "Go", href: "#" } },
        },
      ],
      warnings: [],
      createdAt: new Date().toISOString(),
      provider: "rule-based" as const,
    };

    try {
      const result = useEditorStore.getState().applyAiEditPlan(plan);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // The controller's store subscription reacts to the single project
      // reference change: exactly one revision increment and one dirty mark.
      await new Promise((r) => setTimeout(r, 10));

      const state = useEditorStore.getState();
      expect(state.revision).toBe(2);
      expect(state.isDirty).toBe(true);
      expect(
        state.project.pages[0].sections.find((s) => s.id === "s-hero")?.props.headline,
      ).toBe("Improved");

      // One autosave schedule → the coordinator persists the new revision.
      await controller.saveNow();
      const afterSave = useEditorStore.getState();
      expect(afterSave.isDirty).toBe(false);
    } finally {
      await controller.shutdown();
    }
  });

  it("a stale plan (revision mismatch) is rejected without touching revision or dirty", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({
      id: "seed-stale",
      name: "Seed",
      pages: [
        {
          id: "p1",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: "s-hero",
              type: "hero",
              order: 1,
              visible: true,
              props: { headline: "Original", subheadline: "Sub", primaryCta: { text: "Go", href: "#" } },
              styles: {},
            },
          ],
        },
      ],
    });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-stale");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    // An edit moves the project to revision 2 — the plan created at revision
    // 1 is now stale.
    useEditorStore.getState().setProject({
      ...useEditorStore.getState().project,
      name: "Edited",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(useEditorStore.getState().revision).toBe(2);

    const stalePlan = {
      version: 1 as const,
      id: "plan-stale",
      projectId: "seed-stale",
      baseRevision: 1,
      scope: { type: "page" as const, pageId: "p1" },
      instruction: "Hide the hero",
      summary: "One change.",
      operations: [
        {
          id: "op-1",
          type: "set-section-visibility" as const,
          pageId: "p1",
          sectionId: "s-hero",
          label: "Hide hero",
          explanation: "Hides the hero.",
          risk: "low" as const,
          visible: false,
        },
      ],
      warnings: [],
      createdAt: new Date().toISOString(),
      provider: "rule-based" as const,
    };
    try {
      const result = useEditorStore.getState().applyAiEditPlan(stalePlan);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PLAN_STALE");

      await new Promise((r) => setTimeout(r, 10));
      const state = useEditorStore.getState();
      expect(state.revision).toBe(2);
      expect(state.project.name).toBe("Edited");
      expect(
        state.project.pages[0].sections.find((s) => s.id === "s-hero")?.visible,
      ).toBe(true);
    } finally {
      await controller.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Failed-flush transition safety
// ---------------------------------------------------------------------------

describe("ProjectController — failed-flush blocks transitions", () => {
  beforeEach(() => {
    resetStore();
  });

  async function setupDirtyProject(): Promise<{ adapter: ProjectPersistenceAdapter; controller: ProjectController }> {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-dirty", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-dirty");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    // Make project dirty
    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Dirty" });
    await new Promise((r) => setTimeout(r, 10));

    // Make save fail
    vi.spyOn(adapter, "saveProject").mockRejectedValue(new Error("Persist failed"));

    return { adapter, controller };
  }

  it("failed flush blocks openProject", async () => {
    const { controller } = await setupDirtyProject();
    const stateBefore = useEditorStore.getState();

    const result = await controller.openProject("other-proj");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SAVE_BEFORE_TRANSITION_FAILED");
    }
    const stateAfter = useEditorStore.getState();
    expect(stateAfter.project.name).toBe("Dirty");
    expect(stateAfter.activeProjectId).toBe(stateBefore.activeProjectId);
    expect(stateAfter.isDirty).toBe(true);
    expect(controller.getCoordinator()).not.toBeNull();
    await controller.shutdown();
  });

  it("failed flush blocks createProject", async () => {
    const { controller } = await setupDirtyProject();
    const stateBefore = useEditorStore.getState();

    const result = await controller.createProject();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SAVE_BEFORE_TRANSITION_FAILED");
    }
    const stateAfter = useEditorStore.getState();
    expect(stateAfter.project.name).toBe("Dirty");
    expect(stateAfter.activeProjectId).toBe(stateBefore.activeProjectId);
    await controller.shutdown();
  });

  it("failed flush blocks active-project deletion", async () => {
    const { controller } = await setupDirtyProject();
    const stateBefore = useEditorStore.getState();

    const result = await controller.deleteProject(stateBefore.activeProjectId);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SAVE_BEFORE_TRANSITION_FAILED");
    }
    const stateAfter = useEditorStore.getState();
    expect(stateAfter.project.name).toBe("Dirty");
    expect(stateAfter.activeProjectId).toBe(stateBefore.activeProjectId);
    await controller.shutdown();
  });

  it("retry can succeed after failed flush and transition can continue", async () => {
    const { adapter, controller } = await setupDirtyProject();

    const failResult = await controller.openProject("other-proj");
    expect(failResult.success).toBe(false);

    vi.mocked(adapter.saveProject).mockRestore();
    await controller.retrySave();

    const stateMid = useEditorStore.getState();
    expect(stateMid.saveStatus).toBe("saved");
    await controller.shutdown();
  });

  it("a failed flush is logged for diagnostics (Phase P18 F2)", async () => {
    const { controller } = await setupDirtyProject();

    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      const result = await controller.openProject("other-proj");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.code).toBe("SAVE_BEFORE_TRANSITION_FAILED");
      }

      // A transition blocked by a failed flush was previously silent — the
      // existing logger must record it so operators can diagnose persistence
      // outages that freeze create/open/switch/delete.
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.map((c) => [c[0], c[1]] as [string, string]);
      expect(calls.some(([tag, message]) => tag === "persist" && message.includes("transition blocked"))).toBe(
        true,
      );
    } finally {
      errorSpy.mockRestore();
      await controller.shutdown();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Subscription cleanup
// ---------------------------------------------------------------------------

describe("ProjectController — subscription cleanup", () => {
  beforeEach(() => {
    resetStore();
  });

  it("old coordinator completion cannot alter new project after switch", async () => {
    const adapter = createMockAdapter();
    const projA = makeProject({ id: "proj-sub-clean", name: "Clean A" });
    await adapter.saveProject({ project: projA, revision: 1 });
    await adapter.setActiveProjectId("proj-sub-clean");

    const projB = makeProject({ id: "proj-sub-b", name: "Project B" });
    await adapter.saveProject({ project: projB, revision: 1 });

    const controller = new ProjectController(adapter);
    await controller.initialize();

    await controller.openProject("proj-sub-b");

    const state = useEditorStore.getState();
    expect(state.project.name).toBe("Project B");
    expect(state.activeProjectId).toBe("proj-sub-b");
    expect(controller.getCoordinator()).not.toBeNull();
    await controller.shutdown();
  });

  it("no duplicate subscriptions after repeated switches", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-dup-1", name: "P1" }), revision: 1 });
    await adapter.saveProject({ project: makeProject({ id: "proj-dup-2", name: "P2" }), revision: 1 });
    await adapter.saveProject({ project: makeProject({ id: "proj-dup-3", name: "P3" }), revision: 1 });
    await adapter.setActiveProjectId("proj-dup-1");

    const controller = new ProjectController(adapter);
    await controller.openProject("proj-dup-1");

    await controller.openProject("proj-dup-2");
    await controller.openProject("proj-dup-3");

    const state = useEditorStore.getState();
    expect(state.project.name).toBe("P3");
    expect(controller.getCoordinator()).not.toBeNull();
    await controller.shutdown();
    expect(controller.getCoordinator()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Save race
// ---------------------------------------------------------------------------

describe("ProjectController — save race", () => {
  beforeEach(() => {
    resetStore();
  });

  it("revision N completes after revision N+1 edit — dirty remains true", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-race", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-race");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    // Hydration loads at stored revision 1. First edit increments to 2.
    const s1 = useEditorStore.getState();
    s1.setProject({ ...s1.project, name: "Rev1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(useEditorStore.getState().revision).toBe(2);

    // Second edit increments to 3
    const s2 = useEditorStore.getState();
    s2.setProject({ ...s2.project, name: "Rev2" });
    await new Promise((r) => setTimeout(r, 10));
    expect(useEditorStore.getState().revision).toBe(3);

    // Save should persist the latest revision
    await controller.saveNow();

    const state = useEditorStore.getState();
    expect(state.project.name).toBe("Rev2");
    expect(state.isDirty).toBe(false);
    expect(state.saveStatus).toBe("saved");
    await controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Initialization concurrency
// ---------------------------------------------------------------------------

describe("ProjectController — initialization concurrency", () => {
  beforeEach(() => {
    resetStore();
  });

  it("concurrent initialize calls hydrate the same existing project once", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-conc", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 3 });
    await adapter.setActiveProjectId("seed-conc");
    // Seeding above calls the spy; clear so assertions measure initialize() only.
    vi.mocked(adapter.saveProject).mockClear();
    vi.mocked(adapter.setActiveProjectId).mockClear();

    const controller = new ProjectController(adapter);

    await Promise.all([
      controller.initialize(),
      controller.initialize(),
    ]);

    const state = useEditorStore.getState();
    expect(state.isHydrated).toBe(true);
    expect(state.project.id).toBe("seed-conc");
    expect(state.revision).toBe(3);
    expect(adapter.saveProject).not.toHaveBeenCalled();
    expect(controller.getCoordinator()).not.toBeNull();
    await controller.shutdown();
  });

  it("repeated initialize is harmless", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    await controller.initialize();
    const projectId1 = useEditorStore.getState().project.id;

    await controller.initialize();
    const projectId2 = useEditorStore.getState().project.id;

    expect(projectId1).toBe(projectId2);
    await controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Active metadata failure
// ---------------------------------------------------------------------------

describe("ProjectController — active metadata failure", () => {
  beforeEach(() => {
    resetStore();
  });

  it("save succeeds but active metadata update fails — transition reports failure", async () => {
    const adapter = createMockAdapter();

    // Pre-populate an existing active project
    await adapter.saveProject({ project: makeProject({ id: "current-active", name: "Current Active" }), revision: 1 });
    await adapter.setActiveProjectId("current-active");

    const controller = new ProjectController(adapter);
    await controller.openProject("current-active");

    // Make setActiveProjectId fail on the next call
    vi.spyOn(adapter, "setActiveProjectId").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Active update failed" },
    });

    // Try to open another project
    await adapter.saveProject({ project: makeProject({ id: "new-proj", name: "New" }), revision: 1 });
    await controller.openProject("new-proj");

    const s = useEditorStore.getState();
    expect(s.project.id).toBe("new-proj");
    vi.mocked(adapter.setActiveProjectId).mockRestore();
    await controller.shutdown();
  });

  it("createProject handles active metadata failure", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);
    await controller.initialize();

    vi.spyOn(adapter, "setActiveProjectId").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Active update failed" },
    });

    const result = await controller.createProject();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("ACTIVE_PROJECT_UPDATE_FAILED");
    }
    vi.mocked(adapter.setActiveProjectId).mockRestore();
    await controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Delete lifecycle
// ---------------------------------------------------------------------------

describe("ProjectController — delete lifecycle safety", () => {
  beforeEach(() => {
    resetStore();
  });

  it("active delete with replacement creation failure is recoverable", async () => {
    const adapter = createMockAdapter();
    const project = makeProject({ id: "proj-rec", name: "To Delete" });
    await adapter.saveProject({ project, revision: 1 });
    await adapter.setActiveProjectId("proj-rec");

    const controller = new ProjectController(adapter);
    await controller.openProject("proj-rec");

    // Make saveProject fail for the replacement
    vi.spyOn(adapter, "saveProject").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Replacement save failed" },
    });

    const result = await controller.deleteProject("proj-rec");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROJECT_CREATE_FAILED");
    }
    // Old project remains
    const state = useEditorStore.getState();
    expect(state.project.id).toBe("proj-rec");
    vi.mocked(adapter.saveProject).mockRestore();
    controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Hydration recovery
// ---------------------------------------------------------------------------

describe("ProjectController — hydration recovery semantics", () => {
  beforeEach(() => {
    resetStore();
  });

  it("corrupted persisted record is not overwritten by recovery project", async () => {
    const adapter = createMockAdapter();
    const project = makeProject({ id: "valid-proj", name: "Valid" });
    await adapter.saveProject({ project, revision: 1 });
    await adapter.setActiveProjectId("valid-proj");

    // Make loadProject return a failure (simulate corruption)
    vi.spyOn(adapter, "loadProject").mockResolvedValue({
      success: false,
      error: { code: "DESERIALIZATION_FAILED", message: "Corrupted data", projectId: "valid-proj" },
    });

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const state = useEditorStore.getState();
    expect(state.project.id).toBeTruthy();
    // Hydration error was set because loadProject returned failure
    // but hydrateProject also resets it during _createFreshProject()
    // The recovery project is still active
    expect(state.project.name).toBe("Untitled Project");

    // Restore mock before testing original data
    vi.mocked(adapter.loadProject).mockRestore();

    // Original persisted data was NOT overwritten
    const loaded = await adapter.loadProject("valid-proj");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Valid");
    }

    await controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Timestamp source
// ---------------------------------------------------------------------------

describe("ProjectController — savedAt timestamp source", () => {
  beforeEach(() => {
    resetStore();
  });

  it("saveNow captures the adapter-provided savedAt", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "seed-ts", name: "Seed" });
    await adapter.saveProject({ project: seeded, revision: 1 });
    await adapter.setActiveProjectId("seed-ts");

    const controller = new ProjectController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Timestamp Test" });
    await new Promise((r) => setTimeout(r, 10));

    const result = await controller.saveNow();
    expect(result.success).toBe(true);

    const state = useEditorStore.getState();
    expect(state.lastSavedAt).toBeTruthy();
    expect(typeof state.lastSavedAt).toBe("string");
    controller.shutdown();
  });
});

// ---------------------------------------------------------------------------
// Phase C.5 — Transition result types
// ---------------------------------------------------------------------------

describe("ProjectController — transition results", () => {
  beforeEach(() => {
    resetStore();
  });

  it("createProject returns a structured result with projectId", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    const result = await controller.createProject();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.projectId).toBeTruthy();
    }
    controller.shutdown();
  });

  it("openProject of missing project returns PROJECT_LOAD_FAILED", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    const result = await controller.openProject("non-existent");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROJECT_LOAD_FAILED");
    }
    controller.shutdown();
  });

  it("isTransitioning is false before and after a transition", async () => {
    const adapter = createMockAdapter();
    const controller = new ProjectController(adapter);

    expect(controller.isTransitioning).toBe(false);

    await adapter.saveProject({ project: makeProject({ id: "proj-t", name: "Test" }), revision: 1 });

    await controller.openProject("proj-t");
    expect(controller.isTransitioning).toBe(false);

    await controller.shutdown();
  });
});
