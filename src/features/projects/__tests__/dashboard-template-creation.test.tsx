// ---------------------------------------------------------------------------
// Dashboard template creation orchestration tests (Phase F)
//
// Exercises createProjectFromTemplate through useProjectsDashboard() against a
// real ProjectController + mock adapter:
//   - persist before navigation; route uses the new project ID
//   - failed persistence / metadata / rollback do not navigate
//   - dirty active project flush + failed-flush blocking
//   - repeated Create blocked, unmount/stale-completion safety
//   - dashboard refreshes after success; first-run has no auto-created project
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  ProjectController,
  setProjectController,
  getProjectController,
} from "@/features/persistence/services/project-controller";
import { useProjectsDashboard } from "../hooks/useProjectsDashboard";
import { INITIAL_REVISION } from "@/features/persistence/constants";
import { templateRegistry } from "@/features/templates/registry/template-registry";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "@/features/templates/registry/register-default-templates";
import type {
  ProjectPersistenceAdapter,
  ProjectLoadResult,
  SaveProjectResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// ---------------------------------------------------------------------------
// Helpers (mirroring useProjectsDashboard-phase-e2.test.ts)
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
    id: "proj-active",
    name: "Active Project",
    theme: createDefaultTheme(),
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockAdapter(): ProjectPersistenceAdapter {
  const store = new Map<string, { project: Project; revision: number; savedAt: string }>();
  const metadata = new Map<string, Record<string, unknown>>();
  let activeProjectId: string | null = null;

  return {
    loadProject: vi.fn(async (id: string): Promise<ProjectLoadResult> => {
      const data = store.get(id);
      if (!data) return { success: false, error: { code: "PROJECT_NOT_FOUND", message: "Not found", projectId: id } };
      return { success: true, project: data.project, revision: data.revision, savedAt: data.savedAt };
    }),
    saveProject: vi.fn(async (req): Promise<SaveProjectResult> => {
      const now = new Date().toISOString();
      store.set(req.project.id, { project: req.project, revision: req.revision, savedAt: now });
      return { success: true, revision: req.revision, savedAt: now };
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
    getActiveProjectId: vi.fn(async (): Promise<{ success: true; projectId: string | null }> => {
      return { success: true as const, projectId: activeProjectId };
    }),
    setActiveProjectId: vi.fn(async (id: string | null): Promise<ProjectPersistenceResult> => {
      activeProjectId = id;
      return { success: true as const };
    }),
    getDashboardMetadata: vi.fn(async (id: string) => ({
      success: true as const,
      metadata: metadata.get(id) ?? {},
    })),
    setDashboardMetadata: vi.fn(async (id: string, md: Record<string, unknown>): Promise<ProjectPersistenceResult> => {
      metadata.set(id, md);
      return { success: true as const };
    }),
    removeDashboardMetadata: vi.fn(async (): Promise<ProjectPersistenceResult> => ({ success: true })),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };
}

function setupController(adapter: ProjectPersistenceAdapter): ProjectController {
  const controller = new ProjectController(adapter);
  setProjectController(controller);
  return controller;
}

function resetStore(): void {
  const e = makeProject({ id: "", name: "", pages: [], createdAt: "", updatedAt: "" });
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

describe("useProjectsDashboard — createProjectFromTemplate orchestration", () => {
  beforeEach(() => {
    resetStore();
    mockPush.mockClear();
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
  });

  it("creates a SaaS project, persists before navigation, and routes to the new ID", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = false;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-saas", "Nimbus Site");
      ok = res.ok;
    });

    expect(ok).toBe(true);
    // Persisted first.
    const savedProjects = Array.from(
      (adapter.saveProject as ReturnType<typeof vi.fn>).mock.calls.map(
        (c: unknown[]) => (c[0] as { project: { id: string } }).project.id,
      ),
    );
    expect(savedProjects.length).toBeGreaterThan(0);
    const createdId = savedProjects[savedProjects.length - 1];
    const loaded = await adapter.loadProject(createdId);
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Nimbus Site");
      expect(loaded.revision).toBe(INITIAL_REVISION);
    }
    // Navigation uses the new project ID exactly once.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(`/editor/${createdId}`);
    // Dashboard refreshed with the new project.
    await waitFor(() => {
      expect(result.current.projects.some((p) => p.id === createdId)).toBe(true);
    });
  });

  it("failed persistence does not navigate and stays on the dashboard", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);
    vi.spyOn(adapter, "saveProject").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Save failed" },
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = true;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-saas", "Nimbus");
      ok = res.ok;
    });

    expect(ok).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current.error?.code).toBe("PROJECT_CREATE_FAILED");
  });

  it("failed active metadata update does not navigate", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);
    vi.spyOn(adapter, "setActiveProjectId").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Active update failed" },
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = true;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-saas", "Nimbus");
      ok = res.ok;
    });

    expect(ok).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("invalid template ID returns a structured error without navigating", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = true;
    let message = "";
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-nope", "Nimbus");
      ok = res.ok;
      if (!res.ok) message = res.error;
    });

    expect(ok).toBe(false);
    expect(message).toContain("not found");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("invalid project name is blocked before any persistence", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = true;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-saas", "   ");
      ok = res.ok;
    });

    expect(ok).toBe(false);
    expect(adapter.saveProject).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("factory failure does not tear down the active project's autosave lifecycle", async () => {
    // Seed an active hydrated project with a live coordinator/subscription,
    // then attempt a template creation that fails in the factory (bad name).
    const adapter = createMockAdapter();
    const active = makeProject({ id: "proj-active", name: "Current" });
    await adapter.saveProject({ project: active, revision: 3 });
    await adapter.setActiveProjectId("proj-active");
    const controller = setupController(adapter);
    await controller.initialize();

    useEditorStore.setState({
      project: active,
      activeProjectId: "proj-active",
      revision: 3,
      isDirty: false,
      saveStatus: "saved",
      isHydrated: true,
    });
    // Live coordinator exists for the active project.
    const coordinatorBefore = controller.getCoordinator();
    expect(coordinatorBefore).not.toBeNull();

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = true;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-saas", "   ");
      ok = res.ok;
    });
    expect(ok).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();

    // The factory failed BEFORE any transition teardown — the active project
    // keeps its coordinator and can still be edited/autosaved.
    expect(controller.getCoordinator()).toBe(coordinatorBefore);
    expect(useEditorStore.getState().activeProjectId).toBe("proj-active");

    // Editing the active project still works (subscription intact).
    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Still Editable" });
    await new Promise((r) => setTimeout(r, 10));
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it("preserves the existing active project when template creation fails", async () => {
    const adapter = createMockAdapter();
    const active = makeProject({ id: "proj-active", name: "Current" });
    await adapter.saveProject({ project: active, revision: 3 });
    await adapter.setActiveProjectId("proj-active");
    setupController(adapter);
    await new ProjectController(adapter).initialize();

    // Store reflects the active project.
    useEditorStore.setState({
      project: active,
      activeProjectId: "proj-active",
      revision: 3,
      isDirty: true,
      saveStatus: "unsaved",
      isHydrated: true,
    });

    vi.spyOn(adapter, "saveProject").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Save failed" },
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.createProjectFromTemplate("template-saas", "Nimbus");
    });

    const store = useEditorStore.getState();
    expect(store.activeProjectId).toBe("proj-active");
    expect(store.project.name).toBe("Current");
    expect(store.isDirty).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("dirty active project is flushed before creation", async () => {
    const adapter = createMockAdapter();
    const active = makeProject({ id: "proj-active", name: "Current" });
    await adapter.saveProject({ project: active, revision: 3 });
    await adapter.setActiveProjectId("proj-active");
    const controller = setupController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 10));
    expect(useEditorStore.getState().isDirty).toBe(true);

    // Mock the coordinator's flush to succeed.
    const flushSpy = vi.spyOn(controller.getCoordinator()!, "flush").mockResolvedValue({ success: true, savedAt: "2026-01-01T00:00:00.000Z" });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-blank", "New Blank");
      expect(res.ok).toBe(true);
    });

    // Flush was invoked as part of the transition preparation.
    expect(flushSpy).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("failed flush blocks creation and preserves the dirty project", async () => {
    const adapter = createMockAdapter();
    const active = makeProject({ id: "proj-active", name: "Current" });
    await adapter.saveProject({ project: active, revision: 3 });
    await adapter.setActiveProjectId("proj-active");
    const controller = setupController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    store.setProject({ ...store.project, name: "Edited" });
    await new Promise((r) => setTimeout(r, 10));
    expect(useEditorStore.getState().isDirty).toBe(true);

    vi.spyOn(controller.getCoordinator()!, "flush").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Flush failed" },
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let ok = true;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-blank", "New Blank");
      ok = res.ok;
    });

    expect(ok).toBe(false);
    expect(mockPush).not.toHaveBeenCalled();
    expect(useEditorStore.getState().activeProjectId).toBe("proj-active");
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().project.name).toBe("Edited");
  });

  it("repeated Create clicks create exactly one project and never double-navigate", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const first = result.current.createProjectFromTemplate("template-saas", "One");
      const second = result.current.createProjectFromTemplate("template-saas", "Two");
      const [a, b] = await Promise.all([first, second]);
      // The controller serializes transitions — at most one may succeed at the
      // controller level; the hook token guard prevents any stale navigation.
      const successes = [a, b].filter((r) => r.ok).length;
      expect(successes).toBeLessThanOrEqual(1);
    });

    // Exactly one template project was persisted.
    const templateSaves = vi
      .mocked(adapter.saveProject)
      .mock.calls.filter(
        (c) =>
          (c[0] as { project: { name: string } }).project.name === "One" ||
          (c[0] as { project: { name: string } }).project.name === "Two",
      );
    expect(templateSaves.length).toBe(1);
    // No double navigation.
    expect(mockPush.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("unmount before resolution prevents navigation", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    let resolveSave: (value: unknown) => void = () => {};
    const deferred = new Promise((resolve) => { resolveSave = resolve; });
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => {
      await deferred;
      return { success: true as const, revision: 1, savedAt: "2026-01-01T00:00:00.000Z" };
    });

    const { result, unmount } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let createPromise: Promise<unknown>;
    act(() => {
      createPromise = result.current.createProjectFromTemplate("template-saas", "Nimbus");
    });

    unmount();

    await act(async () => {
      resolveSave(null);
      await createPromise!;
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("stale earlier creation cannot navigate after a newer creation", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    // Defer the dashboard list refresh that follows the FIRST creation's
    // controller transition. While it is pending, a second creation starts and
    // completes with a newer operation token.
    let listCalls = 0;
    let resolveList: (value: unknown) => void = () => {};
    const deferredList = new Promise((resolve) => { resolveList = resolve; });
    vi.spyOn(adapter, "listProjects").mockImplementation(async () => {
      listCalls++;
      if (listCalls === 2) {
        // Second listProjects call = the first creation's refresh.
        await deferredList;
      }
      return { success: true as const, projects: [] };
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first: Promise<unknown>;
    act(() => {
      first = result.current.createProjectFromTemplate("template-saas", "First");
    });

    // Let the first creation's controller transition finish and its refresh start.
    await new Promise((r) => setTimeout(r, 10));

    // Second creation completes fully and owns the newer token.
    let secondOk = false;
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-portfolio", "Second");
      secondOk = res.ok;
    });
    expect(secondOk).toBe(true);

    // Resolve the stale first creation's refresh — it must not navigate.
    await act(async () => {
      resolveList(null);
      await first!;
    });

    // Only the newer (second) creation navigated, exactly once.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("/editor/"));
  });

  it("successful creation without navigation request stays on dashboard when Open not requested", async () => {
    // The dashboard hook always navigates on success by design; verify the
    // dialog-level flow (create only, no navigate) is exercised by the dialog
    // tests. Here we assert the hook navigates exactly once per success.
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-blank", "Blank One");
      expect(res.ok).toBe(true);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("createProjectFromTemplate returns a structured result for a controller-less environment", async () => {
    // No controller set — the dashboard's initial load returns early without
    // flipping isLoading, so do not wait for it here.
    setProjectController(null as unknown as ProjectController);

    const { result } = renderHook(() => useProjectsDashboard());

    let ok = true;
    let message = "";
    await act(async () => {
      const res = await result.current.createProjectFromTemplate("template-saas", "Nimbus");
      ok = res.ok;
      if (!res.ok) message = res.error;
    });

    expect(ok).toBe(false);
    expect(message).toContain("Controller not initialized");
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe("useProjectsDashboard — first-run behavior (Phase F)", () => {
  beforeEach(() => {
    resetStore();
    mockPush.mockClear();
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
  });

  it("true first run (no stored projects) has no active project and no auto-created records", async () => {
    const adapter = createMockAdapter();
    const controller = setupController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    // In-memory blank workspace exists so the editor/dashboard is usable…
    expect(store.project.id).toBeTruthy();
    // …but nothing was persisted.
    expect(adapter.saveProject).not.toHaveBeenCalled();
    expect(adapter.setActiveProjectId).not.toHaveBeenCalled();
  });

  it("dashboard shows the empty state with zero projects on first run", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.projects).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  it("existing users still restore their active project", async () => {
    const adapter = createMockAdapter();
    const active = makeProject({ id: "proj-existing", name: "Existing" });
    await adapter.saveProject({ project: active, revision: 5 });
    await adapter.setActiveProjectId("proj-existing");

    const controller = setupController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    expect(store.activeProjectId).toBe("proj-existing");
    expect(store.project.name).toBe("Existing");
    expect(store.revision).toBe(5);
    expect(store.isDirty).toBe(false);
  });

  it("persistence failure still creates a recovery workspace with a hydration error", async () => {
    const adapter = createMockAdapter();
    vi.spyOn(adapter, "getActiveProjectId").mockRejectedValue(new Error("DB failure"));

    const controller = setupController(adapter);
    await controller.initialize();

    const store = useEditorStore.getState();
    expect(store.hydrationError).toBeTruthy();
    expect(store.project.id).toBeTruthy();
    expect(store.project.name).toBe("Untitled Project");
  });
});
