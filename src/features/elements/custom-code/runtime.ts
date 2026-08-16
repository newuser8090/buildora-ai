// ---------------------------------------------------------------------------
// Custom-code runtime controller (Phase P23-G) — parent-side instance lifecycle
//
// One controller owns ONE mounted custom-code iframe runtime. It enforces the
// hard invariant of the whole phase:
//
//     A disposed/replaced runtime can never affect the active runtime.
//
// Everything the parent needs to keep an iframe instance safe is here:
//   - an explicit lifecycle (idle → mounting → ready ⇄ unresponsive →
//     recovering) with a terminal `disposed` state
//   - message validation: source identity (event.source === the iframe's
//     contentWindow — the sandbox deliberately has an opaque origin, so
//     origin checks are meaningless) + allow-listed payload shape
//     (parseRuntimeMessage)
//   - a per-instance heartbeat (one timer, bounded timeout, bounded recovery
//     budget — a frame can recover a finite number of times, then it is dead)
//   - structured, sanitized runtime-error delivery (never an exception object)
//   - idempotent disposal that stops every timer and rejects every message
//
// Framework-independent: no DOM, no timers created outside the heartbeat's
// injected clock/timers (or vi fake timers in tests). The generated export
// component embeds a faithful mirror of these semantics because exported
// files must be self-contained; this module is the tested reference.
// ---------------------------------------------------------------------------

import { MAX_RECOVERY_ATTEMPTS } from "./constants";
import {
  createFrameHeartbeat,
  type FrameHeartbeatOptions,
} from "./heartbeat";
import {
  isRuntimeMessageSource,
  parseRuntimeMessage,
  type RuntimeErrorInfo,
} from "./message-protocol";

/**
 * Lifecycle states. Only the useful ones exist:
 *   idle          — created, not mounted yet
 *   mounting      — frame mounting/loading; ONLY `ready` may anchor it
 *   ready         — a validated frame message arrived; runtime healthy
 *   unresponsive  — heartbeat declared the frame dead (silence)
 *   recovering    — the frame responded after being declared dead (awaiting
 *                   confirmation by a second validated message)
 *   disposed      — terminal: unmounted/replaced; nothing is ever accepted
 */
export type CustomCodeRuntimeState =
  | "idle"
  | "mounting"
  | "ready"
  | "unresponsive"
  | "recovering"
  | "disposed";

export interface CustomCodeRuntimeOptions {
  /**
   * Returns the iframe's contentWindow. Read fresh for every message so the
   * check always compares against the CURRENT frame (a replaced frame's old
   * window can never match).
   */
  getContentWindow?: () => unknown;
  /** Heartbeat tuning (defaults to HEARTBEAT_DEFAULTS). */
  heartbeat?: FrameHeartbeatOptions;
  /**
   * How many times this instance may recover after being declared
   * unresponsive before it is treated as dead (default MAX_RECOVERY_ATTEMPTS).
   * Bounded — there is never an infinite recover/declared-dead loop.
   */
  maxRecoveryAttempts?: number;
  onReady?: () => void;
  onHeight?: (height: number) => void;
  onUnresponsive?: () => void;
  onError?: (error: RuntimeErrorInfo) => void;
  onStateChange?: (state: CustomCodeRuntimeState) => void;
}

export interface CustomCodeRuntime {
  /** Monotonic per-process id — labels this runtime instance. */
  readonly instanceId: number;
  readonly state: CustomCodeRuntimeState;
  /** Begin the runtime lifecycle. Idempotent; no-op once mounted/disposed. */
  mount(): void;
  /**
   * Validate + process one postMessage event. Returns true when the message
   * was accepted (correct source, valid payload, live instance), false
   * otherwise — rejected messages never touch runtime state.
   */
  handleMessage(source: unknown, data: unknown): boolean;
  /** Record a validated frame message as a liveness signal. */
  markAlive(): void;
  /**
   * Invalidate this runtime permanently (unmount/replacement). Idempotent:
   * timers are stopped, state becomes `disposed`, every subsequent message
   * is rejected. A disposed runtime can never affect the active runtime.
   */
  dispose(): void;
}

/** Id allocator only — labels instances; no behavior depends on it. */
let nextRuntimeInstanceId = 0;

export function createCustomCodeRuntime(
  options: CustomCodeRuntimeOptions = {},
): CustomCodeRuntime {
  const instanceId = (nextRuntimeInstanceId += 1);
  const getContentWindow = options.getContentWindow ?? (() => null);
  const maxRecoveryAttempts =
    options.maxRecoveryAttempts ?? MAX_RECOVERY_ATTEMPTS;
  const onReady = options.onReady ?? (() => {});
  const onHeight = options.onHeight ?? (() => {});
  const onUnresponsive = options.onUnresponsive ?? (() => {});
  const onError = options.onError ?? (() => {});
  const onStateChange = options.onStateChange ?? (() => {});

  let state: CustomCodeRuntimeState = "idle";
  /** Consumed recoveries — bounded by maxRecoveryAttempts. */
  let recoveryAttempts = 0;

  const setState = (next: CustomCodeRuntimeState): void => {
    if (state === next) return;
    state = next;
    onStateChange(next);
  };

  const heartbeat = createFrameHeartbeat(() => {
    // Guard: the latched heartbeat callback can never fire after dispose.
    if (state === "disposed") return;
    setState("unresponsive");
    onUnresponsive();
  }, options.heartbeat ?? {});

  const reject = (): false => false;

  const recover = (): boolean => {
    // Bounded: once the budget is spent, the frame is dead — no timers, no
    // more recovery attempts, subsequent messages are ignored.
    if (recoveryAttempts >= maxRecoveryAttempts) {
      heartbeat.dispose();
      return reject();
    }
    recoveryAttempts += 1;
    heartbeat.reset();
    setState("recovering");
    onReady();
    heartbeat.markAlive();
    return true;
  };

  const handleMessage = (source: unknown, data: unknown): boolean => {
    if (state === "disposed" || state === "idle") return reject();

    // Source identity: only the CURRENT contentWindow may drive this runtime.
    if (!isRuntimeMessageSource(source, getContentWindow())) return reject();

    const message = parseRuntimeMessage(data);
    if (message === null) return reject();

    if (message.type === "buildora:ready") {
      if (state === "unresponsive") return recover();
      if (state === "recovering") {
        // Second validated message confirms the recovery.
        setState("ready");
        heartbeat.markAlive();
        return true;
      }
      if (state === "mounting") {
        setState("ready");
        heartbeat.markAlive();
        onReady();
        return true;
      }
      // Already ready: a re-anchoring ready (self-reload) — keep liveness.
      heartbeat.markAlive();
      return true;
    }

    // height / error — only a frame that has anchored may send them. While
    // mounting, non-ready messages are stale/foreign and are fenced out.
    if (state === "mounting") return reject();
    if (state === "unresponsive") {
      const recovered = recover();
      if (!recovered) return false;
    } else if (state === "recovering") {
      setState("ready");
    }
    heartbeat.markAlive();
    if (message.type === "buildora:height") {
      onHeight(message.height);
    } else {
      onError(message.error);
    }
    return true;
  };

  return {
    get instanceId() {
      return instanceId;
    },
    get state() {
      return state;
    },
    mount() {
      if (state !== "idle") return; // idempotent; disposed is terminal
      setState("mounting");
      heartbeat.start();
    },
    handleMessage,
    markAlive() {
      if (state === "disposed") return;
      heartbeat.markAlive();
    },
    dispose() {
      if (state === "disposed") return; // idempotent
      heartbeat.dispose();
      setState("disposed");
    },
  };
}
