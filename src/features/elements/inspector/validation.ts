// ---------------------------------------------------------------------------
// Inspector value validation (Phase P22-C) — pure, deterministic
//
// Centralized normalization and bounds for inspector inputs (D7/D8):
//   - numbers: finite, clamped, unit-aware ("12px" → 12)
//   - colors: hex / rgb() / rgba() / hsl() / hsla() / var(--token, …)
//   - spacing tokens: 1/2/4-part shorthand ↔ top/right/bottom/left
//
// These helpers run BEFORE a value reaches the element ops; the ops then
// re-validate through the existing Zod schema boundaries (defense in depth).
// No raw CSS is ever constructed from user input here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** Parse a user-typed string into a finite number (or null). */
export function parseNumberInput(raw: string): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/px$/i, "").replace(/%$/i, "");
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  return value;
}

/** Clamp a finite number into [min, max] (bounds preserved when absent). */
export function clampNumber(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number" && Number.isFinite(min)) next = Math.max(min, next);
  if (typeof max === "number" && Number.isFinite(max)) next = Math.min(max, next);
  return next;
}

/**
 * Normalize a style value that should be stored as a plain number:
 * numbers stay; "12" / "12px" become 12; anything else passes through
 * unchanged (e.g. "1.5rem" stays a string — the schema still validates it).
 */
export function normalizeNumericStyleValue(value: unknown): unknown {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = parseNumberInput(trimmed);
    if (parsed !== null && !trimmed.endsWith("%")) return parsed;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNCTION_COLOR =
  /^(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([^()]*\)$/i;
const VAR_COLOR = /^var\(--[a-zA-Z0-9-]+(?:,[^)]+)?\)$/;
const NAMED_COLORS = new Set([
  "transparent",
  "currentColor",
  "inherit",
  "black",
  "white",
  "red",
  "green",
  "blue",
  "gray",
  "grey",
]);

/**
 * True when a color string is a recognizable, non-executable CSS color.
 * Anything unrecognizable is rejected before it can reach the tree.
 */
export function isSafeColorValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (NAMED_COLORS.has(trimmed)) return true;
  if (HEX_COLOR.test(trimmed)) return true;
  if (FUNCTION_COLOR.test(trimmed)) return true;
  if (VAR_COLOR.test(trimmed)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Spacing tokens
// ---------------------------------------------------------------------------

export interface SpacingSides {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

const SPACING_PARTS = 4;

/** Split a spacing token into its parts (1/2/4-part CSS shorthand). */
export function splitSpacingToken(value: unknown): SpacingSides | null {
  if (typeof value !== "string") return null;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > SPACING_PARTS) return null;
  if (parts.length === 1) {
    const [all] = parts;
    return { top: all, right: all, bottom: all, left: all };
  }
  if (parts.length === 2) {
    const [v, h] = parts;
    return { top: v, right: h, bottom: v, left: h };
  }
  if (parts.length === 3) {
    const [t, h, b] = parts;
    return { top: t, right: h, bottom: b, left: h };
  }
  const [t, r, b, l] = parts;
  return { top: t, right: r, bottom: b, left: l };
}

/** Collapse sides into the shortest valid shorthand. */
export function collapseSpacingToken(sides: SpacingSides): string {
  const { top, right, bottom, left } = sides;
  if (top === right && right === bottom && bottom === left) return top;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/** True when a single side value is a plausible CSS length (bounded). */
export function isSafeLengthValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 10000;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 24) return false;
  if (/^\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|ch)?$/.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  return (
    !lower.includes("javascript:") &&
    !lower.includes("expression(") &&
    !lower.includes("behavior:") &&
    !lower.includes("binding:")
  );
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/** Trim + cap a string; returns null for empty results (caller decides). */
export function sanitizeInspectorString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}
