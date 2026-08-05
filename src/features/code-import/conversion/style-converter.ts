// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — style converter
//
// Converts Tailwind utility classes, inline styles and CSS class references
// into the EXISTING Buildora style tokens consumed by the block engine:
//   - style tokens    → BlockNode.style        (camelCase CSS-property values)
//   - responsive      → BlockNode.responsive   (breakpoint → style overrides)
//   - layout signals  → consumed by layout-converter to pick layout blocks
//
// Deterministic and pure. Never generates CSS and never executes anything.
// Unknown classes are returned as "referenced classes" so the orchestrator can
// warn about external CSS that is not applied (imported CSS is analysed, not
// executed — same security posture as Phase P1).
// ---------------------------------------------------------------------------

import type { ConversionContext } from "./conversion-report";

// ---------------------------------------------------------------------------
// Layout signals — raw layout hints extracted while converting styles. The
// layout-converter turns these into layout block types + layout props.
// ---------------------------------------------------------------------------

export interface LayoutSignals {
  display?: string;
  flexDirection?: string;
  columns?: number;
  gridTemplateColumns?: string;
  gap?: number;
  alignItems?: string;
  justifyContent?: string;
  flexWrap?: boolean;
}

export interface ConvertedElementStyles {
  /** CamelCase style tokens (BlockNode.style). */
  style: Record<string, unknown>;
  /** Breakpoint → style overrides (BlockNode.responsive). */
  responsive: Record<string, Record<string, unknown>>;
  /** Raw layout hints for layout-converter. */
  signals: LayoutSignals;
  /** Class tokens that are not known utilities (external CSS references). */
  referencedClasses: string[];
  /** Number of class tokens that were converted. */
  convertedClassCount: number;
  /** True when any converted token is a Tailwind utility. */
  tailwindDetected: boolean;
}

// ---------------------------------------------------------------------------
// Spacing scale (Tailwind default, rem values)
// ---------------------------------------------------------------------------

const SPACING_REM: Record<string, string> = {
  "0": "0px",
  px: "1px",
  "0.5": "0.125rem",
  "1": "0.25rem",
  "1.5": "0.375rem",
  "2": "0.5rem",
  "2.5": "0.625rem",
  "3": "0.75rem",
  "3.5": "0.875rem",
  "4": "1rem",
  "5": "1.25rem",
  "6": "1.5rem",
  "7": "1.75rem",
  "8": "2rem",
  "9": "2.25rem",
  "10": "2.5rem",
  "11": "2.75rem",
  "12": "3rem",
  "14": "3.5rem",
  "16": "4rem",
  "20": "5rem",
  "24": "6rem",
  "28": "7rem",
  "32": "8rem",
  "36": "9rem",
  "40": "10rem",
  "44": "11rem",
  "48": "12rem",
  "52": "13rem",
  "56": "14rem",
  "60": "15rem",
  "64": "16rem",
  "72": "18rem",
  "80": "20rem",
  "96": "24rem",
};

/** Convert a Tailwind spacing token to px for layout gap signals. */
function spacingToPx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem) return Math.round(parseFloat(rem[1]) * 16);
  const px = /^([\d.]+)px$/.exec(value);
  if (px) return Math.round(parseFloat(px[1]));
  return undefined;
}

function spacingStyle(token: string): string | undefined {
  return SPACING_REM[token];
}

// ---------------------------------------------------------------------------
// Font sizes / weights / leading / tracking
// ---------------------------------------------------------------------------

const FONT_SIZE_STYLES: Record<string, { fontSize: string; lineHeight: string }> = {
  xs: { fontSize: "0.75rem", lineHeight: "1rem" },
  sm: { fontSize: "0.875rem", lineHeight: "1.25rem" },
  base: { fontSize: "1rem", lineHeight: "1.5rem" },
  lg: { fontSize: "1.125rem", lineHeight: "1.75rem" },
  xl: { fontSize: "1.25rem", lineHeight: "1.75rem" },
  "2xl": { fontSize: "1.5rem", lineHeight: "2rem" },
  "3xl": { fontSize: "1.875rem", lineHeight: "2.25rem" },
  "4xl": { fontSize: "2.25rem", lineHeight: "2.5rem" },
  "5xl": { fontSize: "3rem", lineHeight: "1" },
  "6xl": { fontSize: "3.75rem", lineHeight: "1" },
  "7xl": { fontSize: "4.5rem", lineHeight: "1" },
  "8xl": { fontSize: "6rem", lineHeight: "1" },
  "9xl": { fontSize: "8rem", lineHeight: "1" },
};

const FONT_WEIGHTS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
};

const LINE_HEIGHTS: Record<string, string> = {
  none: "1",
  tight: "1.25",
  snug: "1.375",
  normal: "1.5",
  relaxed: "1.625",
  loose: "2",
};

