// ---------------------------------------------------------------------------
// Runtime message protocol (Phase P23-B) — minimal parent/child channel
//
// The sandboxed frame may send EXACTLY two message types to the parent:
//   - buildora:ready   — the frame document finished loading
//   - buildora:height  — the frame's content height (for sizing)
//
// Security rules (enforced here so the parent only ever accepts validated
// input):
//   - unknown message types are rejected
//   - extra fields are rejected — no project data, credentials, tokens,
//     workspace data, or code may cross the boundary (an allow-listed shape
//     is the boundary)
//   - height must be a finite number; it is normalized (rounded to an
//     integer) and clamped to [0, MAX_FRAME_HEIGHT_PX] (negative → 0,
//     oversized → the cap)
//   - the parent must independently verify `event.source` is the iframe's
//     contentWindow (isRuntimeMessageSource) before accepting anything
//
// Pure, deterministic, framework-independent (no DOM access).
// ---------------------------------------------------------------------------

import { MAX_FRAME_HEIGHT_PX, RUNTIME_MESSAGE_TYPES } from "./constants";

export interface BuildoraReadyMessage {
  type: typeof RUNTIME_MESSAGE_TYPES.ready;
}

export interface BuildoraHeightMessage {
  type: typeof RUNTIME_MESSAGE_TYPES.height;
  height: number;
}

export type BuildoraRuntimeMessage = BuildoraReadyMessage | BuildoraHeightMessage;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parent-side source check: a message is accepted only when the event's
 * `source` is exactly the iframe's `contentWindow`. Anything else (another
 * frame, a window, null) is rejected.
 */
export function isRuntimeMessageSource(
  source: unknown,
  contentWindow: unknown,
): boolean {
  return source !== null && source !== undefined && source === contentWindow;
}

/** Normalize a finite height to [0, MAX_FRAME_HEIGHT_PX], rounded to an int. */
export function clampFrameHeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, 0), MAX_FRAME_HEIGHT_PX);
}

/**
 * Parse + validate a raw message payload. Returns the typed, normalized
 * message, or `null` for anything malformed/unknown/oversized in shape.
 */
export function parseRuntimeMessage(data: unknown): BuildoraRuntimeMessage | null {
  if (!isPlainObject(data)) return null;
  const keys = Object.keys(data);

  if (data.type === RUNTIME_MESSAGE_TYPES.ready) {
    // Exactly { type } — any extra field is rejected (no data may cross).
    if (keys.length !== 1) return null;
    return { type: RUNTIME_MESSAGE_TYPES.ready };
  }

  if (data.type === RUNTIME_MESSAGE_TYPES.height) {
    // Exactly { type, height } — no extra fields.
    if (keys.length !== 2) return null;
    const height = (data as Record<string, unknown>).height;
    if (typeof height !== "number" || !Number.isFinite(height)) return null;
    return { type: RUNTIME_MESSAGE_TYPES.height, height: clampFrameHeight(height) };
  }

  return null;
}
