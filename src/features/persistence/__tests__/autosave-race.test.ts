// ---------------------------------------------------------------------------
// Autosave Race Condition Tests
//
// Tests for correct behavior when saves are scheduled during in-flight saves,
// revision tracking integrity, cross-project scoping with explicit rejection,
// and enriched AutosaveState fields.
// Uses deferred promises to control completion order precisely.
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

/**
 * Create a mock adapter that uses a deferred promise to control when
 * save operations complete. This lets us test race conditions precisely.
 */
function createDeferredAdapter(): {
  adapter: ProjectPersistenceAdapter;
  deferredSave: { resolve: (value: SaveProjectResult) => void; reject: (err: Error) => void } | null;
  triggerSave: (result: SaveProjectResult) => void;
  triggerSaveError: (err: Error) => void;
  getSaveCallCount: () => number;
  getSaveCallArgs: (index: number) => SaveProjectRequest;
} {
  let deferred: { resolve: (value: SaveProjectResult) => void; reject: (err: Error) => void } | null = null;
  const saveCalls: SaveProjectRequest[] = [];
  const adapter: ProjectPersistenceAdapter = {
    loadProject: vi.fn(),
    saveProject: vi.fn(async (req: SaveProjectRequest): Promise<SaveProjectResult> => {
      saveCalls.push({ ...req });
      return new Promise<SaveProjectResult>((resolve, reject) => {
        deferred = { resolve, reject };
      });
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

  return {
    adapter,
    get deferredSave() { return deferred; },
    triggerSave: (result: SaveProjectResult) => {
      if (deferred) {
        deferred.resolve(result);
        deferred = null;
      }
    },
    triggerSaveError: (err: Error) => {
      if (deferred) {
        deferred.reject(err);
        deferred = null;
      }
    },
    getSaveCallCount: () => saveCalls.length,
    getSaveCallArgs: (index: number) => saveCalls[index],
  };
}

// ---------------------------------------------------------------------------
// Cross-project rejection tests
// ---------------------------------------------------------------------------

describe("AutosaveCoordinator — cross-project rejection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("different project ID is rejected with PROJECT_SCOPE_MISMATCH", () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "A" }), projectId: "proj-1", revision: 1 });
    expect(coordinator.getState().status).toBe("unsaved");

    const result = coordinator.schedule({ project: makeProject({ id: "proj-2", name: "B" }), projectId: "proj-2", revision: 1 });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.code).toBe("PROJECT_SCOPE_MISMATCH");
      expect(result.expectedProjectId).toBe("proj-1");
      expect(result.receivedProjectId).toBe("proj-2");
    }
    // State unchanged
    expect(coordinator.getState().projectId).toBe("proj-1");
    expect(d.adapter.saveProject).toHaveBeenCalledTimes(0);
    coordinator.dispose();
  });

  it("rejected cross-project schedule does not change timer or pending state", () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    const stateBefore = coordinator.getState();

    coordinator.schedule({ project: makeProject({ id: "proj-2" }), projectId: "proj-2", revision: 5 });

    const stateAfter = coordinator.getState();
    expect(stateAfter.highestScheduledRevision).toBe(stateBefore.highestScheduledRevision);
    expect(stateAfter.pendingRevision).toBe(stateBefore.pendingRevision);
    expect(stateAfter.status).toBe(stateBefore.status);
    coordinator.dispose();
  });

  it("caller can flush and create new coordinator after project switch", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    // Don't await flush directly — start it, then trigger the deferred save
    const flushPromise = coordinator.flush();      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);
    await flushPromise;

    coordinator.dispose();

    // Create new coordinator for different project
    const d2 = createDeferredAdapter();
    const coordinator2 = new AutosaveCoordinator(d2.adapter, { debounceMs: 100 });
    const result = coordinator2.schedule({ project: makeProject({ id: "proj-2", name: "B" }), projectId: "proj-2", revision: 1 });
    expect(result.accepted).toBe(true);
    coordinator2.dispose();
  });
});

// ---------------------------------------------------------------------------
// Race condition tests with enriched state
// ---------------------------------------------------------------------------

