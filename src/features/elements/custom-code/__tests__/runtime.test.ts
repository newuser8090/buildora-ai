// ---------------------------------------------------------------------------
// Custom-code runtime controller (Phase P23-G)
//
// The parent-side instance lifecycle: state model, message validation
// (source identity + allow-listed payload), heartbeat integration, bounded
// recovery, structured error delivery, and idempotent disposal.
//
// The key invariant under test: a disposed/replaced runtime can never affect
// the active runtime.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createCustomCodeRuntime,
  type CustomCodeRuntime,
  type CustomCodeRuntimeState,
} from "../runtime";
import { RUNTIME_MESSAGE_TYPES } from "../constants";
import {
  MAX_DIAGNOSTIC_MESSAGE_LENGTH,
  type RuntimeDiagnostic,
} from "../diagnostics";

// interval 3000 / timeout 1500 / maxMisses 2 keeps the math easy:
// a tick at 3s observes 3s of silence → miss; 2 consecutive misses → fire.
const HEARTBEAT = { intervalMs: 3_000, timeoutMs: 1_500, maxMisses: 2 };

interface Harness {
  runtime: CustomCodeRuntime;
  contentWindow: { self: string };
  onReady: ReturnType<typeof vi.fn>;
  onHeight: ReturnType<typeof vi.fn>;
  onUnresponsive: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onStateChange: ReturnType<typeof vi.fn>;
  onDiagnostic: ReturnType<typeof vi.fn>;
}

function createHarness(maxRecoveryAttempts?: number): Harness {
  const contentWindow = { self: "frame" };
  const onReady = vi.fn();
  const onHeight = vi.fn();
  const onUnresponsive = vi.fn();
  const onError = vi.fn();
  const onStateChange = vi.fn();
  const onDiagnostic = vi.fn();
  const runtime = createCustomCodeRuntime({
    getContentWindow: () => contentWindow,
    heartbeat: HEARTBEAT,
    maxRecoveryAttempts,
    onReady,
    onHeight,
    onUnresponsive,
    onError,
    onStateChange,
    onDiagnostic,
  });
  return {
    runtime,
    contentWindow,
    onReady,
    onHeight,
    onUnresponsive,
    onError,
    onStateChange,
    onDiagnostic,
  };
}

function readyMessage(): unknown {
  return { type: RUNTIME_MESSAGE_TYPES.ready };
}

function heightMessage(height: number): unknown {
  return { type: RUNTIME_MESSAGE_TYPES.height, height };
}

function errorMessage(message = "boom"): unknown {
  return { type: RUNTIME_MESSAGE_TYPES.error, error: { message } };
}

/** Drive a runtime into the healthy `ready` state. */
function makeReady(h: Harness): void {
  h.runtime.mount();
  expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
  expect(h.runtime.state).toBe("ready");
}

