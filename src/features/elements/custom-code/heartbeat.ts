// ---------------------------------------------------------------------------
// Frame heartbeat (Phase P23-B) — unresponsive-frame detector
//
// The parent pings liveness by EXPECTING a validated frame message
// (buildora:ready / buildora:height) at least once per interval. A tick that
// finds more than `timeoutMs` of silence counts a miss; after `maxMisses`
// consecutive misses the frame is declared unresponsive (callback fires ONCE —
// the flag latches, so repeated failures are bounded).
//
// Properties:
//   - low frequency (intervalMs default 3s), bounded timeout, one timer at a
//     time, clean disposal (timers stopped, state reset)
//   - no sensitive data flows through it; it carries only timestamps
//   - deterministic and testable via injected clock/timers (or vi fake timers)
//
// Honest limitation (documented per the approved architecture): an iframe
// does NOT provide a hard CPU limit. A busy loop in the frame burns that
// frame's own thread without blocking the parent; this heartbeat only
// DETECTS that the frame stopped responding — it does not and cannot impose
// a CPU budget.
//
// Framework-independent: no DOM access.
// ---------------------------------------------------------------------------

import { HEARTBEAT_DEFAULTS } from "./constants";

export interface FrameHeartbeatOptions {
  /** How often liveness is checked. */
  intervalMs?: number;
  /** Max silence before a check counts as a miss. */
  timeoutMs?: number;
  /** Consecutive misses before `onUnresponsive` fires (latched). */
  maxMisses?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface FrameHeartbeat {
  start(): void;
  /** Record a validated frame message (resets the silence window). */
  markAlive(): void;
  /**
   * Clear the latched "unresponsive" flag and the miss counter WITHOUT
   * stopping the loop (Phase P23-G — bounded recovery). Used when a frame
   * that was declared unresponsive produces a validated message again; the
   * same heartbeat instance can then detect a second stall. The caller is
   * responsible for bounding how often recovery is allowed.
   */
  reset(): void;
  /** Stop all timers and reset state. Safe to call more than once. */
  dispose(): void;
  readonly running: boolean;
  readonly unresponsive: boolean;
  readonly misses: number;
}

export function createFrameHeartbeat(
  onUnresponsive: () => void,
  options: FrameHeartbeatOptions = {},
): FrameHeartbeat {
  const intervalMs = options.intervalMs ?? HEARTBEAT_DEFAULTS.intervalMs;
  const timeoutMs = options.timeoutMs ?? HEARTBEAT_DEFAULTS.timeoutMs;
  const maxMisses = options.maxMisses ?? HEARTBEAT_DEFAULTS.maxMisses;
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));

  let timer: unknown = undefined;
  let running = false;
  let lastSeen = 0;
  let misses = 0;
  let unresponsive = false;

  const tick = (): void => {
    if (!running) return;
    if (now() - lastSeen >= timeoutMs) {
      misses += 1;
      if (misses >= maxMisses && !unresponsive) {
        unresponsive = true;
        onUnresponsive();
      }
    } else {
      misses = 0;
    }
    timer = setTimer(tick, intervalMs);
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastSeen = now();
      misses = 0;
      timer = setTimer(tick, intervalMs);
    },
    markAlive() {
      lastSeen = now();
      misses = 0;
    },
    reset() {
      unresponsive = false;
      misses = 0;
      lastSeen = now();
    },
    dispose() {
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      running = false;
      lastSeen = 0;
      misses = 0;
    },
    get running() {
      return running;
    },
    get unresponsive() {
      return unresponsive;
    },
    get misses() {
      return misses;
    },
  };
}
