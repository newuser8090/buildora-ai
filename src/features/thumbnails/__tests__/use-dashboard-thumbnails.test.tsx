// ---------------------------------------------------------------------------
// useDashboardThumbnails — hook tests
//
// The hook loads lightweight thumbnail metadata, then per-project Blob
// records, derives card state (missing | loading | ready | stale | error),
// and manages runtime object URLs (created on display, revoked on change /
// unmount). Storage is injected through the bridge for deterministic tests.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useDashboardThumbnails, type ThumbnailProjectRef } from "../hooks/useDashboardThumbnails";
import { ThumbnailScheduler } from "../services/thumbnail-scheduler";
import { THUMBNAIL_RETRY_MAX_ATTEMPTS } from "../constants";
import {
  setThumbnailStorageForBridge,
  setThumbnailSchedulerForBridge,
  resetThumbnailBridge,
} from "../services/thumbnail-save-bridge";
import type {
  ProjectThumbnailStorageAdapter,
  ProjectThumbnailRecord,
  ThumbnailLoadResult,
  ThumbnailResult,
  ThumbnailMetadataListResult,
  ThumbnailSaveResult,
} from "../types";

// ---------------------------------------------------------------------------
// URL stubs
// ---------------------------------------------------------------------------

let createSpy: ReturnType<typeof vi.fn>;
let revokeSpy: ReturnType<typeof vi.fn>;

function makeBlob(content = "thumb"): Blob {
  return new Blob([content], { type: "image/webp" });
}

