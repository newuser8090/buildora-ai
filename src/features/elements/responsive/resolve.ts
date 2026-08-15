// ---------------------------------------------------------------------------
// Responsive resolution (Phase P22-A)
//
// Top-down (max-width) inheritance for the Canva-first viewport model:
//   base style (desktop default) ← always
//   tablet overrides             ← width ≤ TABLET_MAX_WIDTH
//   mobile overrides             ← width ≤ MOBILE_MAX_WIDTH (wins over tablet)
//
// Precedence for one element's effective CSS:
//   base style < Phase O block responsive (min-width tokens) < viewport overrides
//
// The Phase O block `responsive` field (Tailwind min-width tokens) is kept for
// block/import compatibility; viewport overrides (Canva-first) win because they
// are authored at the element level.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import {
  resolveResponsiveCss,
  styleTokensToCss,
  type CssStyle,
} from "@/features/blocks/render/block-style-to-css";
import type { ElementNode, ElementStyleTokens } from "../types";
import {
  MOBILE_MAX_WIDTH,
  TABLET_MAX_WIDTH,
  type ElementViewportStyles,
  type ResponsiveDecision,
} from "./types";

/** Merge style-token records (later records win; nullish values skipped). */
export function mergeStyleTokens(
  ...records: Array<Record<string, unknown> | undefined>
): ElementStyleTokens {
  const out: Record<string, unknown> = {};
  for (const record of records) {
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined || value === null) continue;
      out[key] = value;
    }
  }
  return out as ElementStyleTokens;
}

/** The viewport overrides that apply at a given width (top-down inheritance). */
export function viewportOverridesForWidth(
  viewport: ElementViewportStyles | undefined,
  width: number,
): ElementStyleTokens {
  if (!viewport) return {};
  const merged: Record<string, unknown> = {};
  if (width <= TABLET_MAX_WIDTH && viewport.tablet) {
    Object.assign(merged, viewport.tablet);
  }
  if (width <= MOBILE_MAX_WIDTH && viewport.mobile) {
    Object.assign(merged, viewport.mobile);
  }
  return merged as ElementStyleTokens;
}

/** True when a viewport override exists for the given key. */
export function hasViewportOverride(
  viewport: ElementViewportStyles | undefined,
  key: "tablet" | "mobile",
): boolean {
  return !!viewport?.[key] && Object.keys(viewport[key] ?? {}).length > 0;
}

/**
 * Resolve an element's effective CSS for a given viewport width.
 * Shared by the future ElementRenderer (editor, preview, export).
 */
export function resolveElementStyle(
  node: Pick<ElementNode, "style" | "responsive" | "viewport">,
  width: number,
): CssStyle {
  const base = styleTokensToCss(node.style ?? {});
  const blockResponsive = resolveResponsiveCss(node.responsive ?? {}, width);
  const viewportOverrides = styleTokensToCss(
    viewportOverridesForWidth(node.viewport, width),
  );
  return { ...base, ...blockResponsive, ...viewportOverrides };
}

/**
 * Order responsive decisions so USER decisions always take precedence over
 * AI suggestions. Within a group, the original order is preserved (stable).
 */
export function effectiveResponsiveDecisions(
  decisions: ResponsiveDecision[],
): ResponsiveDecision[] {
  return [
    ...decisions.filter((d) => d.appliedBy === "user"),
    ...decisions.filter((d) => d.appliedBy === "ai"),
  ];
}