const LETTER_SPACING: Record<string, string> = {
  tighter: "-0.05em",
  tight: "-0.025em",
  normal: "0em",
  wide: "0.025em",
  wider: "0.05em",
  widest: "0.1em",
};

// ---------------------------------------------------------------------------
// Colors — curated Tailwind palette mapped to hex values
// ---------------------------------------------------------------------------

type HueShades = Record<string, string>;

function hue(
  name: string,
  shades: [string, string, string, string, string, string, string, string, string, string],
): HueShades {
  const names = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
  const result: HueShades = {};
  names.forEach((shade, i) => {
    result[`${name}-${shade}`] = shades[i];
  });
  return result;
}

const PALETTE: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  transparent: "transparent",
  current: "currentColor",
  ...hue("slate", ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#334155", "#1e293b", "#0f172a"]),
  ...hue("gray", ["#f9fafb", "#f3f4f6", "#e5e7eb", "#d1d5db", "#9ca3af", "#6b7280", "#4b5563", "#374151", "#1f2937", "#111827"]),
  ...hue("red", ["#fef2f2", "#fee2e2", "#fecaca", "#fca5a5", "#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d"]),
  ...hue("orange", ["#fff7ed", "#ffedd5", "#fed7aa", "#fdba74", "#fb923c", "#f97316", "#ea580c", "#c2410c", "#9a3412", "#7c2d12"]),
  ...hue("amber", ["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d", "#fbbf24", "#f59e0b", "#d97706", "#b45309", "#92400e", "#78350f"]),
  ...hue("green", ["#f0fdf4", "#dcfce7", "#bbf7d0", "#86efac", "#4ade80", "#22c55e", "#16a34a", "#15803d", "#166534", "#14532d"]),
  ...hue("blue", ["#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a"]),
  ...hue("indigo", ["#eef2ff", "#e0e7ff", "#c7d2fe", "#a5b4fc", "#818cf8", "#6366f1", "#4f46e5", "#4338ca", "#3730a3", "#312e81"]),
  // Spot shades for remaining hues
  "yellow-400": "#facc15", "yellow-500": "#eab308", "yellow-600": "#ca8a04", "yellow-700": "#a16207",
  "lime-400": "#a3e635", "lime-500": "#84cc16", "lime-600": "#65a30d",
  "emerald-400": "#34d399", "emerald-500": "#10b981", "emerald-600": "#059669",
  "teal-400": "#2dd4bf", "teal-500": "#14b8a6", "teal-600": "#0d9488",
  "cyan-400": "#22d3ee", "cyan-500": "#06b6d4", "cyan-600": "#0891b2",
  "sky-400": "#38bdf8", "sky-500": "#0ea5e9", "sky-600": "#0284c7",
  "violet-400": "#a78bfa", "violet-500": "#8b5cf6", "violet-600": "#7c3aed",
  "purple-400": "#c084fc", "purple-500": "#a855f7", "purple-600": "#9333ea",
  "fuchsia-400": "#e879f9", "fuchsia-500": "#d946ef", "fuchsia-600": "#c026d3",
  "pink-400": "#f472b6", "pink-500": "#ec4899", "pink-600": "#db2777",
  "rose-400": "#fb7185", "rose-500": "#f43f5e", "rose-600": "#e11d48",
  "stone-500": "#78716c", "zinc-500": "#71717a", "neutral-500": "#737373",
};

// Color names are stored with shade suffixes flattened into PALETTE, so
// "blue-500" resolves directly and "blue" falls back to the palette base.
function resolveShadedColor(token: string): string | undefined {
  const direct = PALETTE[token];
  if (direct) return direct;
  const match = /^([a-z]+)-(\d{2,3})$/.exec(token);
  if (!match) return undefined;
  const base = match[1];
  // Shades for the core hues are flattened into PALETTE (e.g. "slate-500").
  const key = `${base}-${match[2]}`;
  return PALETTE[key] ?? undefined;
}

// ---------------------------------------------------------------------------
// Radius / shadow / border tokens
// ---------------------------------------------------------------------------

const RADIUS_STYLES: Record<string, string> = {
  none: "0",
  sm: "0.125rem",
  DEFAULT: "0.25rem",
  md: "0.375rem",
  lg: "0.5rem",
  xl: "0.75rem",
  "2xl": "1rem",
  "3xl": "1.5rem",
  full: "9999px",
};

const SHADOW_DEPTH: Record<string, string> = {
  sm: "small",
  DEFAULT: "medium",
  md: "medium",
  lg: "large",
  xl: "large",
  "2xl": "large",
  inner: "small",
  none: "none",
};

// ---------------------------------------------------------------------------
// Display / position / overflow maps
// ---------------------------------------------------------------------------

