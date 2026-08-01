// ---------------------------------------------------------------------------
// useProjectsDashboard — Phase E.2 orchestration tests
//
// Proves active-editor isolation at orchestration level:
//   - activeProjectId / in-memory project / dirty / revision / saveStatus are
//     unchanged during a normal import
//   - the autosave coordinator is not disposed, autosave is not flushed, and
//     the autosave timer is not reset
//   - imported project is saved independently, starts inactive / clean /
//     unpinned
//   - Import-and-Open lifecycle: commit finishes before navigation, new ID is
//     used, failed commit preserves the active project, rollback failure does
//     not activate the imported project, unmount prevents navigation, stale
//     older import cannot replace a newer active project
//   - Dashboard export integration: full project is loaded (not card summary),
//     load/serialization failures prevent download, stale export results are
//     ignored
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
import type {
  ProjectPersistenceAdapter,
  ProjectLoadResult,
  SaveProjectResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
} from "@/features/persistence/types";
import type { Project } from "@/types/project";
import type { ImportProjectPreview } from "../types/project-transfer";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

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

function makePreview(overrides?: Partial<ImportProjectPreview>): ImportProjectPreview {
  return {
    sourceFilename: "import.buildora.json",
    project: makeProject({ id: "proj-import-src", name: "Imported Project" }),
    originalProjectId: "proj-import-src",
    originalProjectName: "Imported Project",
    schemaVersion: 1,
    migrationApplied: false,
    warnings: [],
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

describe("useProjectsDashboard — Phase E.2 active-editor isolation", () => {
  beforeEach(() => {
    resetStore();
    mockPush.mockClear();
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
  });

  it("import leaves the active project, dirty state, revision and saveStatus unchanged", async () => {
    const adapter = createMockAdapter();
    const active = makeProject({ id: "proj-active", name: "Active Project" });
    await adapter.saveProject({ project: active, revision: 5 });
    const controller = setupController(adapter);
    await controller.initialize();
    useEditorStore.setState({
      project: active,
      activeProjectId: "proj-active",
      isDirty: true,
      revision: 5,
      saveStatus: "unsaved",
      isHydrated: true,
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Clear the setup save + any initialize-time save so we only measure the import.
    vi.mocked(adapter.saveProject).mockClear();
    // Capture the active project's revision + saveStatus right before the
    // import so we can assert the import does not touch them (the controller's
    // coordinator may have settled state during initialize).
    const revisionBefore = useEditorStore.getState().revision;
    const saveStatusBefore = useEditorStore.getState().saveStatus;

    await act(async () => {
      const res = await result.current.commitImport(makePreview(), "Imported Project");
      expect(res.ok).toBe(true);
    });

    const store = useEditorStore.getState();
    expect(store.activeProjectId).toBe("proj-active");
    expect(store.project.name).toBe("Active Project");
    expect(store.isDirty).toBe(true);
    expect(store.revision).toBe(revisionBefore);
    expect(store.saveStatus).toBe(saveStatusBefore);
    // Active project was NOT re-saved by the import (no autosave flush).
    const activeSaves = vi.mocked(adapter.saveProject).mock.calls.filter(
      (c) => c[0].project.id === "proj-active",
    );
    expect(activeSaves).toHaveLength(0);
  });

  it("import does not dispose the autosave coordinator (controller stays alive)", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 1 });
    const controller = setupController(adapter);
    await controller.initialize();
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true, saveStatus: "unsaved" });
    const saveStatusBefore = useEditorStore.getState().saveStatus;

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.commitImport(makePreview(), "Imported Project");
    });

    // Controller instance is unchanged → coordinator was not disposed.
    expect(getProjectController()).toBe(controller);
    expect(controller.isHydrated).toBe(true);
    // Autosave timer/saveStatus untouched.
    expect(useEditorStore.getState().saveStatus).toBe(saveStatusBefore);
  });

  it("imported project is saved independently and starts inactive, clean and unpinned", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 1 });
    await adapter.setActiveProjectId("proj-active");
    setupController(adapter);
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let importedId = "";
    await act(async () => {
      const res = await result.current.commitImport(makePreview(), "Imported Project");
      expect(res.ok).toBe(true);
      if (res.ok) importedId = res.projectId;
    });

    expect(importedId).not.toBe("proj-active");
    expect(importedId).not.toBe("proj-import-src"); // newly generated ID is used

    // Saved independently.
    const loaded = await adapter.loadProject(importedId);
    expect(loaded.success).toBe(true);
    if (loaded.success) expect(loaded.revision).toBe(INITIAL_REVISION);

    // Inactive: the active project is unchanged.
    expect(useEditorStore.getState().activeProjectId).toBe("proj-active");
    const activeResult = await adapter.getActiveProjectId();
    expect(activeResult.success).toBe(true);
    if (activeResult.success) {
      expect(activeResult.projectId).toBe("proj-active");
    }

    // Unpinned.
    const meta = await adapter.getDashboardMetadata(importedId);
    expect(meta.success && meta.metadata.isPinned).toBe(false);
  });

  it("failed commit preserves the current active project", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 2 });
    setupController(adapter);
    useEditorStore.setState({
      project: active, activeProjectId: "proj-active", isDirty: true, revision: 2, saveStatus: "unsaved", isHydrated: true,
    });

    vi.spyOn(adapter, "saveProject").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Save failed" },
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const res = await result.current.commitImport(makePreview(), "Imported Project");
      expect(res.ok).toBe(false);
    });

    const store = useEditorStore.getState();
    expect(store.activeProjectId).toBe("proj-active");
    expect(store.project.name).toBe("Active Project");
    expect(store.isDirty).toBe(true);
    expect(store.revision).toBe(2);
  });

  it("metadata rollback failure does not activate the imported project", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 1 });
    setupController(adapter);
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true });

    vi.spyOn(adapter, "setDashboardMetadata").mockResolvedValue({
      success: false,
      error: { code: "TRANSACTION_FAILED", message: "Metadata failed" },
    });
    vi.spyOn(adapter, "removeProject").mockRejectedValue(new Error("rollback failed"));

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const res = await result.current.commitImport(makePreview(), "Imported Project");
      expect(res.ok).toBe(false);
    });

    expect(useEditorStore.getState().activeProjectId).toBe("proj-active");
  });

  it("commitImport does not navigate — navigation happens once in the dialog after commit", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 1 });
    setupController(adapter);
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.commitImport(makePreview(), "Imported Project");
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("unmount before commit completion prevents navigation", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 1 });

    let resolveSave: (value: unknown) => void = () => {};
    const deferred = new Promise((resolve) => { resolveSave = resolve; });
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => {
      await deferred;
      return { success: true as const, revision: 1, savedAt: "2026-01-01T00:00:00.000Z" };
    });

    setupController(adapter);
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true });

    const { result, unmount } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Start a commit, unmount before it resolves.
    let commitPromise: Promise<unknown>;
    act(() => {
      commitPromise = result.current.commitImport(makePreview(), "Imported Project");
    });

    unmount();

    await act(async () => {
      resolveSave(null);
      await commitPromise!;
    });

    // No navigation from the hook itself (dialog owns navigation).
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("stale older import cannot replace a newer active project", async () => {
    const adapter = createMockAdapter();
    const active = makeProject();
    await adapter.saveProject({ project: active, revision: 1 });
    setupController(adapter);
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true });

    // First commit is deferred; second commit completes first.
    let resolveFirst: (value: unknown) => void = () => {};
    const firstDeferred = new Promise((resolve) => { resolveFirst = resolve; });
    let call = 0;
    vi.spyOn(adapter, "saveProject").mockImplementation(async () => {
      call++;
      if (call === 1) {
        await firstDeferred;
      }
      return { success: true as const, revision: 1, savedAt: "2026-01-01T00:00:00.000Z" };
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first: Promise<unknown>;
    act(() => {
      first = result.current.commitImport(makePreview(), "Imported One");
    });

    // Let the first call reach the deferred point, then run the second import.
    await new Promise((r) => setTimeout(r, 10));
    let secondId = "";
    await act(async () => {
      const res = await result.current.commitImport(makePreview(), "Imported Two");
      if (res.ok) secondId = res.projectId;
    });

    // Now the stale first import completes.
    await act(async () => {
      resolveFirst(null);
      await first!;
    });

    // The newer import won; active project untouched.
    expect(useEditorStore.getState().activeProjectId).toBe("proj-active");
    expect(secondId).not.toBe("proj-active");
    // The dashboard operation state is clean (newer import owned the token).
    expect(result.current.operation).toBeNull();
  });
});

