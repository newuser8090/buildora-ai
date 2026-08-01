// ---------------------------------------------------------------------------
// Manual thumbnail regeneration — orchestration tests
//
// Exercises the REAL dashboard path (useProjectsDashboard.regenerateThumbnail)
// with injected thumbnail storage + generation infrastructure so the full
// flow — load full project → generate from persisted revision → save → reload
// the card cache — is proven without a real browser capture.
//
// Policy under test (Phase G §19/§31):
//   - loads the FULL persisted project (never the dashboard summary)
//   - generates from the PERSISTED revision; active dirty projects reflect
//     their last saved state (documented; never silently generated from
//     unsaved content)
//   - repeated clicks are blocked while one regeneration runs
//   - does NOT mark the project dirty, change revision, or change updatedAt
//   - failure maps to a non-blocking structured error, never navigation
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
import {
  setThumbnailSchedulerForBridge,
  setThumbnailStorageForBridge,
  setThumbnailGenerationServiceForBridge,
  resetThumbnailBridge,
} from "@/features/thumbnails/services/thumbnail-save-bridge";
import type {
  ProjectThumbnailStorageAdapter,
  ProjectThumbnailRecord,
  ThumbnailError,
  ThumbnailSaveResult,
} from "@/features/thumbnails/types";
import type { ThumbnailGenerationService } from "@/features/thumbnails/services/thumbnail-generation-service";
import type { GenerateThumbnailRequest, GenerateThumbnailResult } from "@/features/thumbnails/types";
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
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRecord(overrides?: Partial<ProjectThumbnailRecord>): ProjectThumbnailRecord {
  return {
    projectId: "proj-test",
    revision: 1,
    generatedAt: "2026-07-30T00:00:00.000Z",
    mimeType: "image/webp",
    width: 480,
    height: 300,
    byteSize: 2048,
    data: new Blob(["thumb-bytes"], { type: "image/webp" }),
    ...overrides,
  };
}

function createMockAdapter(): ProjectPersistenceAdapter {
  const store = new Map<string, { project: Project; revision: number; savedAt: string }>();
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
    listProjects: vi.fn(async (): Promise<ProjectSummaryResult> => ({
      success: true,
      projects: Array.from(store.entries()).map(([id, data]) => ({
        id, name: data.project.name, createdAt: data.project.createdAt, updatedAt: data.project.updatedAt,
        savedAt: data.savedAt, revision: data.revision, pageCount: data.project.pages?.length ?? 0,
        assetCount: data.project.assets?.length ?? 0, approximateAssetBytes: 0,
      })),
    })),
    getActiveProjectId: vi.fn(async () => ({ success: true as const, projectId: activeProjectId })),
    setActiveProjectId: vi.fn(async (id: string | null): Promise<ProjectPersistenceResult> => {
      activeProjectId = id;
      return { success: true as const };
    }),
    getDashboardMetadata: vi.fn(async () => ({ success: true as const, metadata: {} })),
    setDashboardMetadata: vi.fn(async (): Promise<ProjectPersistenceResult> => ({ success: true as const })),
    removeDashboardMetadata: vi.fn(async (): Promise<ProjectPersistenceResult> => ({ success: true as const })),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };
}

function setupController(adapter: ProjectPersistenceAdapter): ProjectController {
  const controller = new ProjectController(adapter);
  setProjectController(controller);
  return controller;
}

/** Discriminated union returned by regenerateThumbnail. */
type RegenerateOutcome = { ok: true } | { ok: false; error: ThumbnailError };

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

/**
 * Build the injectable thumbnail infrastructure:
 *   - a fake generation service whose `generate` is a controllable vi.fn
 *   - a fake storage adapter whose `saveThumbnail` is a controllable vi.fn
 * Both are wired through the save-bridge exactly as production does.
 */
function createFakeThumbnailInfrastructure() {
  const generation: { generate: ReturnType<typeof vi.fn> } = {
    generate: vi.fn(
      async (req: GenerateThumbnailRequest): Promise<GenerateThumbnailResult> => ({
        ok: true,
        record: makeRecord({ projectId: req.project.id, revision: req.revision }),
      }),
    ),
  };
  const storage = {
    getThumbnail: vi.fn(async () => ({
      success: false as const,
      error: { code: "PROJECT_NOT_FOUND" as const, message: "nf" },
    })),
    saveThumbnail: vi.fn(async (record: ProjectThumbnailRecord): Promise<ThumbnailSaveResult> => ({
      success: true,
      record,
      deduplicated: false,
    })),
    removeThumbnail: vi.fn(async () => ({ success: true as const })),
    listThumbnailMetadata: vi.fn(async () => ({ success: true as const, items: [] })),
    close: vi.fn(),
  };
  return { generation, storage };
}

