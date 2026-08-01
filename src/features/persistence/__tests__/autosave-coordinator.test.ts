// ---------------------------------------------------------------------------
// Autosave Coordinator Tests
//
// Tests debounce behavior, state transitions, flush, deduplication,
// project-switch safety, error handling, and enriched state shape.
// Uses fake timers for debounce verification.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AutosaveCoordinator } from "../services/autosave-coordinator";
import type { Project } from "@/types/project";
import type { ProjectPersistenceAdapter, SaveProjectRequest, SaveProjectResult, AutosaveState } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: { background: "#fff", foreground: "#000", primary: "#7c5cfc", primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000", muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc", accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000" },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} }] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function createMockAdapter(): ProjectPersistenceAdapter {
  const store = new Map<string, { project: Project; revision: number }>();

  const adapter: ProjectPersistenceAdapter = {
    loadProject: vi.fn(async (id: string) => {
      const data = store.get(id);
      if (!data) return { success: false as const, error: { code: "PROJECT_NOT_FOUND" as const, message: "Not found" } };
      return { success: true as const, project: data.project, revision: data.revision, savedAt: new Date().toISOString() };
    }),
    saveProject: vi.fn(async (req: SaveProjectRequest): Promise<SaveProjectResult> => {
      const existing = store.get(req.project.id);
      if (existing && existing.revision > req.revision) {
        return { success: false as const, error: { code: "STALE_REVISION" as const, message: "Stale" } };
      }
      const newRev = existing ? existing.revision + 1 : req.revision;
      store.set(req.project.id, { project: req.project, revision: newRev });
      return { success: true as const, revision: newRev };
    }),
    removeProject: vi.fn(),
    listProjects: vi.fn(),
    getActiveProjectId: vi.fn(),
    setActiveProjectId: vi.fn(),
    getDashboardMetadata: vi.fn(),
    setDashboardMetadata: vi.fn(),
    removeDashboardMetadata: vi.fn(),
    estimateUsage: vi.fn(),
    close: vi.fn(),
  };

  return adapter;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutosaveCoordinator — state transitions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in idle state with empty projectId", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    const state = coordinator.getState();
    expect(state.status).toBe("idle");
    expect(state.projectId).toBe("");
    expect(state.highestScheduledRevision).toBeNull();
    expect(state.currentlySavingRevision).toBeNull();
    expect(state.lastSuccessfullySavedRevision).toBeNull();
    expect(state.pendingRevision).toBeNull();
    coordinator.dispose();
  });

  it("transitions to unsaved after schedule", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    const result = coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.revision).toBe(1);
    }
    const state = coordinator.getState();
    expect(state.status).toBe("unsaved");
    expect(state.projectId).toBe("proj-1");
    expect(state.highestScheduledRevision).toBe(1);
    expect(state.pendingRevision).toBe(1);
    coordinator.dispose();
  });

  it("transitions to saving then saved after debounce", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    const states: string[] = [];
    coordinator.subscribe((s) => states.push(s.status));

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(coordinator.getState().status).toBe("unsaved");

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    const finalState = coordinator.getState();
    expect(finalState.status).toBe("saved");
    expect(finalState.lastSuccessfullySavedRevision).toBeGreaterThanOrEqual(1);
    expect(states).toContain("saving");
    expect(states).toContain("saved");
    coordinator.dispose();
  });

  it("getState returns immutable snapshot", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    const state = coordinator.getState();
    expect(Object.isFrozen(state)).toBe(true);
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — schedule result", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedule for same projectId is accepted", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    const result = coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.revision).toBe(1);
    }
    coordinator.dispose();
  });

  it("schedule for different projectId returns PROJECT_SCOPE_MISMATCH", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });

    const result = coordinator.schedule({ project: makeProject({ id: "proj-2", name: "B" }), projectId: "proj-2", revision: 1 });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.code).toBe("PROJECT_SCOPE_MISMATCH");
      expect(result.expectedProjectId).toBe("proj-1");
      expect(result.receivedProjectId).toBe("proj-2");
    }
    coordinator.dispose();
  });

  it("cross-project rejection leaves coordinator state unchanged", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    const stateBefore = coordinator.getState();

    coordinator.schedule({ project: makeProject({ id: "proj-2" }), projectId: "proj-2", revision: 5 });

    const stateAfter = coordinator.getState();
    expect(stateAfter.projectId).toBe(stateBefore.projectId);
    expect(stateAfter.highestScheduledRevision).toBe(stateBefore.highestScheduledRevision);
    expect(stateAfter.pendingRevision).toBe(stateBefore.pendingRevision);
    expect(stateAfter.status).toBe(stateBefore.status);
    expect(adapter.saveProject).toHaveBeenCalledTimes(0);
    coordinator.dispose();
  });

  it("deduplicate same revision returns accepted", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    const result = coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(result.accepted).toBe(true);
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — deduplication", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rapid schedules with same revision produce one save", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(adapter.saveProject).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("latest revision is saved after rapid schedules", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
    coordinator.schedule({ project: makeProject({ name: "v3" }), projectId: "proj-1", revision: 3 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(adapter.saveProject).toHaveBeenCalledTimes(1);
    const args = (adapter.saveProject as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.project.name).toBe("v3");
    expect(args.revision).toBe(3);
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("manual flush saves immediately without waiting for debounce", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 10000 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    const result = await coordinator.flush();

    expect(result.success).toBe(true);
    expect(adapter.saveProject).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(adapter.saveProject).toHaveBeenCalledTimes(1);
    coordinator.dispose();
  });

  it("flush with no pending request is safe", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter);
    const result = await coordinator.flush();
    expect(result.success).toBe(true);
    expect(adapter.saveProject).toHaveBeenCalledTimes(0);
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — cancel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancel prevents pending save", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 1000 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    coordinator.cancel();

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);

    expect(adapter.saveProject).toHaveBeenCalledTimes(0);
    const state = coordinator.getState();
    expect(state.status).toBe("idle");
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — error handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("error state on persistence failure", async () => {
    const adapter = createMockAdapter();
    (adapter.saveProject as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("DB error"));
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    const state = coordinator.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBeDefined();
    expect(state.error?.code).toBe("UNKNOWN_PERSISTENCE_ERROR");
    coordinator.dispose();
  });

  it("retry after error succeeds and clears error", async () => {
    const adapter = createMockAdapter();
    let fail = true;
    (adapter.saveProject as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (fail) {
        fail = false;
        return { success: false as const, error: { code: "TRANSACTION_FAILED" as const, message: "Retryable" } };
      }
      return { success: true as const, revision: 1 };
    });

    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 100 });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.getState().status).toBe("error");
    expect(coordinator.getState().error).toBeDefined();

    coordinator.schedule({ project: makeProject({ name: "retry" }), projectId: "proj-1", revision: 2 });
    const result = await coordinator.flush();
    expect(result.success).toBe(true);
    const state = coordinator.getState();
    expect(state.status).toBe("saved");
    expect(state.error).toBeUndefined();
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — subscribe", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("subscriber receives state updates with enriched state", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 100 });
    const updates: AutosaveState[] = [];

    coordinator.subscribe((state) => updates.push(state));
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(updates.some((u) => u.status === "unsaved")).toBe(true);
    expect(updates.some((u) => u.status === "saving")).toBe(true);
    expect(updates.some((u) => u.status === "saved")).toBe(true);
    // Verify each state has projectId
    updates.forEach((u) => {
      expect(u.projectId).toBe("proj-1");
    });
    coordinator.dispose();
  });

  it("unsubscribe stops updates", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter);
    const updates: AutosaveState[] = [];
    const unsub = coordinator.subscribe((s) => updates.push(s));
    unsub();

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(updates).toHaveLength(0);
    coordinator.dispose();
  });

  it("listener exception does not break coordinator", async () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter, { debounceMs: 100 });

    coordinator.subscribe(() => { throw new Error("listener error"); });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);
    expect(coordinator.getState().status).toBe("saved");
    coordinator.dispose();
  });

  it("subscriber receives immutable state snapshot", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter);
    coordinator.subscribe((s) => {
      expect(Object.isFrozen(s)).toBe(true);
    });
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    coordinator.dispose();
  });
});

describe("AutosaveCoordinator — dispose", () => {
  it("dispose prevents future callbacks", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter);
    const updates: AutosaveState[] = [];
    coordinator.subscribe((s) => updates.push(s));
    coordinator.dispose();

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(updates).toHaveLength(0);
    expect(adapter.saveProject).toHaveBeenCalledTimes(0);
  });

  it("dispose resets state to initial", () => {
    const adapter = createMockAdapter();
    const coordinator = new AutosaveCoordinator(adapter);
    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    coordinator.dispose();
    const state = coordinator.getState();
    expect(state.status).toBe("idle");
    expect(state.projectId).toBe("");
  });
});
