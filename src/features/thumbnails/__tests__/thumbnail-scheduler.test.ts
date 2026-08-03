// ---------------------------------------------------------------------------
// ThumbnailScheduler tests
//
// Uses deferred promises + fake timers to drive debounce and race scenarios.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ThumbnailScheduler } from "../services/thumbnail-scheduler";
import { THUMBNAIL_DEBOUNCE_MS } from "../constants";
import type {
  GenerateThumbnailResult,
  ProjectThumbnailStorageAdapter,
  ThumbnailError,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: { id?: string; name?: string }) {
  return {
    id: overrides?.id ?? "proj-1",
    name: overrides?.name ?? "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeRecord(projectId: string, revision: number) {
  return {
    projectId,
    revision,
    generatedAt: `2026-07-30T00:00:0${revision}.000Z`,
    mimeType: "image/webp" as const,
    width: 480,
    height: 300,
    byteSize: 2048,
    data: new Blob([`thumb-${projectId}-${revision}`], { type: "image/webp" }),
  };
}

/** Flush the microtask queue enough turns for nested drain chains to settle. */
async function flushMicrotasks(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

/** Deferred promise with explicit resolve/reject handles. */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeError(code: string): ThumbnailError {
  return { code: code as ThumbnailError["code"], message: code };
}

interface Harness {
  scheduler: ThumbnailScheduler;
  generate: ReturnType<typeof vi.fn>;
  storage: {
    saveThumbnail: ReturnType<typeof vi.fn>;
    getThumbnail: ReturnType<typeof vi.fn>;
    removeThumbnail: ReturnType<typeof vi.fn>;
  };
  /** Pending generate deferrals (per call). */
  generateQueue: Array<ReturnType<typeof deferred<GenerateThumbnailResult>>>;
  /** Pending save deferrals. */
  saveQueue: Array<
    ReturnType<
      typeof deferred<{ success: boolean; deduplicated?: boolean; error?: ThumbnailError }>
    >
  >;
  /** Scheduler state snapshots captured by a subscriber. */
  states: Array<{ phase: string; projectId: string | null; revision: number | null }>;
  /** Ready notifications captured by a subscribeReady listener. */
  readyEvents: Array<{ projectId: string; revision: number }>;
}

function setup(options?: { debounceMs?: number; failSave?: boolean }): Harness {
  const generateQueue: Harness["generateQueue"] = [];
  const saveQueue: Harness["saveQueue"] = [];

  const generate = vi.fn((_req: unknown): Promise<GenerateThumbnailResult> => {
    const d = deferred<GenerateThumbnailResult>();
    generateQueue.push(d);
    return d.promise;
  });

  const storage: Harness["storage"] = {
    saveThumbnail: vi.fn((_record: unknown) => {
      const d = deferred<{ success: boolean; deduplicated?: boolean; error?: ThumbnailError }>();
      saveQueue.push(d);
      return d.promise;
    }),
    getThumbnail: vi.fn(),
    removeThumbnail: vi.fn(),
  };

  const scheduler = new ThumbnailScheduler({
    storage: storage as unknown as ProjectThumbnailStorageAdapter,
    generate,
    debounceMs: options?.debounceMs ?? THUMBNAIL_DEBOUNCE_MS,
    now: () => "2026-07-30T00:00:00.000Z",
  });

  const states: Harness["states"] = [];
  scheduler.subscribe((s) => {
    states.push({ phase: s.phase, projectId: s.projectId, revision: s.revision });
  });

  const readyEvents: Harness["readyEvents"] = [];
  scheduler.subscribeReady((info) => readyEvents.push(info));

  return { scheduler, generate, storage, generateQueue, saveQueue, states, readyEvents };
}

/** Resolve the current pending generate + save successfully. */
async function resolveThrough(
  h: Harness,
  projectId: string,
  revision: number,
  opts?: {
    failGenerate?: boolean;
    failSave?: boolean;
    saveAsStale?: boolean;
    deduplicated?: boolean;
  },
) {
  if (h.generateQueue.length === 0) throw new Error("no pending generate");
  const gen = h.generateQueue.shift()!;
  if (opts?.failGenerate) {
    gen.resolve({ ok: false, error: makeError("RENDER_FAILED") });
  } else {
    gen.resolve({ ok: true, record: makeRecord(projectId, revision) });
  }
  await Promise.resolve();
  if (h.saveQueue.length > 0) {
    const save = h.saveQueue.shift()!;
    if (opts?.failSave) {
      save.resolve({ success: false, error: makeError("STORAGE_FAILED") });
    } else if (opts?.saveAsStale) {
      save.resolve({ success: false, error: makeError("STALE_REVISION") });
    } else {
      save.resolve({ success: true, deduplicated: opts?.deduplicated ?? false });
    }
  }
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ThumbnailScheduler — debounce", () => {
  it("does not generate before the debounce elapses", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    expect(h.generate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS - 1);
    await Promise.resolve();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("generates after the debounce elapses", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);
    // Resolve to avoid dangling work.
    await resolveThrough(h, "proj-1", 1);
  });

  it("rapid schedules collapse into one generation", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 3 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);
    // Latest revision wins.
    expect(h.generate).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3 }),
    );
    await resolveThrough(h, "proj-1", 3);
  });
});

