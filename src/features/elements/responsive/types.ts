// ---------------------------------------------------------------------------
// Responsive foundation (Phase P22-A) — Canva-first viewport model
//
// Design goals (from the phase brief):
//   1. Desktop/default values live in the element's base `style`.
//   2. Tablet/mobile override ONLY what differs.
//   3. Missing overrides inherit intelligently (top-down inheritance).
//   4. User overrides always take precedence over AI suggestions.
//   5. The model supports automatic responsive decisions later (P22-F).
//
// Inheritance model (top-down / max-width):
//   base (desktop default)                     → always applies
//   tablet overrides (width ≤ TABLET_MAX_WIDTH) → applied when in range
//   mobile overrides (width ≤ MOBILE_MAX_WIDTH) → applied when in range
//
// The existing Phase O `responsive` field (Tailwind min-width tokens) remains
// intact for block/import compatibility; the resolution helper merges both.
//
// Pure model: no React, no DOM.
// ---------------------------------------------------------------------------

import type { ElementStyleTokens } from "../types";

/** Canva-first viewport keys. Base values live in `node.style`. */
export type ElementViewportKey = "tablet" | "mobile";

export const ELEMENT_VIEWPORT_KEYS: readonly ElementViewportKey[] = ["tablet", "mobile"];

/** Breakpoint thresholds (px, max-width semantics). */
export const TABLET_MAX_WIDTH = 1024;
export const MOBILE_MAX_WIDTH = 768;

/** The viewport key that applies at a given width, or null for desktop. */
export function viewportKeyForWidth(width: number): ElementViewportKey | null {
  if (width <= MOBILE_MAX_WIDTH) return "mobile";
  if (width <= TABLET_MAX_WIDTH) return "tablet";
  return null;
}

/** Viewport-keyed style overrides. Base (desktop) values live in `style`. */
export interface ElementViewportStyles {
  tablet?: ElementStyleTokens;
  mobile?: ElementStyleTokens;
}

/**
 * The validated transformation vocabulary (Phase P22-F).
 *
 * Every transformation maps to an EXISTING style token the canvas/thumbnail/
 * export renderers already consume — no arbitrary strings enter the model
 * (the schema boundary rejects anything outside this allow-list).
 */
export const RESPONSIVE_TRANSFORMATIONS = [
  /** Grid → 2 columns at the viewport (writes gridTemplateColumns). */
  "grid-columns-2",
  /** Grid → 1 column at the viewport (writes gridTemplateColumns). */
  "grid-columns-1",
  /** Horizontal row/container → stacked column (writes flexDirection). */
  "stack",
  /** Large heading/text → smaller font (writes fontSize = 0.75 × base). */
  "font-size-smaller",
] as const;

export type ResponsiveTransformation = (typeof RESPONSIVE_TRANSFORMATIONS)[number];

/**
 * A persisted responsive decision — the unit of the responsive engine.
 *
 * User decisions (`appliedBy: "user"`) always outrank AI decisions; the
 * helper `effectiveResponsiveDecisions` (responsive/resolve.ts) enforces
 * that ordering. `state: "rejected"` records a proposal the user dismissed
 * so the engine never re-suggests it (user override wins, persisted).
 */
export interface ResponsiveDecision {
  elementId: string;
  /** The viewport this decision targets. */
  viewport: ElementViewportKey;
  /** The validated transformation that was applied or rejected. */
  transformation: ResponsiveTransformation;
  appliedBy: "ai" | "user";
  /** Applied = the override is on the element; rejected = user dismissed it. */
  state: "applied" | "rejected";
  /** Optional user-facing explanation (never persisted raw model data). */
  note?: string;
}
