// ---------------------------------------------------------------------------
// Frame heartbeat (Phase P23-B)
// Bounded unresponsive-frame detection: low frequency, one timer, latched
// callback, clean disposal, deterministic under fake timers.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFrameHeartbeat, type FrameHeartbeat } from "../heartbeat";

// interval 3000 / timeout 1500 / maxMisses 2 keeps the math easy:
// a tick at 3s observes 3s of silence → miss; 2 consecutive misses → fire.
const OPTIONS = { intervalMs: 3_000, timeoutMs: 1_500, maxMisses: 2 };

let onUnresponsive: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  onUnresponsive = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
});

function startHeartbeat(): FrameHeartbeat {
  const heartbeat = createFrameHeartbeat(onUnresponsive, OPTIONS);
  heartbeat.start();
  return heartbeat;
}

describe("responsive frame (ping/response)", () => {
  it("never declares an unresponsive frame that keeps reporting", () => {
    const heartbeat = startHeartbeat();
    // Report every 2s (within the 1.5s timeout of each 3s tick).
    for (let i = 0; i < 4; i += 1) {
      vi.advanceTimersByTime(2_000);
      heartbeat.markAlive();
    }
    expect(heartbeat.unresponsive).toBe(false);
    expect(heartbeat.misses).toBe(0);
    expect(onUnresponsive).not.toHaveBeenCalled();
    heartbeat.dispose();
  });
});

describe("timeout detection", () => {
  it("fires onUnresponsive once after maxMisses consecutive silent ticks", () => {
    const heartbeat = startHeartbeat();

    // t=3000 tick: 3s of silence ≥ timeout → miss 1.
    vi.advanceTimersByTime(3_000);
    expect(heartbeat.misses).toBe(1);
    expect(heartbeat.unresponsive).toBe(false);
    expect(onUnresponsive).not.toHaveBeenCalled();

    // t=6000 tick: miss 2 → unresponsive, callback fires once.
    vi.advanceTimersByTime(3_000);
    expect(heartbeat.unresponsive).toBe(true);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);

    heartbeat.dispose();
  });

  it("markAlive resets the miss counter", () => {
    const heartbeat = startHeartbeat();

    vi.advanceTimersByTime(3_000); // miss 1
    expect(heartbeat.misses).toBe(1);

    vi.advanceTimersByTime(500); // t=3500
    heartbeat.markAlive();
    expect(heartbeat.misses).toBe(0);

    // Next tick (t=6000) observes 2.5s of silence → miss 1 again — had the
    // reset not happened this would be miss 2 and the frame would be dead.
    vi.advanceTimersByTime(2_500);
    expect(heartbeat.misses).toBe(1);
    expect(heartbeat.unresponsive).toBe(false);
    expect(onUnresponsive).not.toHaveBeenCalled();

    heartbeat.dispose();
  });

  it("does not fire while the frame keeps reporting through many ticks", () => {
    const heartbeat = startHeartbeat();
    for (let i = 0; i < 10; i += 1) {
      vi.advanceTimersByTime(1_000);
      heartbeat.markAlive();
    }
    expect(heartbeat.unresponsive).toBe(false);
    expect(onUnresponsive).not.toHaveBeenCalled();
    heartbeat.dispose();
  });
});

describe("bounded / deterministic failures", () => {
  it("fires onUnresponsive exactly once even with continued silence", () => {
    const heartbeat = startHeartbeat();
    vi.advanceTimersByTime(3_000); // miss 1
    vi.advanceTimersByTime(3_000); // miss 2 → fire
    expect(onUnresponsive).toHaveBeenCalledTimes(1);

    // Continue far past the point of no return — still exactly one call.
    vi.advanceTimersByTime(30_000);
    expect(onUnresponsive).toHaveBeenCalledTimes(1);
    expect(heartbeat.unresponsive).toBe(true);
    heartbeat.dispose();
  });
});

describe("disposal", () => {
  it("stops timers and resets state; no callbacks after dispose", () => {
    const heartbeat = startHeartbeat();
    vi.advanceTimersByTime(3_000); // miss 1 (before dispose)
    expect(heartbeat.running).toBe(true);

    heartbeat.dispose();
    expect(heartbeat.running).toBe(false);
    expect(heartbeat.misses).toBe(0);
    expect(heartbeat.unresponsive).toBe(false);

    vi.advanceTimersByTime(60_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
  });

  it("is safe to dispose multiple times", () => {
    const heartbeat = startHeartbeat();
    heartbeat.dispose();
    heartbeat.dispose();
    expect(heartbeat.running).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(onUnresponsive).not.toHaveBeenCalled();
  });
});

describe("start semantics", () => {
  it("start is idempotent (a second start does not double the timer)", () => {
    const heartbeat = createFrameHeartbeat(onUnresponsive, OPTIONS);
    heartbeat.start();
    heartbeat.start();
    vi.advanceTimersByTime(3_000);
    expect(heartbeat.misses).toBe(1); // one timer → one miss, not two
    heartbeat.dispose();
  });

  it("does nothing before start", () => {
    const heartbeat = createFrameHeartbeat(onUnresponsive, OPTIONS);
    vi.advanceTimersByTime(30_000);
    expect(heartbeat.running).toBe(false);
    expect(onUnresponsive).not.toHaveBeenCalled();
  });
});