const DISPLAY_MAP: Record<string, string> = {
  block: "block",
  "inline-block": "inline-block",
  inline: "inline",
  flex: "flex",
  "inline-flex": "inline-flex",
  grid: "grid",
  "inline-grid": "inline-grid",
  contents: "contents",
  hidden: "none",
};

const POSITION_MAP: Record<string, string> = {
  static: "static",
  relative: "relative",
  absolute: "absolute",
  fixed: "fixed",
  sticky: "sticky",
};

const OVERFLOW_MAP: Record<string, string> = {
  "overflow-visible": "visible",
  "overflow-hidden": "hidden",
  "overflow-clip": "clip",
  "overflow-scroll": "scroll",
  "overflow-auto": "auto",
};

// ---------------------------------------------------------------------------
// Dangerous value guard (mirrors P1 security posture)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Arbitrary value support: prefix-[value]
// ---------------------------------------------------------------------------

interface ArbitraryMapping {
  style: Record<string, unknown>;
  signals?: Partial<LayoutSignals>;
}

function arbitraryValueMapping(prefix: string, value: string): ArbitraryMapping | null {
  if (!isSafeCssValue(value)) return null;

  const sideMap: Record<string, string> = {
    p: "padding",
    pt: "paddingTop",
    pr: "paddingRight",
    pb: "paddingBottom",
    pl: "paddingLeft",
    m: "margin",
    mt: "marginTop",
    mr: "marginRight",
    mb: "marginBottom",
    ml: "marginLeft",
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
    inset: "inset",
    w: "width",
    h: "height",
    "min-w": "minWidth",
    "max-w": "maxWidth",
    "min-h": "minHeight",
    "max-h": "maxHeight",
    "gap-x": "columnGap",
    "gap-y": "rowGap",
    leading: "lineHeight",
    tracking: "letterSpacing",
    rounded: "borderRadius",
    opacity: "opacity",
    z: "zIndex",
    flex: "flex",
    font: "fontWeight",
    "grid-cols": "gridTemplateColumns",
  };

  if (prefix === "gap") {
    const style: Record<string, unknown> = { gap: value };
    const px = spacingToPx(value);
    return { style, signals: px !== undefined ? { gap: px } : undefined };
  }

  if (prefix === "bg") {
    return { style: { background: value } };
  }

  if (prefix === "text") {
    if (/^#|^rgb|^hsl|^[a-z]+$/i.test(value)) {
      return { style: { color: value } };
    }
    return { style: { fontSize: value } };
  }

  if (prefix === "border") {
    if (/^\d+(\.\d+)?(px|rem|em)?$/.test(value)) {
      return { style: { borderWidth: value } };
    }
    return { style: { borderColor: value } };
  }

  // Horizontal / vertical pairs expand into both sides.
  const pairMap: Record<string, [string, string]> = {
    px: ["paddingLeft", "paddingRight"],
    py: ["paddingTop", "paddingBottom"],
    mx: ["marginLeft", "marginRight"],
    my: ["marginTop", "marginBottom"],
  };
  const pair = pairMap[prefix];
  if (pair) {
    return { style: { [pair[0]]: value, [pair[1]]: value } };
  }

  const key = sideMap[prefix];
  if (key) {
    if (prefix === "opacity" || prefix === "z") {
      const numeric = parseFloat(value);
      if (Number.isFinite(numeric)) {
        return { style: { [key]: prefix === "opacity" ? numeric / 100 : numeric } };
      }
    }
    return { style: { [key]: value } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Core single-token converter
// ---------------------------------------------------------------------------

export type TailwindClassContribution =
  | {
      kind: "style";
      style: Record<string, unknown>;
      signals?: Partial<LayoutSignals>;
    }
  | {
      kind: "responsive";
      breakpoint: string;
      style: Record<string, unknown>;
      signals?: Partial<LayoutSignals>;
    }
  | null;

const RESPONSIVE_BREAKPOINTS: ReadonlyArray<[string, string]> = [
  ["sm:", "sm"],
  ["md:", "md"],
  ["lg:", "lg"],
  ["xl:", "xl"],
  ["2xl:", "2xl"],
];

/** True when a class token is a known Tailwind utility. */
export function isTailwindClass(token: string): boolean {
  return convertTailwindClass(token) !== null;
}

/**
 * Convert one Tailwind utility class into style tokens (+ optional layout
 * signals). Unknown classes and arbitrary values with unsafe CSS return null
 * so callers can treat them as external CSS references.
 */
export function convertTailwindClass(token: string): TailwindClassContribution {
  let candidate = token;
  if (candidate.startsWith("!")) candidate = candidate.slice(1); // !important

  // Responsive variant routing.
  for (const [prefix, breakpoint] of RESPONSIVE_BREAKPOINTS) {
    if (candidate.startsWith(prefix)) {
      const inner = convertTailwindClass(candidate.slice(prefix.length));
      if (!inner || inner.kind === "responsive") return null;
      return {
        kind: "responsive",
        breakpoint,
        style: inner.style,
        signals: inner.signals,
      };
    }
  }

  // Arbitrary values.
  const arbitrary = /^([a-z][\w-]*)-\[(.+)\]$/.exec(candidate);
  if (arbitrary) {
    const mapping = arbitraryValueMapping(arbitrary[1], arbitrary[2]);
    if (!mapping) return null;
    return { kind: "style", style: mapping.style, signals: mapping.signals };
  }

  // ---- Display / position / overflow ----
  if (candidate in DISPLAY_MAP) {
    return { kind: "style", style: { display: DISPLAY_MAP[candidate] }, signals: { display: DISPLAY_MAP[candidate] } };
  }
  if (candidate in POSITION_MAP) {
    return { kind: "style", style: { position: POSITION_MAP[candidate] } };
  }
  if (candidate in OVERFLOW_MAP) {
    return { kind: "style", style: { overflow: OVERFLOW_MAP[candidate] } };
  }
  if (candidate.startsWith("overflow-x-")) {
    return { kind: "style", style: { overflowX: candidate.slice("overflow-x-".length) } };
  }
  if (candidate.startsWith("overflow-y-")) {
    return { kind: "style", style: { overflowY: candidate.slice("overflow-y-".length) } };
  }

  // ---- Flex ----
  if (candidate === "flex-row") {
    return { kind: "style", style: { flexDirection: "row" }, signals: { flexDirection: "row" } };
  }
  if (candidate === "flex-col") {
    return { kind: "style", style: { flexDirection: "column" }, signals: { flexDirection: "column" } };
  }
  if (candidate === "flex-row-reverse") {
    return { kind: "style", style: { flexDirection: "row-reverse" }, signals: { flexDirection: "row-reverse" } };
  }
  if (candidate === "flex-col-reverse") {
    return { kind: "style", style: { flexDirection: "column-reverse" }, signals: { flexDirection: "column-reverse" } };
  }
  if (candidate === "flex-wrap") {
    return { kind: "style", style: { flexWrap: "wrap" }, signals: { flexWrap: true } };
  }
  if (candidate === "flex-nowrap") {
    return { kind: "style", style: { flexWrap: "nowrap" }, signals: { flexWrap: false } };
  }
  if (candidate === "flex-1") return { kind: "style", style: { flex: "1 1 0%" } };
  if (candidate === "flex-auto") return { kind: "style", style: { flex: "1 1 auto" } };
  if (candidate === "flex-initial") return { kind: "style", style: { flex: "0 1 auto" } };
  if (candidate === "flex-none") return { kind: "style", style: { flex: "none" } };

  const flexGrow = /^grow(?:-(\d+))?$/.exec(candidate);
  if (flexGrow) return { kind: "style", style: { flexGrow: flexGrow[1] ? Number(flexGrow[1]) : 1 } };
  const flexShrink = /^shrink(?:-(\d+))?$/.exec(candidate);
  if (flexShrink) return { kind: "style", style: { flexShrink: flexShrink[1] ? Number(flexShrink[1]) : 1 } };

  const basis = /^basis-(.+)$/.exec(candidate);
  if (basis) {
    const size = SPACING_REM[basis[1]] ?? basis[1];
    return { kind: "style", style: { flexBasis: size } };
  }

  // ---- Grid ----
  if (candidate.startsWith("grid-cols-")) {
    const n = Number(candidate.slice("grid-cols-".length));
    if (Number.isInteger(n) && n >= 1 && n <= 12) {
      return {
        kind: "style",
        style: { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` },
        signals: { display: "grid", columns: n, gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` },
      };
    }
    return null;
  }

  // ---- Alignment (flex/grid items) ----
  const alignItems: Record<string, string> = {
    "items-start": "flex-start",
    "items-center": "center",
    "items-end": "flex-end",
    "items-baseline": "baseline",
    "items-stretch": "stretch",
  };
  if (candidate in alignItems) {
    return { kind: "style", style: { alignItems: alignItems[candidate] }, signals: { alignItems: alignItems[candidate] } };
  }

  const justifyContent: Record<string, string> = {
    "justify-start": "flex-start",
    "justify-center": "center",
    "justify-end": "flex-end",
    "justify-between": "space-between",
    "justify-around": "space-around",
    "justify-evenly": "space-evenly",
  };
  if (candidate in justifyContent) {
    return { kind: "style", style: { justifyContent: justifyContent[candidate] }, signals: { justifyContent: justifyContent[candidate] } };
  }

  const justifyItems: Record<string, string> = {
    "justify-items-start": "start",
    "justify-items-center": "center",
    "justify-items-end": "end",
    "justify-items-stretch": "stretch",
  };
  if (candidate in justifyItems) return { kind: "style", style: { justifyItems: justifyItems[candidate] } };

  // ---- Gap ----
  if (candidate.startsWith("gap-")) {
    const size = spacingStyle(candidate.slice(4));
    if (size !== undefined) {
      const style: Record<string, unknown> = { gap: size };
      const px = spacingToPx(size);
      return { kind: "style", style, signals: px !== undefined ? { gap: px } : undefined };
    }
    return null;
  }
  if (candidate.startsWith("gap-x-")) {
    const size = spacingStyle(candidate.slice(6));
    if (size !== undefined) return { kind: "style", style: { columnGap: size } };
    return null;
  }
  if (candidate.startsWith("gap-y-")) {
    const size = spacingStyle(candidate.slice(6));
    if (size !== undefined) return { kind: "style", style: { rowGap: size } };
    return null;
  }

  // ---- Spacing (padding / margin) ----
  const pairSpacing: Array<{ prefix: string; props: [string, string] }> = [
    { prefix: "px-", props: ["paddingLeft", "paddingRight"] },
    { prefix: "py-", props: ["paddingTop", "paddingBottom"] },
    { prefix: "mx-", props: ["marginLeft", "marginRight"] },
    { prefix: "my-", props: ["marginTop", "marginBottom"] },
  ];
  for (const { prefix, props } of pairSpacing) {
    if (candidate.startsWith(prefix)) {
      const size = spacingStyle(candidate.slice(prefix.length));
      if (size !== undefined) {
        return { kind: "style", style: { [props[0]]: size, [props[1]]: size } };
      }
      return null;
    }
  }

  const spacingPatterns: Array<{ prefix: string; property: string }> = [
    { prefix: "pt-", property: "paddingTop" },
    { prefix: "pr-", property: "paddingRight" },
    { prefix: "pb-", property: "paddingBottom" },
    { prefix: "pl-", property: "paddingLeft" },
    { prefix: "p-", property: "padding" },
    { prefix: "mt-", property: "marginTop" },
    { prefix: "mr-", property: "marginRight" },
    { prefix: "mb-", property: "marginBottom" },
    { prefix: "ml-", property: "marginLeft" },
    { prefix: "m-", property: "margin" },
  ];
  for (const { prefix, property } of spacingPatterns) {
    if (candidate.startsWith(prefix)) {
      const size = spacingStyle(candidate.slice(prefix.length));
      if (size !== undefined) {
        const negative = candidate.startsWith("-");
        const pair: Record<string, unknown> = {};
        pair[property] = negative && size !== "0px" ? `-${size}` : size;
        return { kind: "style", style: pair };
      }
      return null;
    }
  }
  // Negative spacing shorthand: -mt-4, -p-2 …
  if (candidate.startsWith("-")) {
    const positive = convertTailwindClass(candidate.slice(1));
    if (positive && positive.kind === "style") {
      const negated: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(positive.style)) {
        if (typeof value === "string" && /^([\d.]+)(rem|px|em)$/.test(value)) {
          negated[key] = `-${value}`;
        }
      }
      if (Object.keys(negated).length > 0) return { kind: "style", style: negated };
    }
  }

  // ---- Width / height ----
  const fraction = /^(w|h)-(\d+)\/(\d+)$/.exec(candidate);
  if (fraction) {
    const percent = `${(Number(fraction[2]) / Number(fraction[3])) * 100}%`;
    return { kind: "style", style: { [fraction[1] === "w" ? "width" : "height"]: percent } };
  }

  const sizePatterns: Array<{ prefix: string; property: string }> = [
    { prefix: "w-", property: "width" },
    { prefix: "h-", property: "height" },
    { prefix: "min-w-", property: "minWidth" },
    { prefix: "max-w-", property: "maxWidth" },
    { prefix: "min-h-", property: "minHeight" },
    { prefix: "max-h-", property: "maxHeight" },
  ];
  for (const { prefix, property } of sizePatterns) {
    if (!candidate.startsWith(prefix)) continue;
    const rest = candidate.slice(prefix.length);
    const named: Record<string, string> = {
      full: "100%",
      screen: "100vw",
      "screen-sm": "640px",
      "screen-md": "768px",
      "screen-lg": "1024px",
      "screen-xl": "1280px",
      auto: "auto",
      fit: "fit-content",
      min: "min-content",
      max: "max-content",
      none: "none",
    };
    if (property === "maxWidth" || property === "minWidth" || property === "maxHeight" || property === "minHeight") {
      const namedMax: Record<string, string> = {
        xs: "20rem", sm: "24rem", md: "28rem", lg: "32rem", xl: "36rem",
        "2xl": "42rem", "3xl": "48rem", "4xl": "56rem", "5xl": "64rem",
        "6xl": "72rem", "7xl": "80rem", prose: "65ch",
      };
      if (rest in namedMax) return { kind: "style", style: { [property]: namedMax[rest] } };
      if (rest === "screen") return { kind: "style", style: { [property]: "100vh" } };
    }
    if (rest in named) {
      const value = named[rest];
      return { kind: "style", style: { [property]: value } };
    }
    const size = spacingStyle(rest);
    if (size !== undefined) return { kind: "style", style: { [property]: size } };
    return null;
  }

  // ---- Text alignment (checked before generic text-* so it wins) ----
  const textAlignMap: Record<string, string> = {
    "text-left": "left",
    "text-center": "center",
    "text-right": "right",
    "text-justify": "justify",
  };
  if (candidate in textAlignMap) {
    return { kind: "style", style: { textAlign: textAlignMap[candidate] } };
  }

  // ---- Typography ----
  if (candidate.startsWith("text-")) {
    const rest = candidate.slice(5);
    if (rest in FONT_SIZE_STYLES) {
      return { kind: "style", style: { ...FONT_SIZE_STYLES[rest] } };
    }
    const color = resolveShadedColor(rest);
    if (color) return { kind: "style", style: { color } };
    return null;
  }

  if (candidate.startsWith("font-")) {
    const rest = candidate.slice(5);
    if (rest in FONT_WEIGHTS) {
      return { kind: "style", style: { fontWeight: FONT_WEIGHTS[rest] } };
    }
    if (rest === "sans") return { kind: "style", style: { fontFamily: "system-ui, sans-serif" } };
    if (rest === "serif") return { kind: "style", style: { fontFamily: "Georgia, serif" } };
    if (rest === "mono") return { kind: "style", style: { fontFamily: "ui-monospace, monospace" } };
    return null;
  }

  if (candidate.startsWith("leading-")) {
    const rest = candidate.slice(8);
    if (rest in LINE_HEIGHTS) return { kind: "style", style: { lineHeight: LINE_HEIGHTS[rest] } };
    const size = spacingStyle(rest);
    if (size !== undefined) return { kind: "style", style: { lineHeight: size } };
    return null;
  }

  if (candidate.startsWith("tracking-")) {
    const rest = candidate.slice(9);
    if (rest in LETTER_SPACING) return { kind: "style", style: { letterSpacing: LETTER_SPACING[rest] } };
    return null;
  }

  if (candidate === "italic") return { kind: "style", style: { fontStyle: "italic" } };
  if (candidate === "not-italic") return { kind: "style", style: { fontStyle: "normal" } };
  if (candidate === "underline") return { kind: "style", style: { textDecorationLine: "underline" } };
  if (candidate === "line-through") return { kind: "style", style: { textDecorationLine: "line-through" } };
  if (candidate === "no-underline") return { kind: "style", style: { textDecorationLine: "none" } };
  if (candidate === "uppercase") return { kind: "style", style: { textTransform: "uppercase" } };
  if (candidate === "lowercase") return { kind: "style", style: { textTransform: "lowercase" } };
  if (candidate === "capitalize") return { kind: "style", style: { textTransform: "capitalize" } };
  if (candidate === "normal-case") return { kind: "style", style: { textTransform: "none" } };

  // ---- Background ----
  if (candidate.startsWith("bg-")) {
    const rest = candidate.slice(3);
    if (rest === "cover") return { kind: "style", style: { backgroundSize: "cover" } };
    if (rest === "contain") return { kind: "style", style: { backgroundSize: "contain" } };
    if (rest === "center") return { kind: "style", style: { backgroundPosition: "center" } };
    if (rest === "no-repeat") return { kind: "style", style: { backgroundRepeat: "no-repeat" } };
    const color = resolveShadedColor(rest);
    if (color) return { kind: "style", style: { background: color } };
    return null;
  }

  // ---- Border ----
  if (candidate === "border") {
    return { kind: "style", style: { borderWidth: 1 } };
  }
  const borderWidth = /^border-(\d+)$/.exec(candidate);
  if (borderWidth) return { kind: "style", style: { borderWidth: Number(borderWidth[1]) } };
  const borderStyle: Record<string, string> = {
    "border-solid": "solid",
    "border-dashed": "dashed",
    "border-dotted": "dotted",
    "border-double": "double",
    "border-none": "none",
  };
  if (candidate in borderStyle) return { kind: "style", style: { borderStyle: borderStyle[candidate] } };
  if (candidate === "border-x") return { kind: "style", style: { borderLeftWidth: 1, borderRightWidth: 1 } };
  if (candidate === "border-y") return { kind: "style", style: { borderTopWidth: 1, borderBottomWidth: 1 } };
  const borderSide: Record<string, string> = {
    "border-t": "borderTopWidth",
    "border-r": "borderRightWidth",
    "border-b": "borderBottomWidth",
    "border-l": "borderLeftWidth",
  };
  if (candidate in borderSide) return { kind: "style", style: { [borderSide[candidate]]: 1 } };
  if (candidate.startsWith("border-")) {
    const color = resolveShadedColor(candidate.slice(7));
    if (color) return { kind: "style", style: { borderColor: color } };
    return null;
  }

  // ---- Radius ----
  if (candidate === "rounded") return { kind: "style", style: { borderRadius: RADIUS_STYLES.DEFAULT } };
  if (candidate.startsWith("rounded-")) {
    const rest = candidate.slice(8);
    if (rest in RADIUS_STYLES) return { kind: "style", style: { borderRadius: RADIUS_STYLES[rest] } };
    const corner = /^(t|r|b|l|tl|tr|br|bl)-(.*)$/.exec(rest);
    if (corner) {
      const value = RADIUS_STYLES[corner[2]] ?? corner[2];
      const cornerMap: Record<string, string[]> = {
        t: ["borderTopLeftRadius", "borderTopRightRadius"],
        r: ["borderTopRightRadius", "borderBottomRightRadius"],
        b: ["borderBottomLeftRadius", "borderBottomRightRadius"],
        l: ["borderTopLeftRadius", "borderBottomLeftRadius"],
        tl: ["borderTopLeftRadius"],
        tr: ["borderTopRightRadius"],
        br: ["borderBottomRightRadius"],
        bl: ["borderBottomLeftRadius"],
      };
      const style: Record<string, unknown> = {};
      for (const prop of cornerMap[corner[1]]) style[prop] = value;
      return { kind: "style", style };
    }
    return null;
  }

  // ---- Shadow ----
  if (candidate.startsWith("shadow-")) {
    const rest = candidate.slice(7);
    if (rest in SHADOW_DEPTH) return { kind: "style", style: { shadowDepth: SHADOW_DEPTH[rest] } };
    return null;
  }
  if (candidate === "shadow") return { kind: "style", style: { shadowDepth: SHADOW_DEPTH.DEFAULT } };

  // ---- Opacity / z-index ----
  const opacity = /^opacity-(\d+)$/.exec(candidate);
  if (opacity) {
    const n = Number(opacity[1]);
    if (n >= 0 && n <= 100) return { kind: "style", style: { opacity: n / 100 } };
    return null;
  }
  const zIndex = /^z-(\d+|auto)$/.exec(candidate);
  if (zIndex) {
    if (zIndex[1] === "auto") return { kind: "style", style: { zIndex: "auto" } };
    return { kind: "style", style: { zIndex: Number(zIndex[1]) } };
  }

  // ---- Object fit / cursor / whitespace ----
  const objectFit: Record<string, string> = {
    "object-contain": "contain",
    "object-cover": "cover",
    "object-fill": "fill",
    "object-none": "none",
    "object-scale-down": "scale-down",
  };
  if (candidate in objectFit) return { kind: "style", style: { objectFit: objectFit[candidate] } };

  const cursor: Record<string, string> = {
    "cursor-pointer": "pointer",
    "cursor-default": "default",
    "cursor-not-allowed": "not-allowed",
    "cursor-grab": "grab",
    "cursor-move": "move",
    "cursor-text": "text",
  };
  if (candidate in cursor) return { kind: "style", style: { cursor: cursor[candidate] } };

  const whitespace: Record<string, string> = {
    "whitespace-normal": "normal",
    "whitespace-nowrap": "nowrap",
    "whitespace-pre": "pre",
    "whitespace-pre-line": "pre-line",
    "whitespace-pre-wrap": "pre-wrap",
  };
  if (candidate in whitespace) return { kind: "style", style: { whiteSpace: whitespace[candidate] } };

  const verticalAlign: Record<string, string> = {
    "align-baseline": "baseline",
    "align-top": "top",
    "align-middle": "middle",
    "align-bottom": "bottom",
  };
  if (candidate in verticalAlign) return { kind: "style", style: { verticalAlign: verticalAlign[candidate] } };

  // ---- Transform (small curated set) ----
  const scale = /^scale-(\d+)$/.exec(candidate);
  if (scale) {
    const n = Number(scale[1]);
    if ([50, 75, 90, 95, 100, 105, 110, 125, 150].includes(n)) {
      return { kind: "style", style: { transform: `scale(${n / 100})` } };
    }
    return null;
  }
  const rotate = /^rotate-(-?\d+)$/.exec(candidate);
  if (rotate) {
    const deg = Number(rotate[1]);
    if (deg >= -360 && deg <= 360) return { kind: "style", style: { transform: `rotate(${deg}deg)` } };
    return null;
  }

  // ---- Transitions ----
  if (candidate === "transition") {
    return { kind: "style", style: { transitionProperty: "all", transitionDuration: "150ms", transitionTimingFunction: "ease" } };
  }
  if (candidate === "transition-none") return { kind: "style", style: { transitionProperty: "none" } };
  if (candidate === "transition-all") return { kind: "style", style: { transitionProperty: "all" } };
  if (candidate === "transition-colors") return { kind: "style", style: { transitionProperty: "color, background-color, border-color" } };
  if (candidate === "transition-opacity") return { kind: "style", style: { transitionProperty: "opacity" } };
  if (candidate === "transition-transform") return { kind: "style", style: { transitionProperty: "transform" } };
  if (candidate === "transition-shadow") return { kind: "style", style: { transitionProperty: "box-shadow" } };

  return null;
}

// ---------------------------------------------------------------------------
// Inline styles (kebab → camel tokens)
// ---------------------------------------------------------------------------

export interface InlineStyleResult {
  style: Record<string, unknown>;
  dropped: string[];
}

/** Convert the P1 inline-style string map into camelCase style tokens. */
export function convertInlineStyleMap(
  inlineStyles: Record<string, string>,
): InlineStyleResult {
  const style: Record<string, unknown> = {};
  const dropped: string[] = [];

  for (const [property, value] of Object.entries(inlineStyles)) {
    const lower = property.toLowerCase();
    if (lower.startsWith("--")) {
      dropped.push(property);
      continue;
    }
    if (!isSafeCssValue(value)) {
      dropped.push(property);
      continue;
    }
    style[cssPropertyToCamel(lower)] = value.trim();
  }

  return { style, dropped };
}

function cssPropertyToCamel(name: string): string {
  const parts = name.split("-");
  if (parts[0] === "") parts.shift(); // -webkit-… → Webkit…
  return parts
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
}

/**
 * Derive layout signals from inline style tokens so that inline-style-only
 * layouts (style="display:flex; …") are recognised by the layout converter.
 */
function mergeInlineSignals(
  signals: LayoutSignals,
  style: Record<string, unknown>,
): void {
  if (typeof style.display === "string") signals.display = style.display;
  if (typeof style.flexDirection === "string") {
    signals.flexDirection = style.flexDirection;
  }
  if (typeof style.gap === "string") {
    const px = spacingToPx(style.gap);
    if (px !== undefined) signals.gap = px;
  }
  if (typeof style.alignItems === "string") signals.alignItems = style.alignItems;
  if (typeof style.justifyContent === "string") {
    signals.justifyContent = style.justifyContent;
  }
  if (typeof style.flexWrap === "string") {
    signals.flexWrap = style.flexWrap === "wrap";
  }
  if (typeof style.gridTemplateColumns === "string") {
    const match = /^repeat\(\s*(\d+)\s*[,)]/.exec(style.gridTemplateColumns);
    if (match) {
      signals.display = "grid";
      signals.columns = Number(match[1]);
      signals.gridTemplateColumns = style.gridTemplateColumns;
    }
  }
}

// ---------------------------------------------------------------------------
// Element-level entry point
// ---------------------------------------------------------------------------

/**
 * Convert an element's class names + inline styles into Buildora style tokens,
 * responsive overrides and layout signals. Inline styles win over class
 * tokens (CSS cascade order). When a context is provided, dropped inline
 * declarations and external class references are reported as warnings.
 */
export function convertElementStyles(
  classNames: readonly string[],
  inlineStyles: Record<string, string>,
  context?: ConversionContext,
  path?: string,
): ConvertedElementStyles {
  const style: Record<string, unknown> = {};
  const responsive: Record<string, Record<string, unknown>> = {};
  const signals: LayoutSignals = {};
  const referencedClasses: string[] = [];
  let convertedClassCount = 0;
  let tailwindDetected = false;

  for (const token of classNames) {
    const contribution = convertTailwindClass(token);
    if (contribution === null) {
      referencedClasses.push(token);
      continue;
    }
    convertedClassCount += 1;
    tailwindDetected = true;
    if (contribution.kind === "responsive") {
      // Responsive utilities affect the breakpoint bucket only — they must
      // never drive the BASE layout decision (e.g. md:flex-row ≠ row block).
      responsive[contribution.breakpoint] = {
        ...(responsive[contribution.breakpoint] ?? {}),
        ...contribution.style,
      };
    } else {
      Object.assign(style, contribution.style);
      if (contribution.signals) Object.assign(signals, contribution.signals);
    }
  }

  const inline = convertInlineStyleMap(inlineStyles);
  Object.assign(style, inline.style);
  mergeInlineSignals(signals, inline.style);
  if (inline.dropped.length > 0 && context) {
    for (const property of inline.dropped) {
      context.report.warn("inline-style-dropped", `Inline style declaration "${property}" dropped`, path);
    }
  }

  // External CSS class references.
  for (const className of referencedClasses) {
    if (context && context.cssClassSelectors.has(className)) {
      context.report.warn(
        "css-class-not-applied",
        `Class "${className}" is styled by imported CSS that is not applied`,
        path,
      );
    }
  }

  return {
    style,
    responsive,
    signals,
    referencedClasses,
    convertedClassCount,
    tailwindDetected,
  };
}