describe("AutosaveCoordinator — race conditions with enriched state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("revision 4 saving, revision 5 scheduled: exposes correct revision fields", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v4" }), projectId: "proj-1", revision: 4 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    // Rev 4 is saving
    let state = coordinator.getState();
    expect(state.status).toBe("saving");
    expect(state.currentlySavingRevision).toBe(4);

    // Schedule revision 5 while rev 4 is in flight
    coordinator.schedule({ project: makeProject({ name: "v5" }), projectId: "proj-1", revision: 5 });
    state = coordinator.getState();
    expect(state.status).toBe("saving"); // still saving
    expect(state.currentlySavingRevision).toBe(4); // rev 4 is in-flight
    expect(state.highestScheduledRevision).toBe(5);
    expect(state.pendingRevision).toBe(5); // rev 5 is queued
    expect(state.status).not.toBe("saved");    // Complete revision 4 — this should trigger rev 5's save to start
    d.triggerSave({ success: true, revision: 4 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    // Verify rev 5's save was initiated
    expect(d.getSaveCallCount()).toBe(2);

    // Now complete revision 5
    d.triggerSave({ success: true, revision: 5 });
    await vi.advanceTimersByTimeAsync(0);

    state = coordinator.getState();
    expect(state.status).toBe("saved");
    expect(state.lastSuccessfullySavedRevision).toBe(5);
    coordinator.dispose();
  });

  it("after revision 4 succeeds, revision 5 is persisted", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v4" }), projectId: "proj-1", revision: 4 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v5" }), projectId: "proj-1", revision: 5 });
      d.triggerSave({ success: true, revision:  4 });
    await vi.advanceTimersByTimeAsync(0);

    // Save call for rev 5 should be made
    expect(d.getSaveCallCount()).toBeGreaterThanOrEqual(2);
    const lastCall = d.getSaveCallArgs(1);
    expect(lastCall.revision).toBe(5);
    expect(lastCall.project.name).toBe("v5");
      d.triggerSave({ success: true, revision:  5 });
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getState().status).toBe("saved");
    coordinator.dispose();
  });

  it("older completion cannot overwrite error metadata for a newer revision", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    d.triggerSave({ success: false, error: { code: "TRANSACTION_FAILED", message: "Failed" } });
    await vi.advanceTimersByTimeAsync(0);

    const state = coordinator.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBeDefined();
    expect(state.error?.code).toBe("TRANSACTION_FAILED");
    expect(state.lastSuccessfullySavedRevision).toBe(1);
    coordinator.dispose();
  });

  it("retry clears error only after newest revision succeeds", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    d.triggerSaveError(new Error("DB failure"));
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getState().status).toBe("error");

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });

    const flushPromise = coordinator.flush();      d.triggerSave({ success: true, revision:  2 });
    await vi.advanceTimersByTimeAsync(0);

    const result = await flushPromise;
    expect(result.success).toBe(true);
    const state = coordinator.getState();
    expect(state.status).toBe("saved");
    expect(state.error).toBeUndefined();
    coordinator.dispose();
  });

  it("cancel and dispose produce consistent revision fields", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
    coordinator.cancel();
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.getSaveCallCount()).toBe(1);
    const state = coordinator.getState();
    expect(state.status).toBe("saved");
    expect(state.lastSuccessfullySavedRevision).toBe(1);
    coordinator.dispose();
  });

  it("revision scheduled during in-flight save is eventually persisted", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.getSaveCallCount()).toBeGreaterThanOrEqual(2);
    const lastCall = d.getSaveCallArgs(1);
    expect(lastCall.revision).toBe(2);
      d.triggerSave({ success: true, revision:  2 });
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getState().status).toBe("saved");
    coordinator.dispose();
  });

  it("multiple newer schedules during one save retain only the latest snapshot", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
    coordinator.schedule({ project: makeProject({ name: "v3" }), projectId: "proj-1", revision: 3 });
    coordinator.schedule({ project: makeProject({ name: "v4" }), projectId: "proj-1", revision: 4 });
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.getSaveCallCount()).toBe(2);
    const lastCall = d.getSaveCallArgs(1);
    expect(lastCall.project.name).toBe("v4");
    expect(lastCall.revision).toBe(4);
    coordinator.dispose();
  });

  it("flush during in-flight save persists the newest pending revision", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });

    const flushPromise = coordinator.flush();
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.getSaveCallCount()).toBe(2);
      d.triggerSave({ success: true, revision:  2 });
    await vi.advanceTimersByTimeAsync(0);

    const result = await flushPromise;
    expect(result.success).toBe(true);
    expect(coordinator.getState().status).toBe("saved");
    coordinator.dispose();
  });

  it("older completion cannot clear a newer error state", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    d.triggerSave({ success: false, error: { code: "TRANSACTION_FAILED", message: "Failed" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getState().status).toBe("error");
    coordinator.dispose();
  });

  it("error preserves the latest pending request for retry", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    d.triggerSaveError(new Error("DB failure"));
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getState().status).toBe("error");

    coordinator.schedule({ project: makeProject({ name: "v1-retry" }), projectId: "proj-1", revision: 2 });

    const flushPromise = coordinator.flush();      d.triggerSave({ success: true, revision:  2 });
    await vi.advanceTimersByTimeAsync(0);

    const result = await flushPromise;
    expect(result.success).toBe(true);
    expect(coordinator.getState().status).toBe("saved");
    coordinator.dispose();
  });

  it("retry saves the latest request, not the failed older snapshot", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject({ name: "v1" }), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
    coordinator.schedule({ project: makeProject({ name: "v3" }), projectId: "proj-1", revision: 3 });

    d.triggerSave({ success: false, error: { code: "TRANSACTION_FAILED", message: "Failed" } });
    await vi.advanceTimersByTimeAsync(0);
      d.triggerSave({ success: true, revision:  3 });
    await vi.advanceTimersByTimeAsync(0);

    expect(coordinator.getState().status).toBe("saved");
    const args = d.getSaveCallArgs(d.getSaveCallCount() - 1);
    expect(args.project.name).toBe("v3");
    coordinator.dispose();
  });

  it("cancel during in-flight save does not cancel transaction but prevents pending follow-up", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.schedule({ project: makeProject({ name: "v2" }), projectId: "proj-1", revision: 2 });
    coordinator.cancel();
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(d.getSaveCallCount()).toBe(1);
    expect(coordinator.getState().status).toBe("saved");
    coordinator.dispose();
  });

  it("dispose during in-flight save prevents later listener notifications", async () => {
    const d = createDeferredAdapter();
    const coordinator = new AutosaveCoordinator(d.adapter, { debounceMs: 100 });
    const states: AutosaveState[] = [];
    coordinator.subscribe((s) => states.push(s));

    coordinator.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    coordinator.dispose();
      d.triggerSave({ success: true, revision:  1 });
    await vi.advanceTimersByTimeAsync(0);

    expect(states.filter((s) => s.status === "saved")).toHaveLength(0);
    coordinator.dispose();
  });
});