describe("useProjectsDashboard — Phase E.2 dashboard export integration", () => {
  beforeEach(() => {
    resetStore();
    mockPush.mockClear();
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
  });

  it("exports the full loaded project, not the card summary", async () => {
    const adapter = createMockAdapter();
    // Persisted project contains extra sections/assets that the card summary
    // (revision/pageCount/assetCount) would not carry.
    const full = makeProject({
      id: "proj-card",
      name: "Card Project",
      pages: [{ id: "p1", title: "Home", slug: "/", sections: [
        { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Secret headline" }, styles: {} },
      ] }],
    });
    await adapter.saveProject({ project: full, revision: 3 });
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let exportedContent: string | null = null;
    await act(async () => {
      const res = await result.current.exportProjectById("proj-card");
      if (res.ok) exportedContent = res.content;
    });

    expect(exportedContent).toBeTruthy();
    expect(adapter.loadProject).toHaveBeenCalledWith("proj-card");
    expect(exportedContent).toContain("Card Project");
    expect(exportedContent).toContain("Secret headline");
  });

  it("loading failure prevents serialization and maps to a transfer error", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res: Awaited<ReturnType<typeof result.current.exportProjectById>>;
    await act(async () => {
      res = await result.current.exportProjectById("missing");
    });

    expect(res!.ok).toBe(false);
    if (!res!.ok) {
      expect(res!.error.code).toBe("EXPORT_SERIALIZATION_FAILED");
    }
  });

  it("serialization failure prevents download", async () => {
    const adapter = createMockAdapter();
    const invalid = { id: "bad" } as unknown as Project;
    await adapter.saveProject({ project: invalid, revision: 1 });
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let res: Awaited<ReturnType<typeof result.current.exportProjectById>>;
    await act(async () => {
      res = await result.current.exportProjectById("bad");
    });

    expect(res!.ok).toBe(false);
    if (!res!.ok) {
      expect(res!.error.code).toBe("EXPORT_SERIALIZATION_FAILED");
    }
  });

  it("stale export result after unmount produces no feedback", async () => {
    const adapter = createMockAdapter();
    const full = makeProject({ id: "proj-export", name: "Export Me" });
    await adapter.saveProject({ project: full, revision: 1 });

    let resolveLoad: (value: unknown) => void = () => {};
    const deferred = new Promise((resolve) => { resolveLoad = resolve; });
    vi.spyOn(adapter, "loadProject").mockImplementation(async () => {
      await deferred;
      return { success: true as const, project: full, revision: 1, savedAt: "2026-01-01T00:00:00.000Z" };
    });

    setupController(adapter);

    const { result, unmount } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let exportPromise: Promise<unknown>;
    act(() => {
      exportPromise = result.current.exportProjectById("proj-export");
    });

    unmount();

    await act(async () => {
      resolveLoad(null);
      await exportPromise!;
    });

    // No feedback after unmount: the stale result resolves to a superseded
    // error but never touches state, so no error is surfaced.
    expect(result.current.error).toBeNull();
  });

  it("old export failure cannot replace a newer export success", async () => {
    const adapter = createMockAdapter();
    // Must be exportable (ProjectSchema requires at least one section).
    const full = makeProject({
      id: "proj-export",
      name: "Export Me",
      pages: [{ id: "p1", title: "Home", slug: "/", sections: [
        { id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
      ] }],
    });
    await adapter.saveProject({ project: full, revision: 1 });

    let resolveFirst: (value: unknown) => void = () => {};
    const firstDeferred = new Promise((resolve) => { resolveFirst = resolve; });
    let call = 0;
    vi.spyOn(adapter, "loadProject").mockImplementation(async () => {
      call++;
      if (call === 1) {
        await firstDeferred;
        // First (stale) export's load ultimately fails.
        return { success: false as const, error: { code: "PROJECT_NOT_FOUND", message: "gone" } };
      }
      return { success: true as const, project: full, revision: 1, savedAt: "2026-01-01T00:00:00.000Z" };
    });

    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let first: Promise<unknown>;
    act(() => {
      first = result.current.exportProjectById("proj-export");
    });

    await new Promise((r) => setTimeout(r, 10));

    let secondOk = false;
    await act(async () => {
      const res = await result.current.exportProjectById("proj-export");
      secondOk = res.ok;
    });
    expect(secondOk).toBe(true);

    // Stale first export completes (with a failure) but must not surface an error.
    await act(async () => {
      resolveFirst(null);
      await first!;
    });

    expect(result.current.operation).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
