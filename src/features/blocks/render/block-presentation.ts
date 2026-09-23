// ---------------------------------------------------------------------------
// Block presentation (Phase P22-C) — geometry + viewport overrides on render
//
// BlockRenderer renders custom-block trees, whose nodes may carry the additive
// P22-A/P22-B/P22-C element metadata:
//   - `geometry`   (width/height/rotation/zIndex/absolute x/y) — written by
//                   the canvas manipulation layer and the universal inspector
//   - `viewport`   (tablet/mobile style overrides) — written by the
//                   universal inspector's responsive section
//
// This helper folds BOTH into the rendered CSS so the canvas, thumbnails, and
// export preview agree with what the inspector shows. Both surfaces are
// optional — nodes without them render exactly as before (additive change).
//
// Stage 4 — Wix-style mobile auto-stack: at mobile widths the presentation
// also folds automatic responsive rules (vertical stacking of horizontal
// siblings, image/media max-width clamps, multi-column grid collapse) UNLESS
// the element carries an explicit user override for the same property at the
// active breakpoint (user intent always wins over the auto behavior).
//
// Pure, deterministic. Unsafe values are dropped by the style-token converter.
// ---------------------------------------------------------------------------

import { viewportOverridesForWidth, hasViewportOverride } from "@/features/elements/responsive/resolve";
import { MOBILE_MAX_WIDTH } from "@/features/elements/responsive/types";
import type { ElementViewportKey } from "@/features/elements/responsive/types";
import type {
  ElementGeometry,
  ElementViewportStyles,
} from "@/features/elements/types";
import type { BlockNode } from "../types";
import { styleTokensToCss, type CssStyle } from "./block-style-to-css";

/** Block types whose horizontal sibling flow auto-stacks on mobile. */
const AUTO_STACK_TYPES = new Set(["row", "container", "stack"]);

/**
 * Stage 4 — mobile auto-stack rules for one node at one width.
 *
 *   - Horizontal flow containers (row/container/stack) stack into a column.
 *   - Grids collapse: 3+ columns → 2, 2 columns stay 2, anything else → 1.
 *   - Media and wide content clamp to max-width 100% (no horizontal scroll).
 *
 * Only emitted at mobile widths (≤ MOBILE_MAX_WIDTH) and only for properties
 * the user has NOT explicitly overridden at the active breakpoint.
 */
export function mobileAutoStackCss(
  node: BlockNode,
  width: number,
  viewport: ElementViewportStyles | undefined,
): CssStyle {
  if (width > MOBILE_MAX_WIDTH) return {};

  const key: ElementViewportKey = "mobile";
  const overridden = (property: string): boolean => {
    const record = viewport?.[key] as Record<string, unknown> | undefined;
    return record ? Object.prototype.hasOwnProperty.call(record, property) : false;
  };

  const css: CssStyle = {};

  // 1. Auto-stack horizontal siblings into a vertical flow.
  if (
    AUTO_STACK_TYPES.has(node.type) &&
    !overridden("flexDirection")
  ) {
    const baseFlexDirection = (node.style as Record<string, unknown> | undefined)?.flexDirection;
    const baseIsColumn =
      baseFlexDirection === "column" || baseFlexDirection === "column-reverse";
    if (!baseIsColumn) {
      css.flexDirection = "column";
    }
  }

  // 2. Grids collapse into mobile-friendly column counts.
  if (node.type === "grid" && !overridden("gridTemplateColumns")) {
    const columns =
      typeof node.props?.columns === "number" && node.props.columns >= 1
        ? Math.floor(node.props.columns)
        : null;
    if (columns !== null && columns >= 3) {
      css.gridTemplateColumns = `repeat(2, minmax(0, 1fr))`;
    } else if (columns !== null && columns === 2) {
      css.gridTemplateColumns = `repeat(2, minmax(0, 1fr))`;
    } else {
      css.gridTemplateColumns = `repeat(1, minmax(0, 1fr))`;
    }
  }

  // 3. Media and content blocks clamp so nothing can overflow the artboard.
  if (node.type === "image" || node.type === "video") {
    if (!overridden("maxWidth")) css.maxWidth = "100%";
  }
  if (
    node.type === "heading" ||
    node.type === "paragraph" ||
    node.type === "button" ||
    node.type === "card" ||
    node.type === "pricing-card" ||
    node.type === "feature-card" ||
    node.type === "review-card"
  ) {
    if (!overridden("maxWidth")) css.maxWidth = "100%";
  }

  return css;
}

/** Fold a node's geometry + viewport overrides (+ mobile auto-stack) into CSS. */
export function applyBlockPresentation(
  node: BlockNode,
  width: number,
  css: CssStyle,
): CssStyle {
  const out: CssStyle = { ...css };

  const viewport = (node as BlockNode & { viewport?: ElementViewportStyles }).viewport;
  const viewportOverrides = styleTokensToCss(viewportOverridesForWidth(viewport, width));
  Object.assign(out, viewportOverrides);

  // Stage 4 — mobile auto-stack runs AFTER explicit overrides so an explicit
  // `display: none` (Hide on Mobile) still wins over every auto rule.
  Object.assign(out, mobileAutoStackCss(node, width, viewport));

  const geometry = (node as BlockNode & { geometry?: ElementGeometry }).geometry;
  if (geometry) {
    if (typeof geometry.width === "number" && Number.isFinite(geometry.width)) {
      out.width = geometry.width;
    }
    if (typeof geometry.height === "number" && Number.isFinite(geometry.height)) {
      out.height = geometry.height;
    }
    if (typeof geometry.zIndex === "number") {
      out.zIndex = geometry.zIndex;
    }
    if (typeof geometry.rotation === "number" && geometry.rotation !== 0) {
      out.transform = `rotate(${geometry.rotation}deg)`;
    }
    if (geometry.mode === "absolute") {
      // Mobile: absolute overlays rejoin the flow (stacked) instead of
      // overlapping a narrow artboard — unless the user pinned an override.
      out.position = "absolute";
      if (typeof geometry.x === "number" && Number.isFinite(geometry.x)) {
        out.left = geometry.x;
      }
      if (typeof geometry.y === "number" && Number.isFinite(geometry.y)) {
        out.top = geometry.y;
      }
    }
  }
  if (width <= MOBILE_MAX_WIDTH && geometry?.mode === "absolute") {
    // The stack/max-width rules above never re-flow an absolutely-positioned
    // node by themselves; normalize the anchor so mobile stays readable.
    out.position = "relative";
    delete out.left;
    delete out.top;
  }

  return out;
}

// Re-export for callers that still consult the raw predicate.
export { hasViewportOverride };