// ---------------------------------------------------------------------------
// Concurrency: Project A and Project B do not interfere
// ---------------------------------------------------------------------------

describe("AutosaveCoordinator — cross-project isolation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createSimpleMockAdapter(): ProjectPersistenceAdapter {
    const store = new Map<string, { project: Project; revision: number }>();
    return {
      loadProject: vi.fn(),
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
  }

  it("concurrent saves for project A do not affect project B when separate coordinators are used", async () => {
    const adapterA = createSimpleMockAdapter();
    const adapterB = createSimpleMockAdapter();
    const coordA = new AutosaveCoordinator(adapterA, { debounceMs: 100 });
    const coordB = new AutosaveCoordinator(adapterB, { debounceMs: 100 });

    coordA.schedule({ project: makeProject({ name: "A-v1" }), projectId: "proj-a", revision: 1 });
    coordB.schedule({ project: makeProject({ id: "proj-b", name: "B-v1" }), projectId: "proj-b", revision: 1 });

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(coordA.getState().status).toBe("saved");
    expect(coordB.getState().status).toBe("saved");

    const argsA = (adapterA.saveProject as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const argsB = (adapterB.saveProject as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(argsA.project.name).toBe("A-v1");
    expect(argsB.project.name).toBe("B-v1");
    expect(argsA.revision).toBe(1);
    expect(argsB.revision).toBe(1);

    coordA.dispose();
    coordB.dispose();
  });
});