/** Advance fake time until the heartbeat declares the frame unresponsive. */
function forceUnresponsive(h: Harness): void {
  vi.advanceTimersByTime(3_000); // miss 1
  vi.advanceTimersByTime(3_000); // miss 2 → unresponsive
  expect(h.runtime.state).toBe("unresponsive");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------

describe("lifecycle", () => {
  it("starts idle, mounts to mounting, and assigns an instance id", () => {
    const h = createHarness();
    expect(h.runtime.state).toBe("idle");
    h.runtime.mount();
    expect(h.runtime.state).toBe("mounting");
    expect(h.onStateChange).toHaveBeenLastCalledWith("mounting");
  });

  it("gives every runtime a distinct instance id", () => {
    const a = createHarness();
    const b = createHarness();
    expect(a.runtime.instanceId).not.toBe(b.runtime.instanceId);
  });

  it("mount is idempotent — a second mount never doubles the heartbeat", () => {
    const h = createHarness();
    h.runtime.mount();
    h.runtime.mount();
    expect(h.runtime.state).toBe("mounting");
    // One timer: at t=3000 one miss; two timers would have reached maxMisses
    // and declared unresponsive already.
    vi.advanceTimersByTime(3_000);
    expect(h.onUnresponsive).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(h.onUnresponsive).toHaveBeenCalledTimes(1);
  });

  it("replacement invalidates the previous instance", () => {
    const oldHarness = createHarness();
    makeReady(oldHarness);
    const newHarness = createHarness();

    // Old runtime disposed (the replaced frame is gone).
    oldHarness.runtime.dispose();
    expect(oldHarness.runtime.state).toBe("disposed");

    // The stale frame's messages can never reach the active runtime.
    expect(oldHarness.runtime.handleMessage(oldHarness.contentWindow, readyMessage())).toBe(false);

    // The active runtime works normally.
    newHarness.runtime.mount();
    expect(newHarness.runtime.handleMessage(newHarness.contentWindow, readyMessage())).toBe(true);
    expect(newHarness.runtime.state).toBe("ready");
  });

  it("unmount invalidates the instance and stops all callbacks", () => {
    const h = createHarness();
    makeReady(h);
    h.runtime.dispose();
    expect(h.runtime.state).toBe("disposed");
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(100))).toBe(false);
    // Heartbeat timers are gone — nothing can fire after dispose.
    vi.advanceTimersByTime(60_000);
    expect(h.onUnresponsive).not.toHaveBeenCalled();
  });

  it("dispose is idempotent and never throws", () => {
    const h = createHarness();
    h.runtime.mount();
    h.runtime.dispose();
    expect(() => {
      h.runtime.dispose();
      h.runtime.dispose();
    }).not.toThrow();
    expect(h.runtime.state).toBe("disposed");
  });

  it("rejects messages while idle (never mounted)", () => {
    const h = createHarness();
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(false);
    expect(h.runtime.state).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// MESSAGES — source identity + payload validation
// ---------------------------------------------------------------------------

describe("message validation", () => {
  it("accepts a ready message from the current frame source", () => {
    const h = createHarness();
    h.runtime.mount();
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
    expect(h.runtime.state).toBe("ready");
    expect(h.onReady).toHaveBeenCalledTimes(1);
  });

  it("accepts a height message from the current frame source after ready", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(500))).toBe(true);
    expect(h.onHeight).toHaveBeenCalledWith(500);
  });

  it("rejects a message from the wrong source", () => {
    const h = createHarness();
    h.runtime.mount();
    expect(h.runtime.handleMessage({ other: "window" }, readyMessage())).toBe(false);
    expect(h.runtime.handleMessage(null, readyMessage())).toBe(false);
    expect(h.runtime.handleMessage(undefined, readyMessage())).toBe(false);
    expect(h.runtime.state).toBe("mounting");
  });

  it("rejects a message from a stale (replaced) frame source", () => {
    const oldHarness = createHarness();
    makeReady(oldHarness);
    const activeHarness = createHarness();
    activeHarness.runtime.mount();

    oldHarness.runtime.dispose();
    expect(oldHarness.runtime.handleMessage(oldHarness.contentWindow, readyMessage())).toBe(false);
  });

  it("rejects malformed payloads", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, "buildora:ready")).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, null)).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, 42)).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, ["buildora:ready"])).toBe(false);
  });

  it("rejects unknown message types", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, { type: "buildora:evil" })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: "buildora:ping" })).toBe(false);
  });

  it("rejects valid types with invalid payloads", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.height, height: "500" })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.height })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.ready, extra: 1 })).toBe(false);
  });

  it("fences out non-ready messages while the frame is mounting (stale frame)", () => {
    const h = createHarness();
    h.runtime.mount();
    // A height from a previous document must not anchor the fresh frame.
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(999))).toBe(false);
    expect(h.onHeight).not.toHaveBeenCalled();
    expect(h.runtime.state).toBe("mounting");
    // The fresh frame's own ready anchors it.
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
  });

  it("re-anchors on a ready message while already ready (self-reload)", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
    expect(h.runtime.state).toBe("ready");
    // No duplicate onReady for a plain re-anchor.
    expect(h.onReady).toHaveBeenCalledTimes(1);
  });

  it("never throws on hostile inputs", () => {
    const h = createHarness();
    makeReady(h);
    const hostile: unknown[] = [
      { type: RUNTIME_MESSAGE_TYPES.height, height: { valueOf: () => 5 } },
      { type: RUNTIME_MESSAGE_TYPES.error, error: { message: 42 } },
      { type: RUNTIME_MESSAGE_TYPES.error, error: { message: "x", stack: 5 } },
      Object.create(null),
      Symbol("x"),
    ];
    for (const payload of hostile) {
      expect(() => h.runtime.handleMessage(h.contentWindow, payload)).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// HEARTBEAT — liveness, timeout, bounded recovery, cleanup
// ---------------------------------------------------------------------------

describe("heartbeat integration", () => {
  it("never declares a healthy frame unresponsive", () => {
    const h = createHarness();
    makeReady(h);
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(2_000);
      expect(h.runtime.handleMessage(h.contentWindow, heightMessage(100 + i))).toBe(true);
    }
    expect(h.runtime.state).toBe("ready");
    expect(h.onUnresponsive).not.toHaveBeenCalled();
  });

  it("declares a silent frame unresponsive after bounded misses", () => {
    const h = createHarness();
    makeReady(h);
    vi.advanceTimersByTime(3_000); // miss 1
    expect(h.runtime.state).toBe("ready");
    vi.advanceTimersByTime(3_000); // miss 2 → unresponsive
    expect(h.runtime.state).toBe("unresponsive");
    expect(h.onUnresponsive).toHaveBeenCalledTimes(1);
  });

  it("fires onUnresponsive exactly once for continued silence", () => {
    const h = createHarness();
    makeReady(h);
    forceUnresponsive(h);
    vi.advanceTimersByTime(30_000);
    expect(h.onUnresponsive).toHaveBeenCalledTimes(1);
  });

  it("recovers after a validated message and confirms with a second one", () => {
    const h = createHarness();
    makeReady(h);
    forceUnresponsive(h);

    // First validated message → recovering (the frame came back).
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(120))).toBe(true);
    expect(h.runtime.state).toBe("recovering");
    expect(h.onHeight).toHaveBeenLastCalledWith(120);
    expect(h.onReady).toHaveBeenCalledTimes(2); // initial + recovery

    // Second validated message confirms the recovery → ready.
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(130))).toBe(true);
    expect(h.runtime.state).toBe("ready");
  });

  it("bounded recovery — a frame that keeps failing is declared dead", () => {
    const h = createHarness(1); // one recovery allowed
    makeReady(h);
    forceUnresponsive(h);

    // First recovery succeeds.
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
    expect(h.runtime.state).toBe("recovering");
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(10))).toBe(true);
    expect(h.runtime.state).toBe("ready");

    // Frame dies again.
    forceUnresponsive(h);

    // Recovery budget exhausted — the message is rejected and the heartbeat
    // is stopped, so the dead frame can never come back.
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(false);
    expect(h.runtime.state).toBe("unresponsive");
    vi.advanceTimersByTime(60_000);
    expect(h.onUnresponsive).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale heartbeat response after disposal", () => {
    const h = createHarness();
    makeReady(h);
    h.runtime.dispose();
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(5))).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(h.onUnresponsive).not.toHaveBeenCalled();
  });

  it("replacement during a heartbeat leaves no timers behind", () => {
    const oldHarness = createHarness();
    makeReady(oldHarness);
    const newHarness = createHarness();

    // Replace the frame mid-heartbeat.
    oldHarness.runtime.dispose();
    newHarness.runtime.mount();
    expect(newHarness.runtime.handleMessage(newHarness.contentWindow, readyMessage())).toBe(true);

    // The old heartbeat is gone — silence on the old instance fires nothing.
    vi.advanceTimersByTime(60_000);
    expect(oldHarness.onUnresponsive).not.toHaveBeenCalled();
  });

  it("cleanup clears every timer", () => {
    const h = createHarness();
    makeReady(h);
    h.runtime.dispose();
    vi.advanceTimersByTime(120_000);
    expect(h.onUnresponsive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// RUNTIME ERRORS — structured, sanitized, contained
// ---------------------------------------------------------------------------

describe("runtime error isolation", () => {
  it("delivers a structured sanitized error to the parent", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, errorMessage("boom"))).toBe(true);
    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError).toHaveBeenCalledWith({ message: "boom" });
    // The frame stays usable after an error report.
    expect(h.runtime.state).toBe("ready");
  });

  it("delivers the capped stack when present", () => {
    const h = createHarness();
    makeReady(h);
    expect(
      h.runtime.handleMessage(h.contentWindow, {
        type: RUNTIME_MESSAGE_TYPES.error,
        error: { message: "x", stack: "at fn (file.js:1:1)" },
      }),
    ).toBe(true);
    expect(h.onError).toHaveBeenCalledWith({
      message: "x",
      stack: "at fn (file.js:1:1)",
    });
  });

  it("rejects malformed error reports", () => {
    const h = createHarness();
    makeReady(h);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: "boom" })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: { message: 42 } })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: { message: "" } })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: { message: "x", extra: 1 } })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: { message: "x", stack: 5 } })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: { message: "x" }, extra: 1 })).toBe(false);
    expect(h.onError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UPDATES — payload changes invalidate the old runtime, never the new one
// ---------------------------------------------------------------------------

describe("update consistency", () => {
  it("a JS update invalidates the old runtime", () => {
    const oldHarness = createHarness();
    makeReady(oldHarness);

    // The payload changed → a fresh runtime owns the frame now.
    const newHarness = createHarness();
    newHarness.runtime.mount();
    oldHarness.runtime.dispose();

    expect(oldHarness.runtime.handleMessage(oldHarness.contentWindow, readyMessage())).toBe(false);
    expect(newHarness.runtime.handleMessage(newHarness.contentWindow, readyMessage())).toBe(true);
    expect(newHarness.runtime.state).toBe("ready");
  });

  it("an html/css/attribute update never retains the stale runtime", () => {
    const first = createHarness();
    makeReady(first);
    const second = createHarness();
    second.runtime.mount();
    first.runtime.dispose();

    // Stale height from the old frame is rejected...
    expect(first.runtime.handleMessage(first.contentWindow, heightMessage(999))).toBe(false);
    // ...and the new frame's reports are honored after it anchors.
    expect(second.runtime.handleMessage(second.contentWindow, readyMessage())).toBe(true);
    expect(second.runtime.handleMessage(second.contentWindow, heightMessage(321))).toBe(true);
    expect(second.onHeight).toHaveBeenCalledWith(321);
  });

  it("enabled=false leaves no active runtime behind", () => {
    const h = createHarness();
    makeReady(h);
    h.runtime.dispose(); // disabling a payload unmounts the frame
    expect(h.runtime.state).toBe("disposed");
    vi.advanceTimersByTime(60_000);
    expect(h.onUnresponsive).not.toHaveBeenCalled();
  });

  it("rapid consecutive updates remain race-safe (only the last runtime lives)", () => {
    const r1 = createHarness();
    const r2 = createHarness();
    const r3 = createHarness();

    r1.runtime.mount();
    r2.runtime.mount();
    r3.runtime.mount();

    r1.runtime.dispose();
    r2.runtime.dispose();

    expect(r1.runtime.handleMessage(r1.contentWindow, readyMessage())).toBe(false);
    expect(r2.runtime.handleMessage(r2.contentWindow, readyMessage())).toBe(false);
    expect(r3.runtime.handleMessage(r3.contentWindow, readyMessage())).toBe(true);
    expect(r3.runtime.state).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// STATE MODEL — explicit lifecycle transitions
// ---------------------------------------------------------------------------

describe("state model", () => {
  it("walks the full lifecycle in order", () => {
    const h = createHarness();
    const seen: CustomCodeRuntimeState[] = [];
    h.onStateChange.mockImplementation((s: CustomCodeRuntimeState) => seen.push(s));

    h.runtime.mount();
    h.runtime.handleMessage(h.contentWindow, readyMessage());
    forceUnresponsive(h);
    h.runtime.handleMessage(h.contentWindow, readyMessage());
    h.runtime.handleMessage(h.contentWindow, heightMessage(5));
    h.runtime.dispose();

    expect(seen).toEqual([
      "mounting",
      "ready",
      "unresponsive",
      "recovering",
      "ready",
      "disposed",
    ]);
  });

  it("a disposed runtime is terminal — mount can never revive it", () => {
    const h = createHarness();
    h.runtime.mount();
    h.runtime.dispose();
    h.runtime.mount();
    expect(h.runtime.state).toBe("disposed");
  });
});

// ---------------------------------------------------------------------------
// OBSERVABILITY (P23-H) — diagnostics + read-only snapshot
// ---------------------------------------------------------------------------

/** The ordered diagnostic kinds emitted so far. */
function diagnosticKinds(h: Harness): RuntimeDiagnostic["kind"][] {
  return h.onDiagnostic.mock.calls.map((call) => {
    const diagnostic = call[0] as RuntimeDiagnostic;
    return diagnostic.kind;
  });
}

describe("diagnostic emission (P23-H)", () => {
  it("emits a ready diagnostic exactly once per instance, with identity", () => {
    const h = createHarness();
    h.runtime.mount();
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);

    expect(h.onDiagnostic).toHaveBeenCalledTimes(1);
    const diagnostic = h.onDiagnostic.mock.calls[0][0] as RuntimeDiagnostic;
    expect(diagnostic.kind).toBe("ready");
    expect(diagnostic.instanceId).toBe(h.runtime.instanceId);
    expect(diagnostic.message).toBe("Frame ready");
    expect(typeof diagnostic.at).toBe("number");

    // A re-anchoring ready (self-reload) reports no duplicate lifecycle event.
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
    expect(h.onDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("emits height diagnostics with the validated height", () => {
    const h = createHarness();
    makeReady(h);
    h.onDiagnostic.mockClear();

    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(500))).toBe(true);
    const diagnostic = h.onDiagnostic.mock.calls[0][0] as RuntimeDiagnostic;
    expect(diagnostic.kind).toBe("height");
    expect(diagnostic.height).toBe(500);
    expect(diagnostic.message).toBe("Frame height updated");
  });

  it("emits error diagnostics with the sanitized error info", () => {
    const h = createHarness();
    makeReady(h);
    h.onDiagnostic.mockClear();

    expect(h.runtime.handleMessage(h.contentWindow, errorMessage("boom"))).toBe(true);
    const diagnostic = h.onDiagnostic.mock.calls[0][0] as RuntimeDiagnostic;
    expect(diagnostic.kind).toBe("error");
    expect(diagnostic.error).toEqual({ message: "boom" });
    expect(diagnostic.message).toBe("Runtime error reported");
  });

  it("emits the full lifecycle diagnostic sequence in order", () => {
    const h = createHarness();
    h.runtime.mount();
    h.runtime.handleMessage(h.contentWindow, readyMessage()); // ready
    h.runtime.handleMessage(h.contentWindow, heightMessage(400)); // height
    h.runtime.handleMessage(h.contentWindow, errorMessage("x")); // error
    forceUnresponsive(h); // unresponsive
    h.runtime.handleMessage(h.contentWindow, readyMessage()); // recovery-started
    h.runtime.handleMessage(h.contentWindow, readyMessage()); // recovery-succeeded
    h.runtime.dispose(); // disposed

    expect(diagnosticKinds(h)).toEqual([
      "ready",
      "height",
      "error",
      "unresponsive",
      "recovery-started",
      "recovery-succeeded",
      "disposed",
    ]);
  });

  it("state observers fire before the matching diagnostic and semantic callback", () => {
    const h = createHarness();
    h.runtime.mount();
    h.runtime.handleMessage(h.contentWindow, readyMessage());

    const stateChangeReadyIndex = h.onStateChange.mock.invocationCallOrder[1];
    const diagnosticIndex = h.onDiagnostic.mock.invocationCallOrder[0];
    const onReadyIndex = h.onReady.mock.invocationCallOrder[0];
    expect(stateChangeReadyIndex).toBeLessThan(diagnosticIndex);
    expect(diagnosticIndex).toBeLessThan(onReadyIndex);
  });

  it("recovery diagnostics fire per recovery cycle", () => {
    const h = createHarness();
    makeReady(h);
    forceUnresponsive(h);

    h.runtime.handleMessage(h.contentWindow, readyMessage()); // recovery-started
    expect(diagnosticKinds(h)).toContain("recovery-started");
    h.runtime.handleMessage(h.contentWindow, heightMessage(10)); // recovery-succeeded
    expect(diagnosticKinds(h)).toContain("recovery-succeeded");

    // A second silent period reports its own unresponsive event (each cycle
    // is a real timeout — not a duplicate).
    forceUnresponsive(h);
    const unresponsiveCount = diagnosticKinds(h).filter(
      (kind) => kind === "unresponsive",
    ).length;
    expect(unresponsiveCount).toBe(2);
  });

  it("recovery exhaustion is reported exactly once", () => {
    const h = createHarness(0); // no recovery allowed
    makeReady(h);
    forceUnresponsive(h);
    h.onDiagnostic.mockClear();

    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, heightMessage(1))).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(false);

    const exhausted = diagnosticKinds(h).filter(
      (kind) => kind === "recovery-exhausted",
    );
    expect(exhausted).toHaveLength(1);
  });

  it("dispose reports disposed exactly once; no events after disposal", () => {
    const h = createHarness();
    makeReady(h);
    h.onDiagnostic.mockClear();

    h.runtime.dispose();
    h.runtime.dispose();
    expect(diagnosticKinds(h)).toEqual(["disposed"]);

    // Disposal prevents future events — even valid messages and timers.
    expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(diagnosticKinds(h)).toEqual(["disposed"]);
  });

  it("a stale runtime never emits events after replacement", () => {
    const oldHarness = createHarness();
    makeReady(oldHarness);
    const activeHarness = createHarness();
    activeHarness.runtime.mount();

    oldHarness.runtime.dispose();
    oldHarness.onDiagnostic.mockClear();
    expect(oldHarness.runtime.handleMessage(oldHarness.contentWindow, readyMessage())).toBe(false);
    expect(oldHarness.onDiagnostic).not.toHaveBeenCalled();
  });

  it("rejected and hostile messages never produce diagnostics", () => {
    const h = createHarness();
    makeReady(h);
    h.onDiagnostic.mockClear();

    expect(h.runtime.handleMessage({ other: "window" }, readyMessage())).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: "buildora:evil" })).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, "garbage")).toBe(false);
    expect(h.runtime.handleMessage(h.contentWindow, { type: RUNTIME_MESSAGE_TYPES.error, error: { message: 42 } })).toBe(false);
    expect(h.onDiagnostic).not.toHaveBeenCalled();
  });

  it("diagnostic strings are always bounded", () => {
    const h = createHarness();
    h.runtime.mount();
    h.runtime.handleMessage(h.contentWindow, readyMessage());
    h.runtime.handleMessage(h.contentWindow, heightMessage(5));
    h.runtime.handleMessage(h.contentWindow, errorMessage("boom"));
    forceUnresponsive(h);
    h.runtime.handleMessage(h.contentWindow, readyMessage());
    h.runtime.handleMessage(h.contentWindow, heightMessage(6));
    h.runtime.dispose();

    for (const call of h.onDiagnostic.mock.calls) {
      const diagnostic = call[0] as RuntimeDiagnostic;
      expect(diagnostic.message.length).toBeLessThanOrEqual(
        MAX_DIAGNOSTIC_MESSAGE_LENGTH,
      );
    }
  });

  it("diagnostics never carry raw payloads or exception objects", () => {
    const h = createHarness();
    makeReady(h);
    h.runtime.handleMessage(h.contentWindow, heightMessage(500));
    h.runtime.handleMessage(h.contentWindow, errorMessage("boom"));

    for (const call of h.onDiagnostic.mock.calls) {
      const diagnostic = call[0] as RuntimeDiagnostic;
      expect(diagnostic).not.toHaveProperty("source");
      expect(diagnostic).not.toHaveProperty("data");
      expect(diagnostic).not.toHaveProperty("contentWindow");
      expect(diagnostic).not.toHaveProperty("exception");
    }
  });
});

