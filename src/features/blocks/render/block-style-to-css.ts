// ---------------------------------------------------------------------------
// Block style → CSS (Phase P3)
//
// Pure mapping from the Buildora style tokens stored on BlockNode.style /
// BlockNode.responsive into CSS property values. Used by BOTH the canvas
// BlockRenderer and the generated-site exporter so preview and export render
// imported blocks identically.
//
// Tokens are camelCase CSS property names produced by the Phase P2 style
// converter. Special tokens (shadowDepth) are resolved to theme variables.
// Unsafe CSS values are dropped — never executed, never emitted.
// ---------------------------------------------------------------------------

export type CssStyle = Record<string, string | number>;

/** Breakpoint → min-width px (Tailwind-compatible). */
export const RESPONSIVE_BREAKPOINTS: ReadonlyArray<[string, number]> = [
  ["sm", 640],
  ["md", 768],
  ["lg", 1024],
  ["xl", 1280],
  ["2xl", 1536],
] as const;

const SHADOW_TOKENS: Record<string, string> = {
  small: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))",
  medium: "var(--shadow-md, 0 4px 6px rgba(0,0,0,0.07))",
  large: "var(--shadow-lg, 0 10px 15px rgba(0,0,0,0.1))",
  none: "none",
};

function isSafeCssValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    !lower.includes("javascript:") &&
    !lower.includes("vbscript:") &&
    !lower.includes("expression(") &&
    !lower.includes("behavior:") &&
    !lower.includes("binding:")
  );
}

/**
 * Convert a style-token record into CSS property values.
 * Deterministic; unsafe values are dropped.
 */
export function styleTokensToCss(style: Record<string, unknown>): CssStyle {
  const out: CssStyle = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || value === null) continue;
    if (key === "shadowDepth") {
      if (typeof value === "string" && value in SHADOW_TOKENS) {
        out.boxShadow = SHADOW_TOKENS[value];
      }
      continue;
    }
    if (typeof value === "string") {
      if (!isSafeCssValue(value)) continue;
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve responsive overrides for a given viewport width: every breakpoint
 * whose min-width is <= viewportWidth is applied, later breakpoints win.
 */
export function resolveResponsiveCss(
  responsive: Record<string, Record<string, unknown>>,
  viewportWidth: number,
): CssStyle {
  const merged: Record<string, unknown> = {};
  for (const [breakpoint, minWidth] of RESPONSIVE_BREAKPOINTS) {
    if (minWidth > viewportWidth) continue;
    const overrides = responsive[breakpoint];
    if (!overrides) continue;
    Object.assign(merged, overrides);
  }
  return styleTokensToCss(merged);
}

/** Full inline style for a block node at a given viewport width. */
export function blockCss(
  style: Record<string, unknown>,
  responsive: Record<string, Record<string, unknown>>,
  viewportWidth: number,
): CssStyle {
  const base = styleTokensToCss(style);
  return { ...base, ...resolveResponsiveCss(responsive, viewportWidth) };
}

/** Emit a CSS media query for one breakpoint (used by the exporter). */
export function mediaQueryForBreakpoint(breakpoint: string): string | null {
  const entry = RESPONSIVE_BREAKPOINTS.find(([name]) => name === breakpoint);
  if (!entry) return null;
  return `@media (min-width: ${entry[1]}px)`;
}