function makeRecord(overrides?: Partial<ProjectThumbnailRecord>): ProjectThumbnailRecord {
  return {
    projectId: "proj-1",
    revision: 2,
    generatedAt: "2026-07-30T00:00:00.000Z",
    mimeType: "image/webp",
    width: 480,
    height: 300,
    byteSize: 2048,
    data: makeBlob("thumb-bytes"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fake storage adapter
// ---------------------------------------------------------------------------

function createFakeStorage(
  records: Record<string, ProjectThumbnailRecord> = {},
): ProjectThumbnailStorageAdapter {
  const map = new Map(Object.entries(records));
  const load = async (projectId: string): Promise<ThumbnailLoadResult> => {
    const record = map.get(projectId);
    if (!record) {
      return { success: false as const, error: { code: "PROJECT_NOT_FOUND", message: "Not found", projectId } };
    }
    return { success: true as const, record };
  };
  const remove = async (): Promise<ThumbnailResult> => ({ success: true as const });
  const listMetadata = async (): Promise<ThumbnailMetadataListResult> => ({
    success: true as const,
    items: Array.from(map.values()).map((r) => ({
      projectId: r.projectId,
      revision: r.revision,
      generatedAt: r.generatedAt,
      mimeType: r.mimeType,
      width: r.width,
      height: r.height,
      byteSize: r.byteSize,
    })),
  });

  return {
    getThumbnail: vi.fn(load),
    saveThumbnail: vi.fn(),
    removeThumbnail: vi.fn(remove),
    listThumbnailMetadata: vi.fn(listMetadata),
    estimateThumbnailUsage: vi.fn(),
    close: vi.fn(),
  };
}

function setup(records: Record<string, ProjectThumbnailRecord> = {}) {
  const storage = createFakeStorage(records);
  setThumbnailStorageForBridge(storage);
  return storage;
}

// ---------------------------------------------------------------------------
// Persistent harness for the race tests
//
// A real ThumbnailScheduler is injected through the bridge so the hook's
// ready-notification subscription (subscribeThumbnailReady) receives real
// completion events. The scheduler's storage WRITES into the same map the
// hook reads from — exactly like the production pipeline (editor save →
// scheduler → IndexedDB → dashboard load).
// ---------------------------------------------------------------------------

interface RaceHarness {
  storage: ProjectThumbnailStorageAdapter;
  scheduler: ThumbnailScheduler;
  /** Mutable record map shared by storage and the scheduler's generate. */
  map: Map<string, ProjectThumbnailRecord>;
}

function createPersistentStorage(
  records: Record<string, ProjectThumbnailRecord> = {},
) {
  const map = new Map(Object.entries(records));
  const load = async (projectId: string): Promise<ThumbnailLoadResult> => {
    const record = map.get(projectId);
    if (!record) {
      return {
        success: false as const,
        error: { code: "PROJECT_NOT_FOUND", message: "Not found", projectId },
      };
    }
    return { success: true as const, record };
  };
  const save = async (record: ProjectThumbnailRecord): Promise<ThumbnailSaveResult> => {
    map.set(record.projectId, record);
    return { success: true as const, record, deduplicated: false };
  };
  const remove = async (): Promise<ThumbnailResult> => ({ success: true as const });
  const listMetadata = async (): Promise<ThumbnailMetadataListResult> => ({
    success: true as const,
    items: Array.from(map.values()).map((r) => ({
      projectId: r.projectId,
      revision: r.revision,
      generatedAt: r.generatedAt,
      mimeType: r.mimeType,
      width: r.width,
      height: r.height,
      byteSize: r.byteSize,
    })),
  });
  const storage: ProjectThumbnailStorageAdapter = {
    getThumbnail: vi.fn(load),
    saveThumbnail: vi.fn(save),
    removeThumbnail: vi.fn(remove),
    listThumbnailMetadata: vi.fn(listMetadata),
    estimateThumbnailUsage: vi.fn(),
    close: vi.fn(),
  };
  return { storage, map };
}

/**
 * Build a scheduler whose generate produces a record for the requested
 * project at the requested revision (writes flow through the shared map).
 */
function createRaceHarness(
  records: Record<string, ProjectThumbnailRecord> = {},
): RaceHarness {
  const { storage, map } = createPersistentStorage(records);
  const scheduler = new ThumbnailScheduler({
    storage,
    generate: vi.fn(async (request: {
      projectId: string;
      revision: number;
    }): Promise<{ ok: true; record: ProjectThumbnailRecord }> => ({
      ok: true,
      record: makeRecord({
        projectId: request.projectId,
        revision: request.revision,
      }),
    })),
    // No debounce — schedule() drains on the next timer tick, keeping the
    // test deterministic with real timers.
    debounceMs: 0,
    now: () => "2026-07-30T00:00:00.000Z",
  });
  setThumbnailStorageForBridge(storage);
  setThumbnailSchedulerForBridge(scheduler);
  return { storage, scheduler, map };
}

/** Drive one schedule through generate + save + ready notification. */
async function completeSave(
  harness: RaceHarness,
  projectId: string,
  revision: number,
): Promise<void> {
  harness.scheduler.schedule({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    project: { id: projectId } as any,
    projectId,
    revision,
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe("useDashboardThumbnails", () => {
  beforeEach(() => {
    let counter = 0;
    createSpy = vi.fn(() => `blob:mock-${++counter}`);
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    });
    resetThumbnailBridge();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetThumbnailBridge();
  });

  const refs: ThumbnailProjectRef[] = [{ id: "proj-1", revision: 2 }];

  it("starts missing when no storage is available", async () => {
    // No storage injected → every project stays missing.
    const { result } = renderHook(() => useDashboardThumbnails(refs));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    expect(result.current.thumbnails["proj-1"].url).toBeNull();
  });

  it("shows ready with a URL after the Blob resolves", async () => {
    setup({ "proj-1": makeRecord() });
    const { result } = renderHook(() => useDashboardThumbnails(refs));

    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    expect(result.current.thumbnails["proj-1"].url).toBeTruthy();
    expect(createSpy).toHaveBeenCalled();
  });

  it("marks stale when the stored thumbnail revision is older than the project", async () => {
    setup({ "proj-1": makeRecord({ revision: 1 }) }); // project at rev 2
    const { result } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("stale");
    });
    // Stale keeps the last valid thumbnail visible.
    expect(result.current.thumbnails["proj-1"].url).toBeTruthy();
  });

  it("re-fetches at a newer revision and marks the thumbnail stale", async () => {
    setup({ "proj-1": makeRecord({ revision: 2 }) });
    const { result, rerender } = renderHook(
      ({ list }) => useDashboardThumbnails(list),
      { initialProps: { list: refs } },
    );
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });

    // The project's revision advances (e.g. after a save) — the effect re-runs
    // with a new key and re-fetches the Blob. The stored thumbnail (rev 2) is
    // older than the project (rev 3), so the card shows the last valid
    // thumbnail as stale until regeneration lands.
    await act(async () => {
      rerender({ list: [{ id: "proj-1", revision: 3 }] });
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.thumbnails["proj-1"].status).toBe("stale");
    // A new object URL was created for the re-fetched Blob — never null.
    expect(result.current.thumbnails["proj-1"].url).toBeTruthy();
  });

  it("keeps a displayed URL when a re-fetch fails transiently", async () => {
    const storage = setup({ "proj-1": makeRecord({ revision: 2 }) });
    const { result, rerender } = renderHook(
      ({ list }) => useDashboardThumbnails(list),
      { initialProps: { list: refs } },
    );
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    const url = result.current.thumbnails["proj-1"].url;

    // Revision advances AND the Blob load starts failing.
    vi.mocked(storage.getThumbnail).mockImplementation(async (projectId: string): Promise<ThumbnailLoadResult> => {
      return { success: false as const, error: { code: "STORAGE_FAILED", message: "boom", projectId, retryable: true } };
    });

    await act(async () => {
      rerender({ list: [{ id: "proj-1", revision: 3 }] });
      await new Promise((r) => setTimeout(r, 20));
    });

    // The already-displayed URL must survive the failed load and must not be
    // revoked.
    expect(result.current.thumbnails["proj-1"].url).toBe(url);
    expect(revokeSpy).not.toHaveBeenCalledWith(url);
  });

  it("shows error (no URL) when a Blob load fails with no displayed URL", async () => {
    const storage = setup({});
    vi.mocked(storage.getThumbnail).mockImplementation(async (projectId: string): Promise<ThumbnailLoadResult> => {
      return { success: false as const, error: { code: "STORAGE_FAILED", message: "load failed", projectId, retryable: true } };
    });
    const { result } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("error");
    });
    expect(result.current.thumbnails["proj-1"].url).toBeNull();
  });

  it("shows missing (not error) when PROJECT_NOT_FOUND", async () => {
    const storage = setup({});
    vi.mocked(storage.getThumbnail).mockImplementation(async (projectId: string): Promise<ThumbnailLoadResult> => {
      return { success: false as const, error: { code: "PROJECT_NOT_FOUND", message: "Not found", projectId } };
    });
    const { result } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });
  });

  it("reload invalidates one project and re-fetches it", async () => {
    setup({ "proj-1": makeRecord({ revision: 2 }) });
    const { result } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });

    await act(async () => {
      result.current.reload("proj-1");
    });
    // After reload the project is re-fetched (loading → ready again).
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
  });

  it("revokes URLs for projects removed from the list", async () => {
    setup({ "proj-1": makeRecord() });
    const { result, rerender } = renderHook(
      ({ list }) => useDashboardThumbnails(list),
      { initialProps: { list: refs } },
    );
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    const url = result.current.thumbnails["proj-1"].url;

    await act(async () => {
      rerender({ list: [] });
    });
    expect(revokeSpy).toHaveBeenCalledWith(url);
  });

  it("revokes all object URLs on unmount", async () => {
    setup({ "proj-1": makeRecord() });
    const { result, unmount } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    const url = result.current.thumbnails["proj-1"].url;

    unmount();
    expect(revokeSpy).toHaveBeenCalledWith(url);
  });

  it("does not update state after unmount (stale generation guard)", async () => {
    const storage = setup({ "proj-1": makeRecord() });
    // Delay the load so we can unmount first.
    let resolveLoad: (value: unknown) => void = () => {};
    vi.mocked(storage.getThumbnail).mockImplementation(
      (projectId: string) =>
        new Promise((resolve) => {
          resolveLoad = () =>
            resolve({
              success: true as const,
              record: makeRecord({ projectId }),
            });
        }),
    );

    const { unmount } = renderHook(() => useDashboardThumbnails(refs));
    unmount();

    await act(async () => {
      resolveLoad(null);
      await new Promise((r) => setTimeout(r, 10));
    });
    // No state update, no URL created, no crash.
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("useDashboardThumbnails — eventual-thumbnail policy (race tests)", () => {
  const refs: ThumbnailProjectRef[] = [{ id: "proj-1", revision: 2 }];

  beforeEach(() => {
    let counter = 0;
    createSpy = vi.fn(() => `blob:mock-${++counter}`);
    revokeSpy = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: createSpy,
      revokeObjectURL: revokeSpy,
    });
    resetThumbnailBridge();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetThumbnailBridge();
  });

  it("dashboard mounts BEFORE the write completes, then upgrades via the ready notification", async () => {
    // 1. Empty storage — the thumbnail is still being generated.
    const harness = createRaceHarness({});
    const { result } = renderHook(() => useDashboardThumbnails(refs));

    // Initial metadata read returns empty → placeholder (missing).
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });

    // 2. The write transaction now completes (save → commit → ready).
    await completeSave(harness, "proj-1", 2);

    // 3. The ready notification reloads the project and it becomes ready.
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    expect(result.current.thumbnails["proj-1"].url).toBeTruthy();
    expect(result.current.thumbnails["proj-1"].revision).toBe(2);
  });

  it("ignores a stale ready notification and displays the newer revision when it arrives", async () => {
    // Project summary is at revision 3.
    const list: ThumbnailProjectRef[] = [{ id: "proj-1", revision: 3 }];
    const harness = createRaceHarness({});
    const { result } = renderHook(() => useDashboardThumbnails(list));

    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });

    // Revision 2 completes — stale relative to the summary (rev 3). The hook
    // must ignore it: no reload, no stale display.
    await completeSave(harness, "proj-1", 2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    expect(result.current.thumbnails["proj-1"].url).toBeNull();
    // The stale write must not have been loaded at all.
    expect(harness.storage.getThumbnail).toHaveBeenCalledTimes(1);

    // Revision 3 later arrives → displays.
    await completeSave(harness, "proj-1", 3);
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    expect(result.current.thumbnails["proj-1"].revision).toBe(3);
  });

  it("duplicate ready notifications do not duplicate loads", async () => {
    const harness = createRaceHarness({});
    const { result } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });

    // First genuine save → ready notification → load.
    await completeSave(harness, "proj-1", 2);
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("ready");
    });
    const loadsAfterFirst = vi.mocked(harness.storage.getThumbnail).mock.calls.length;

    // A second save of the same project+revision (dedup path in storage,
    // genuine write here) → a second ready notification arrives while the
    // URL is already shown. It must NOT trigger another blob load.
    await completeSave(harness, "proj-1", 2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(vi.mocked(harness.storage.getThumbnail).mock.calls.length).toBe(
      loadsAfterFirst,
    );
  });

  it("bounded retry loads a thumbnail that lands after mount without a notification", async () => {
    // No scheduler injected → no ready notification; the bounded retry is the
    // only path that can recover this thumbnail.
    const { storage, map } = createPersistentStorage({});
    setThumbnailStorageForBridge(storage);
    const { result } = renderHook(() => useDashboardThumbnails(refs));

    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });

    // The write lands AFTER the initial load pass (e.g. a notification was
    // missed across a route transition).
    map.set("proj-1", makeRecord({ projectId: "proj-1", revision: 2 }));

    // First retry (500ms base) picks it up.
    await waitFor(
      () => {
        expect(result.current.thumbnails["proj-1"].status).toBe("ready");
      },
      { timeout: 2000 },
    );
    expect(result.current.thumbnails["proj-1"].url).toBeTruthy();
  });

  it("bounded retry stops after the configured limit (no permanent polling)", async () => {
    vi.useFakeTimers();
    try {
      const { storage } = createPersistentStorage({});
      setThumbnailStorageForBridge(storage);
      const { result } = renderHook(() => useDashboardThumbnails(refs));

      // Initial pass settles.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const initialCalls = vi.mocked(storage.getThumbnail).mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);

      // Advance far past all retries (500+1000+2000+4000 = 7500ms).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      const afterWindow = vi.mocked(storage.getThumbnail).mock.calls.length;
      expect(afterWindow - initialCalls).toBeLessThanOrEqual(
        THUMBNAIL_RETRY_MAX_ATTEMPTS,
      );

      // Idle for a long time — no further polling.
      const beforeIdle = vi.mocked(storage.getThumbnail).mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(vi.mocked(storage.getThumbnail).mock.calls.length).toBe(beforeIdle);
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("unmount cancels the ready subscription and the retry timer", async () => {
    const harness = createRaceHarness({});
    const { result, unmount } = renderHook(() => useDashboardThumbnails(refs));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });

    const loadsBefore = vi.mocked(harness.storage.getThumbnail).mock.calls.length;
    unmount();

    // A write completing after unmount must not trigger any load/state update.
    await completeSave(harness, "proj-1", 2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(vi.mocked(harness.storage.getThumbnail).mock.calls.length).toBe(
      loadsBefore,
    );
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("ready notification for a project removed from the list is ignored", async () => {
    const harness = createRaceHarness({});
    const { result, rerender } = renderHook(
      ({ list }) => useDashboardThumbnails(list),
      { initialProps: { list: refs } },
    );
    await waitFor(() => {
      expect(result.current.thumbnails["proj-1"].status).toBe("missing");
    });

    // The project list changes before completion (project deleted / filtered).
    await act(async () => {
      rerender({ list: [] });
    });
    const loadsBefore = vi.mocked(harness.storage.getThumbnail).mock.calls.length;

    await completeSave(harness, "proj-1", 2);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // No reload was triggered for the removed project.
    expect(vi.mocked(harness.storage.getThumbnail).mock.calls.length).toBe(
      loadsBefore,
    );
  });

  it("two projects completing in different order both display", async () => {
    const harness = createRaceHarness({});
    const list: ThumbnailProjectRef[] = [
      { id: "proj-a", revision: 1 },
      { id: "proj-b", revision: 1 },
    ];
    const { result } = renderHook(() => useDashboardThumbnails(list));
    await waitFor(() => {
      expect(result.current.thumbnails["proj-a"].status).toBe("missing");
      expect(result.current.thumbnails["proj-b"].status).toBe("missing");
    });

    // B completes first, then A.
    await completeSave(harness, "proj-b", 1);
    await waitFor(() => {
      expect(result.current.thumbnails["proj-b"].status).toBe("ready");
    });
    await completeSave(harness, "proj-a", 1);
    await waitFor(() => {
      expect(result.current.thumbnails["proj-a"].status).toBe("ready");
    });
    expect(result.current.thumbnails["proj-b"].status).toBe("ready");
  });
});
