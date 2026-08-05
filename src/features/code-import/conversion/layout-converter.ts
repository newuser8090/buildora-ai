// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — layout converter
//
// Turns the raw layout signals extracted by the style converter into the
// EXISTING layout vocabulary of the LEGO Builder Engine:
//   - candidate layout block type (row / column / grid / stack / container)
//   - layout props consumed by layout-descriptors (layoutDirection, gap,
//     alignItems, justifyContent, flexWrap, columns)
//
// Pure and deterministic. The node converter decides whether the candidate
// type survives nesting validation (downgrade to container when it cannot).
// ---------------------------------------------------------------------------

import type { BlockType } from "../../blocks/types";
import type { LayoutSignals } from "./style-converter";

export type LayoutDirectionIntent = "row" | "column" | "grid" | "none";

export interface LayoutIntent {
  direction: LayoutDirectionIntent;
  columns?: number;
  gap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  wrap?: boolean;
}

export const DEFAULT_LAYOUT_GAP = 16;

// ---------------------------------------------------------------------------
// Signal normalisation (existing engine vocabulary)
// ---------------------------------------------------------------------------

function normalizeAlign(value: string | undefined): LayoutIntent["align"] {
  switch (value) {
    case "flex-start":
    case "start":
      return "start";
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "stretch":
      return "stretch";
    default:
      return undefined;
  }
}

function normalizeJustify(value: string | undefined): LayoutIntent["justify"] {
  switch (value) {
    case "flex-start":
    case "start":
      return "start";
    case "center":
      return "center";
    case "flex-end":
    case "end":
      return "end";
    case "space-between":
      return "space-between";
    case "space-around":
      return "space-around";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

/** Detect the layout intent of an element from its converted style signals. */
export function layoutIntentFromSignals(signals: LayoutSignals): LayoutIntent {
  const display = signals.display;

  if (display === "grid" || signals.columns !== undefined) {
    return {
      direction: "grid",
      columns: signals.columns,
      gap: signals.gap ?? DEFAULT_LAYOUT_GAP,
      align: normalizeAlign(signals.alignItems),
      justify: normalizeJustify(signals.justifyContent),
      wrap: signals.flexWrap,
    };
  }

  if (display === "flex") {
    const direction = signals.flexDirection === "column" ? "column" : "row";
    return {
      direction,
      gap: signals.gap ?? DEFAULT_LAYOUT_GAP,
      align: normalizeAlign(signals.alignItems),
      justify: normalizeJustify(signals.justifyContent),
      wrap: signals.flexWrap,
    };
  }

  return { direction: "none" };
}

// ---------------------------------------------------------------------------
// Candidate block type
// ---------------------------------------------------------------------------

/**
 * The layout block type that best represents an intent. `stack` is preferred
 * for column intents when the element reads like a stacked list (space-y-*);
 * the caller passes `preferStack` (e.g. for ul/ol and space-y-* elements).
 */
export function layoutBlockTypeForIntent(
  intent: LayoutIntent,
  preferStack = false,
): BlockType {
  switch (intent.direction) {
    case "grid":
      return "grid";
    case "row":
      return "row";
    case "column":
      return preferStack ? "stack" : "column";
    default:
      return "container";
  }
}

/** True when the intent produces a plain (non-flex/grid) container. */
export function isPlainContainerIntent(intent: LayoutIntent): boolean {
  return intent.direction === "none";
}

// ---------------------------------------------------------------------------
// Layout props (consumed by layout-descriptors)
// ---------------------------------------------------------------------------

/**
 * Build the layout props record for a block node. Only detected values are
 * written; layout-descriptor defaults fill the rest at render time.
 */
export function layoutPropsForIntent(intent: LayoutIntent): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (intent.direction === "none") return props;

  props.layoutDirection = intent.direction;
  if (intent.gap !== undefined) props.gap = intent.gap;
  if (intent.align !== undefined) props.alignItems = intent.align;
  if (intent.justify !== undefined) props.justifyContent = intent.justify;
  if (intent.wrap !== undefined) props.flexWrap = intent.wrap;
  if (intent.direction === "grid" && intent.columns !== undefined) {
    props.columns = intent.columns;
  }
  return props;
}

/** True when a block node carries layout props (a layout block). */
export function hasLayoutProps(props: Record<string, unknown>): boolean {
  return typeof props.layoutDirection === "string";
}
