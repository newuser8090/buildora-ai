// ---------------------------------------------------------------------------
// Animation foundation (Phase P22-A) — declarative, data-only
//
// P22-A establishes the safe extensible schema only. No animation rendering,
// no animation editor UI (P22-G).
//
// Pure model: no React, no DOM.
// ---------------------------------------------------------------------------

export type AnimationTrigger = "load" | "hover" | "click" | "scroll" | "viewport";

export type AnimationType =
  | "fade"
  | "slide"
  | "scale"
  | "bounce"
  | "reveal"
  | "blur"
  | "rotate"
  | "custom";

export type AnimationDirection = "normal" | "reverse" | "alternate";

export interface ElementAnimation {
  trigger: AnimationTrigger;
  type: AnimationType;
  /** ms. Defaults to the renderer's per-type default when omitted. */
  durationMs?: number;
  delayMs?: number;
  /** CSS easing keyword or a bounded cubic-bezier string (validated). */
  easing?: string;
  repeat?: "none" | "infinite" | number;
  direction?: AnimationDirection;
}