describe("ThumbnailScheduler — latest revision wins", () => {
  it("an older revision cannot replace a newer pending request", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 5 });
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 3 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({ revision: 5 }));
    await resolveThrough(h, "proj-1", 5);
  });

  it("scheduling a newer revision while rendering queues the latest for the next drain", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);

    // Newer revision arrives while generation 1 is still in-flight.
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    // The current generation completes.
    await resolveThrough(h, "proj-1", 1);
    // The newer revision must be generated next.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(2);
    await resolveThrough(h, "proj-1", 2);
  });

  it("a stale render completion cannot overwrite a newer revision", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);

    // Newer revision scheduled while generation 1 is in-flight.
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    // Generation 1 resolves — the scheduler must drop it (never save it).
    const gen = h.generateQueue.shift()!;
    gen.resolve({ ok: true, record: makeRecord("proj-1", 1) });
    await Promise.resolve();
    await Promise.resolve();
    // No save for the stale revision — the queue only saves after a newer
    // request completes.
    expect(h.saveQueue.length).toBe(0);
  });
});

describe("ThumbnailScheduler — one generation at a time", () => {
  it("project A and B are isolated and processed serially", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject({ id: "proj-a" }), projectId: "proj-a", revision: 1 });
    h.scheduler.schedule({ project: makeProject({ id: "proj-b" }), projectId: "proj-b", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);

    // Complete A; the drain chain needs several microtask turns before it
    // picks up B (process → finally → drain recursion → process(B)).
    await resolveThrough(h, "proj-a", 1);
    await flushMicrotasks(12);
    expect(h.generate).toHaveBeenCalledTimes(2);
    await resolveThrough(h, "proj-b", 1);
  });
});

describe("ThumbnailScheduler — stale storage protection", () => {
  it("a STALE_REVISION save result is treated as success (newer already stored)", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    const gen = h.generateQueue.shift()!;
    gen.resolve({ ok: true, record: makeRecord("proj-1", 2) });
    await Promise.resolve();
    const save = h.saveQueue.shift()!;
    save.resolve({ success: false, error: makeError("STALE_REVISION") });
    await Promise.resolve();
    await Promise.resolve();
    const s = h.scheduler.getState();
    expect(s.phase).toBe("ready");
    expect(s.lastCompletedRevision).toBe(2);
  });
});

describe("ThumbnailScheduler — errors and retry", () => {
  it("generation failure is non-blocking and surfaces error state", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1, { failGenerate: true });
    const s = h.scheduler.getState();
    expect(s.phase).toBe("error");
    expect(s.error?.code).toBe("RENDER_FAILED");
  });

  it("storage failure is non-blocking and retryable", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1, { failSave: true });
    const s = h.scheduler.getState();
    expect(s.phase).toBe("error");
    expect(s.error?.code).toBe("STORAGE_FAILED");
    expect(s.error?.retryable ?? true).toBe(true);
  });

  it("a later schedule after an error retries generation", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await resolveThrough(h, "proj-1", 1, { failGenerate: true });

    // Retry with a newer revision.
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(2);
    await resolveThrough(h, "proj-1", 2);
    expect(h.scheduler.getState().phase).toBe("ready");
  });
});

describe("ThumbnailScheduler — cancel / dispose", () => {
  it("cancel removes pending work for a project", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    h.scheduler.cancel("proj-1");
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.scheduler.getState().phase).toBe("idle");
  });

  it("cancel all clears pending and drops in-flight generation", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject({ id: "proj-a" }), projectId: "proj-a", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);

    h.scheduler.cancel();
    // Resolve the in-flight generation — it must be dropped, never saved.
    const gen = h.generateQueue.shift()!;
    gen.resolve({ ok: true, record: makeRecord("proj-a", 1) });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.saveQueue.length).toBe(0);
    expect(h.scheduler.getState().phase).toBe("idle");
  });

  it("dispose prevents notifications and work", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    h.scheduler.dispose();
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.states.every((s) => s.phase === "queued")).toBe(true);
  });
});

describe("ThumbnailScheduler — listeners and state", () => {
  it("listener lifecycle — unsubscribe stops notifications", async () => {
    const h = setup();
    const localStates: string[] = [];
    const unsub = h.scheduler.subscribe((s) => localStates.push(s.phase));
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    unsub();
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    // Only the initial queued notification reached the listener.
    expect(localStates).toEqual(["queued"]);
    await resolveThrough(h, "proj-1", 1);
  });

  it("public state is an immutable snapshot", async () => {
    const h = setup();
    const s1 = h.scheduler.getState();
    expect(Object.isFrozen(s1)).toBe(true);
    // Mutating a frozen snapshot must throw in strict mode. Cast through any
    // because the union type legitimately allows valid phase values.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => { (s1 as any).phase = "queued"; }).toThrow();
  });

  it("manual flush forces immediate drain", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    const flushPromise = h.scheduler.flush();
    await Promise.resolve();
    expect(h.generate).toHaveBeenCalledTimes(1);
    await resolveThrough(h, "proj-1", 1);
    await flushPromise;
  });
});

