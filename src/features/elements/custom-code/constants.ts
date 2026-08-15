// ---------------------------------------------------------------------------
// Custom-code runtime constants (Phase P23-B) — ONE central place
//
// Every security-sensitive value used by the sandboxed runtime shell lives
// here (or is re-exported from the element schema caps so there is a single
// source of truth). Nothing in this module touches the DOM, timers, or any
// framework — it is pure data.
//
// P23-B is the runtime FOUNDATION only: these constants are not wired into
// any renderer, export generator, or editor surface yet.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Payload caps — re-exported from the element schema (single source of truth)
// ---------------------------------------------------------------------------

export {
  ELEMENT_MAX_ATTRIBUTES as MAX_CUSTOM_CODE_ATTRIBUTES,
  ELEMENT_MAX_CUSTOM_CODE_LENGTH as MAX_CUSTOM_CODE_LENGTH,
  ELEMENT_MAX_CUSTOM_CODE_TOTAL as MAX_CUSTOM_CODE_TOTAL,
} from "../schemas/element-schemas";

// ---------------------------------------------------------------------------
// Sandbox document CSP (approved P23 architecture)
//
// Deliberate, not a wildcard: JS/CSS must be inline (srcdoc has no files);
// images/fonts may load from https: or data:; NETWORK is blocked by default
// (connect-src 'none'). frame-ancestors 'none' prevents the sandbox document
// from being framed elsewhere. No 'unsafe-eval' — the user's code is inline
// in the same document and needs no eval.
// ---------------------------------------------------------------------------

export const SANDBOX_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
  "img-src data: https:; font-src data: https:; connect-src 'none'; " +
  "frame-ancestors 'none'; form-action 'none'; base-uri 'none'";

// ---------------------------------------------------------------------------
// Parent/child message protocol (minimal by design)
// ---------------------------------------------------------------------------

export const RUNTIME_MESSAGE_TYPES = {
  ready: "buildora:ready",
  height: "buildora:height",
} as const;

/** Hard cap on frame height reports (layout-bomb guard). */
export const MAX_FRAME_HEIGHT_PX = 10_000;

// ---------------------------------------------------------------------------
// Heartbeat defaults (bounded, low frequency)
// ---------------------------------------------------------------------------

export const HEARTBEAT_DEFAULTS = {
  /** How often the parent checks liveness. */
  intervalMs: 3_000,
  /** Max silence before a check counts as a miss (must be < intervalMs). */
  timeoutMs: 2_000,
  /** Consecutive misses before the frame is declared unresponsive. */
  maxMisses: 2,
} as const;