describe("observer safety (P23-H)", () => {
  it("a throwing onDiagnostic observer cannot break the runtime", () => {
    const h = createHarness();
    h.onDiagnostic.mockImplementation(() => {
      throw new Error("observer blew up");
    });

    expect(() => {
      h.runtime.mount();
      h.runtime.handleMessage(h.contentWindow, readyMessage());
      h.runtime.handleMessage(h.contentWindow, heightMessage(5));
      h.runtime.dispose();
    }).not.toThrow();
    expect(h.runtime.state).toBe("disposed");
    vi.advanceTimersByTime(60_000);
    expect(h.onUnresponsive).not.toHaveBeenCalled(); // cleanup unaffected
  });

  it("a throwing semantic callback cannot break recovery or cleanup", () => {
    const h = createHarness();
    h.onReady.mockImplementation(() => {
      throw new Error("onReady blew up");
    });
    makeReady(h);

    forceUnresponsive(h);
    expect(() => {
      // Recovery still progresses despite onReady throwing.
      expect(h.runtime.handleMessage(h.contentWindow, readyMessage())).toBe(true);
      expect(h.runtime.state).toBe("recovering");
      h.runtime.dispose();
    }).not.toThrow();
  });
});

describe("runtime snapshot (P23-H)", () => {
  it("reflects current state before and after events", () => {
    const h = createHarness();
    let snap = h.runtime.snapshot();
    expect(snap).toEqual({
      instanceId: h.runtime.instanceId,
      state: "idle",
      recoveryAttempts: 0,
      heartbeatActive: false,
      lastHeight: null,
      lastDiagnostic: null,
      updatedAt: expect.any(Number),
    });

    h.runtime.mount();
    h.runtime.handleMessage(h.contentWindow, readyMessage());
    h.runtime.handleMessage(h.contentWindow, heightMessage(500));

    snap = h.runtime.snapshot();
    expect(snap.state).toBe("ready");
    expect(snap.heartbeatActive).toBe(true);
    expect(snap.lastHeight).toBe(500);
    expect(snap.lastDiagnostic?.kind).toBe("height");
    expect(snap.lastDiagnostic?.height).toBe(500);

    h.runtime.dispose();
    snap = h.runtime.snapshot();
    expect(snap.state).toBe("disposed");
    expect(snap.heartbeatActive).toBe(false);
    expect(snap.lastDiagnostic?.kind).toBe("disposed");
  });

  it("tracks recovery attempts", () => {
    const h = createHarness();
    makeReady(h);
    forceUnresponsive(h);
    h.runtime.handleMessage(h.contentWindow, readyMessage());
    expect(h.runtime.snapshot().recoveryAttempts).toBe(1);
    h.runtime.handleMessage(h.contentWindow, heightMessage(5));
    expect(h.runtime.snapshot().recoveryAttempts).toBe(1);
  });

  it("returns a fresh frozen copy every call — read-only, no live references", () => {
    const h = createHarness();
    makeReady(h);
    h.runtime.handleMessage(h.contentWindow, heightMessage(200));

    const first = h.runtime.snapshot();
    const second = h.runtime.snapshot();
    expect(first).not.toBe(second); // fresh copy
    expect(second).toEqual(first); // same observable state
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.lastDiagnostic)).toBe(true);

    // Exact field set — bounded primitives only, never live references.
    expect(Object.keys(first).sort()).toEqual([
      "heartbeatActive",
      "instanceId",
      "lastDiagnostic",
      "lastHeight",
      "recoveryAttempts",
      "state",
      "updatedAt",
    ]);
  });
});