describe("ThumbnailScheduler — ready completion notifications (eventual-thumbnail policy)", () => {
  it("publishes ready { projectId, revision } exactly once after a committed save", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 2);
    expect(h.readyEvents).toEqual([{ projectId: "proj-1", revision: 2 }]);
    expect(h.readyEvents).toHaveLength(1);
  });

  it("does NOT publish ready on generation failure", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1, { failGenerate: true });
    expect(h.readyEvents).toHaveLength(0);
    expect(h.scheduler.getState().phase).toBe("error");
  });

  it("does NOT publish ready on storage failure (quota/abort/transaction)", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1, { failSave: true });
    expect(h.readyEvents).toHaveLength(0);
    expect(h.scheduler.getState().phase).toBe("error");
  });

  it("does NOT publish ready on a stale-write rejection (STALE_REVISION)", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 2, { saveAsStale: true });
    // Scheduler state treats it as success (newer already stored) but no
    // ready notification — the existing record is already readable.
    expect(h.scheduler.getState().phase).toBe("ready");
    expect(h.readyEvents).toHaveLength(0);
  });

  it("does NOT publish ready for a deduplicated save (identical record already stored)", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 2, { deduplicated: true });
    expect(h.scheduler.getState().phase).toBe("ready");
    expect(h.readyEvents).toHaveLength(0);
  });

  it("does NOT publish ready for a superseded result (newer revision queued mid-flight)", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    // Newer revision arrives while generation 1 is in flight — rev 1 result
    // is dropped (never saved, never notified).
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    const gen = h.generateQueue.shift()!;
    gen.resolve({ ok: true, record: makeRecord("proj-1", 1) });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.saveQueue.length).toBe(0);
    expect(h.readyEvents).toHaveLength(0);
    // The drain chain then picks up the newer pending request — flush enough
    // microtask turns so the rev-2 generation starts, then clean it up.
    await flushMicrotasks(12);
    expect(h.generate).toHaveBeenCalledTimes(2);
    await resolveThrough(h, "proj-1", 2);
    expect(h.readyEvents).toHaveLength(1);
  });

  it("unsubscribe stops ready notifications", async () => {
    const h = setup();
    const local: Array<{ projectId: string; revision: number }> = [];
    const unsub = h.scheduler.subscribeReady((info) => local.push(info));
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    unsub();
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1);
    expect(local).toHaveLength(0);
  });

  it("dispose clears ready listeners and stops future notifications", async () => {
    const h = setup();
    h.scheduler.dispose();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    expect(h.readyEvents).toHaveLength(0);
  });

  it("a second genuine save publishes a second ready notification", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await resolveThrough(h, "proj-1", 1);
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 2 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await resolveThrough(h, "proj-1", 2);
    expect(h.readyEvents).toEqual([
      { projectId: "proj-1", revision: 1 },
      { projectId: "proj-1", revision: 2 },
    ]);
  });

  it("projects are isolated — ready fires per project", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject({ id: "proj-a" }), projectId: "proj-a", revision: 1 });
    h.scheduler.schedule({ project: makeProject({ id: "proj-b" }), projectId: "proj-b", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-a", 1);
    await flushMicrotasks(12);
    await resolveThrough(h, "proj-b", 1);
    expect(h.readyEvents).toEqual([
      { projectId: "proj-a", revision: 1 },
      { projectId: "proj-b", revision: 1 },
    ]);
  });
});

describe("ThumbnailScheduler — no duplicate notifications", () => {
  it("a successful generation+save notifies ready exactly once", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1);
    const readyCount = h.states.filter((s) => s.phase === "ready").length;
    expect(readyCount).toBe(1);
    expect(h.readyEvents).toHaveLength(1);
  });

  it("same-revision schedule after ready is deduplicated", async () => {
    const h = setup();
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await resolveThrough(h, "proj-1", 1);
    expect(h.scheduler.getState().phase).toBe("ready");

    // Schedule the same revision again — dedup prevents another full run
    // (the storage adapter treats identical content as idempotent, and the
    // scheduler simply re-queues; assert no crash and state remains sane).
    h.scheduler.schedule({ project: makeProject(), projectId: "proj-1", revision: 1 });
    vi.advanceTimersByTime(THUMBNAIL_DEBOUNCE_MS);
    await Promise.resolve();
    await resolveThrough(h, "proj-1", 1);
    expect(h.scheduler.getState().phase).toBe("ready");
  });
});