function injectThumbnailInfrastructure(infra: ReturnType<typeof createFakeThumbnailInfrastructure>): void {
  setThumbnailSchedulerForBridge(null);
  setThumbnailStorageForBridge(infra.storage as unknown as ProjectThumbnailStorageAdapter);
  setThumbnailGenerationServiceForBridge(infra.generation as unknown as ThumbnailGenerationService);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("manual thumbnail regeneration (orchestration)", () => {
  let infra: ReturnType<typeof createFakeThumbnailInfrastructure>;

  beforeEach(() => {
    resetStore();
    mockPush.mockClear();
    infra = createFakeThumbnailInfrastructure();
    injectThumbnailInfrastructure(infra);
  });

  afterEach(() => {
    const ctrl = getProjectController();
    if (ctrl) ctrl.shutdown().catch(() => {});
    resetThumbnailBridge();
  });

  it("inactive project: loads the full project, uses persisted revision, saves thumbnail", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "proj-inactive", name: "Persisted Name", updatedAt: "2026-06-01T00:00:00.000Z" });
    await adapter.saveProject({ project: seeded, revision: 7 });
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const outcome = await result.current.regenerateThumbnail("proj-inactive");
      expect(outcome.ok).toBe(true);
    });

    // Full project loaded through the adapter (not the dashboard summary).
    expect(adapter.loadProject).toHaveBeenCalledWith("proj-inactive");
    // Generation used the PERSISTED revision.
    const genRequest = infra.generation.generate.mock.calls[0][0] as GenerateThumbnailRequest;
    expect(genRequest.project.id).toBe("proj-inactive");
    expect(genRequest.revision).toBe(7);
    // Thumbnail saved with the persisted project + revision.
    const saveRecord = infra.storage.saveThumbnail.mock.calls[0][0] as ProjectThumbnailRecord;
    expect(saveRecord.projectId).toBe("proj-inactive");
    expect(saveRecord.revision).toBe(7);
    // No navigation, no dirty state, no revision change.
    expect(mockPush).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("does not mutate the persisted project or change its revision/updatedAt", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "proj-nomut", name: "Original", updatedAt: "2026-06-01T00:00:00.000Z" });
    await adapter.saveProject({ project: seeded, revision: 4 });
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.regenerateThumbnail("proj-nomut");
    });

    // The persisted record is untouched.
    const loaded = await adapter.loadProject("proj-nomut");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Original");
      expect(loaded.project.updatedAt).toBe("2026-06-01T00:00:00.000Z");
      expect(loaded.revision).toBe(4);
    }
  });

  it("active CLEAN project: generates from the current persisted/live matching revision, no unnecessary save", async () => {
    const adapter = createMockAdapter();
    const seeded = makeProject({ id: "proj-active", name: "Active" });
    await adapter.saveProject({ project: seeded, revision: 2 });
    await adapter.setActiveProjectId("proj-active");
    setupController(adapter);
    useEditorStore.setState({ activeProjectId: "proj-active", isHydrated: true, isDirty: false });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Clear the seeding write so the assertion below measures regeneration only.
    vi.mocked(adapter.saveProject).mockClear();

    await act(async () => {
      await result.current.regenerateThumbnail("proj-active");
    });

    const genRequest = infra.generation.generate.mock.calls[0][0] as GenerateThumbnailRequest;
    expect(genRequest.revision).toBe(2);
    // No save was triggered by regeneration.
    expect(adapter.saveProject).not.toHaveBeenCalled();
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("active DIRTY project: generates from the LAST SAVED revision, never unsaved content", async () => {
    const adapter = createMockAdapter();
    const persisted = makeProject({ id: "proj-dirty", name: "Saved Name" });
    await adapter.saveProject({ project: persisted, revision: 3 });
    await adapter.setActiveProjectId("proj-dirty");
    setupController(adapter);

    // Simulate an active dirty editor with newer unsaved content.
    useEditorStore.setState({
      activeProjectId: "proj-dirty",
      isHydrated: true,
      isDirty: true,
      project: { ...persisted, name: "Unsaved Edit" },
      revision: 5,
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.regenerateThumbnail("proj-dirty");
    });

    // Generation used the persisted project + revision — NOT the unsaved edit.
    const genRequest = infra.generation.generate.mock.calls[0][0] as GenerateThumbnailRequest;
    expect(genRequest.project.name).toBe("Saved Name");
    expect(genRequest.revision).toBe(3);
    // The dirty state and revision are untouched.
    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(useEditorStore.getState().revision).toBe(5);
    // No navigation.
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("missing project maps to a structured PROJECT_NOT_FOUND error, no navigation", async () => {
    const adapter = createMockAdapter();
    setupController(adapter);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const outcome = await result.current.regenerateThumbnail("does-not-exist");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.code).toBe("PROJECT_NOT_FOUND");
        expect(outcome.error.projectId).toBe("does-not-exist");
      }
    });

    expect(infra.generation.generate).not.toHaveBeenCalled();
    expect(infra.storage.saveThumbnail).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("generation failure maps to the structured error without saving or navigating", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-genfail" }), revision: 1 });
    setupController(adapter);
    infra.generation.generate.mockResolvedValue({
      ok: false,
      error: { code: "RENDER_FAILED", message: "render exploded", retryable: true } as ThumbnailError,
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const outcome = await result.current.regenerateThumbnail("proj-genfail");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("RENDER_FAILED");
    });

    expect(infra.storage.saveThumbnail).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("storage failure maps to the structured error without navigation", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-storefail" }), revision: 1 });
    setupController(adapter);
    infra.storage.saveThumbnail.mockResolvedValue({
      success: false,
      error: { code: "STORAGE_FAILED", message: "quota", retryable: true } as ThumbnailError,
    });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const outcome = await result.current.regenerateThumbnail("proj-storefail");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("STORAGE_FAILED");
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("repeated clicks are blocked while one regeneration is running", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-busy" }), revision: 1 });
    setupController(adapter);

    // Defer the generation so the first call stays in flight.
    let resolveGenerate!: (r: GenerateThumbnailResult) => void;
    infra.generation.generate.mockImplementation(
      () => new Promise<GenerateThumbnailResult>((resolve) => { resolveGenerate = resolve; }),
    );

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Start the first call WITHOUT awaiting so the busy ref is set synchronously,
    // then start the second, flush the microtask queue (regenerateThumbnail
    // awaits loadProject before invoking generate), then resolve the deferred
    // generation.
    let first: RegenerateOutcome | undefined;
    let second: RegenerateOutcome | undefined;
    await act(async () => {
      const firstPromise = result.current.regenerateThumbnail("proj-busy");
      const secondPromise = result.current.regenerateThumbnail("proj-busy");
      // Let loadProject resolve so generate is invoked and resolveGenerate is set.
      await waitFor(() => expect(resolveGenerate).toBeTypeOf("function"));
      resolveGenerate({ ok: true, record: makeRecord({ projectId: "proj-busy" }) });
      first = await firstPromise;
      second = await secondPromise;
    });

    expect(first?.ok).toBe(true);
    // The second call was blocked (busy guard) but did not throw.
    expect(second?.ok).toBe(false);
    if (second && !second.ok) {
      expect(second.error.code).toBe("RENDER_FAILED");
    }
    expect(infra.generation.generate).toHaveBeenCalledTimes(1);
  });

  it("retry succeeds after a failed regeneration (busy guard cleared)", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-retry" }), revision: 2 });
    setupController(adapter);

    infra.generation.generate
      .mockResolvedValueOnce({ ok: false, error: { code: "RENDER_FAILED", message: "boom", retryable: true } as ThumbnailError })
      .mockResolvedValueOnce({ ok: true, record: makeRecord({ projectId: "proj-retry", revision: 2 }) });

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const first = await result.current.regenerateThumbnail("proj-retry");
      expect(first.ok).toBe(false);
      const second = await result.current.regenerateThumbnail("proj-retry");
      expect(second.ok).toBe(true);
    });

    expect(infra.generation.generate).toHaveBeenCalledTimes(2);
    expect(infra.storage.saveThumbnail).toHaveBeenCalledTimes(1);
  });

  it("unmount before completion produces no navigation and no stale feedback", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-unmount" }), revision: 1 });
    setupController(adapter);

    let resolveGenerate!: (r: GenerateThumbnailResult) => void;
    infra.generation.generate.mockImplementation(
      () => new Promise<GenerateThumbnailResult>((resolve) => { resolveGenerate = resolve; }),
    );

    const { result, unmount } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: RegenerateOutcome | undefined;
    const pending = act(async () => {
      outcome = await result.current.regenerateThumbnail("proj-unmount");
    });

    // Let loadProject resolve so generate is invoked and resolveGenerate is set.
    await waitFor(() => expect(resolveGenerate).toBeTypeOf("function"));

    // Unmount while the generation is still pending.
    unmount();
    resolveGenerate({ ok: true, record: makeRecord({ projectId: "proj-unmount" }) });
    await pending;

    // The completion is treated as stale — no navigation, no save.
    expect(outcome?.ok).toBe(false);
    expect(infra.storage.saveThumbnail).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("missing generation infrastructure maps to RENDER_TARGET_UNAVAILABLE", async () => {
    const adapter = createMockAdapter();
    await adapter.saveProject({ project: makeProject({ id: "proj-noinfra" }), revision: 1 });
    setupController(adapter);
    // Remove injected generation + storage so the bridge resolves nulls.
    setThumbnailGenerationServiceForBridge(null);
    setThumbnailStorageForBridge(null);

    const { result } = renderHook(() => useProjectsDashboard());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const outcome = await result.current.regenerateThumbnail("proj-noinfra");
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.code).toBe("RENDER_TARGET_UNAVAILABLE");
    });
  });
});
