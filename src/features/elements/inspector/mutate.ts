// ---------------------------------------------------------------------------
// Inspector mutation adapter (Phase P22-C) — pure, deterministic
//
// Inspector change → existing element operation → new validated tree.
// This is the ONLY path from inspector controls to the element tree; the
// caller (the panel hook) then commits the tree through commitElementTree
// (one atomic history entry). No store mutation happens here.
//
// Value normalization + per-field validation run before any op is invoked;
// the ops then re-validate through their Zod schema boundaries.
// ---------------------------------------------------------------------------


import {
  ElementAnimationSchema,
  ElementBindingSchema,
  ElementGeometrySchema,
  ElementInteractionSchema,
  ElementStyleTokensSchema,
} from "../schemas/element-schemas";
import {
  updateElementBinding,
  setElementHidden,
  setElementLocked,
  updateElementAccessibility,
  updateElementAnimation,
  updateElementGeometry,
  updateElementInteraction,
  updateElementProps,
  updateElementStyle,
  updateElementViewport,
} from "../engine/element-operations";
import type {
  ElementAccessibility,
  ElementAnimation,
  ElementBinding,
  ElementGeometry,
  ElementInteraction,
  ElementNode,
  ElementResult,
  ElementStyleTokens,
  ElementTree,
} from "../types";
import type {
  InspectorBreakpoint,
  InspectorFieldDef,
  InspectorFieldValidation,
} from "./types";
import { clampNumber, normalizeNumericStyleValue, sanitizeInspectorString, splitSpacingToken } from "./validation";

// ---------------------------------------------------------------------------
// Field-level validation + normalization
// ---------------------------------------------------------------------------

/**
 * Validate + normalize a raw control value for a field. Returns the value to
 * commit (or undefined to delete the key) with ok=true, or a structured error.
 */
export function validateInspectorFieldValue(
  field: InspectorFieldDef,
  raw: unknown,
): InspectorFieldValidation {
  // Per-field custom validation first.
  if (field.validate) {
    const message = field.validate(raw);
    if (message) return { ok: false, error: message };
  }

  switch (field.kind) {
    case "number":
    case "slider": {
      if (raw === undefined || raw === null || raw === "") {
        return { ok: true, value: undefined }; // delete / auto
      }
      if (typeof raw === "number") {
        if (!Number.isFinite(raw)) return { ok: false, error: "Enter a valid number." };
        return { ok: true, value: clampNumber(raw, field.min, field.max) };
      }
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed.toLowerCase() === "auto") {
        return { ok: true, value: undefined }; // restore auto
      }
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return { ok: true, value: clampNumber(numeric, field.min, field.max) };
      }
      // Plausible CSS length (e.g. "1.5rem") — keep as-is; the style-token
      // schema still bounds + sanitizes it.
      if (/^[0-9.]+[a-z%]*$/i.test(trimmed)) {
        return { ok: true, value: trimmed };
      }
      return { ok: false, error: "Enter a valid number." };
    }
    case "toggle": {
      return { ok: true, value: raw === true };
    }
    case "text":
    case "textarea": {
      if (typeof raw !== "string") return { ok: false, error: "Enter text." };
      const sanitized = sanitizeInspectorString(raw, field.maxLength ?? 4000);
      if (sanitized === null) return { ok: true, value: undefined };
      return { ok: true, value: sanitized };
    }
    case "select":
    case "segmented":
    case "font-family":
    case "alignment": {
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return { ok: false, error: "Choose a value." };
      }
      return { ok: true, value: raw };
    }
    case "grid-columns": {
      // Grid columns: a 1..6 integer (accepts numeric strings from the
      // segmented control); clamped to the field bounds. undefined/null
      // delete/reset (same semantics as the other number fields).
      if (raw === undefined || raw === null || raw === "") {
        return { ok: true, value: undefined };
      }
      const numeric =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== ""
            ? Number(raw.trim())
            : Number.NaN;
      if (!Number.isFinite(numeric)) return { ok: false, error: "Choose a column count." };
      const clamped = Math.round(clampNumber(numeric, field.min ?? 1, field.max ?? 6));
      return { ok: true, value: clamped };
    }
    case "color": {
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return { ok: false, error: "Enter a color." };
      }
      return { ok: true, value: raw.trim() };
    }
    case "spacing": {
      // Spacing commits through a dedicated path (per-side writes); the raw
      // value here is the collapsed shorthand string.
      if (typeof raw !== "string" || raw.trim().length === 0) {
        return { ok: false, error: "Enter a spacing value." };
      }
      return { ok: true, value: raw.trim() };
    }
    case "radius":
    case "shadow": {
      if (typeof raw !== "string") {
        if (typeof raw === "number") return { ok: true, value: raw };
        return { ok: false, error: "Enter a value." };
      }
      if (raw.trim().length === 0) return { ok: true, value: undefined };
      return { ok: true, value: raw.trim() };
    }
    case "animation": {
      // Phase P22-G — null/undefined clears the property; otherwise the whole
      // ElementAnimation object must pass the shared schema boundary.
      if (raw === null || raw === undefined) return { ok: true, value: null };
      const parsed = ElementAnimationSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid animation.",
        };
      }
      return { ok: true, value: parsed.data };
    }
    case "interaction": {
      // Phase P22-G — null/undefined clears the property; otherwise the whole
      // ElementInteraction object must pass the shared schema boundary.
      if (raw === null || raw === undefined) return { ok: true, value: null };
      const parsed = ElementInteractionSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid interaction.",
        };
      }
      return { ok: true, value: parsed.data };
    }
    case "binding": {
      // Phase P22-J — null/undefined clears the binding; otherwise the whole
      // ElementBinding object must pass the shared schema boundary.
      if (raw === null || raw === undefined) return { ok: true, value: null };
      const parsed = ElementBindingSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid binding.",
        };
      }
      return { ok: true, value: parsed.data };
    }
    default:
      return { ok: true, value: raw };
  }
}

// ---------------------------------------------------------------------------
// Tree helpers (delete a style key / clear a viewport override)
// ---------------------------------------------------------------------------

/** Delete style tokens from a node, returning a validated tree. */
export function deleteStyleTokens(
  tree: ElementTree,
  elementId: string,
  keys: string[],
): ElementResult<ElementTree> {
  const node = tree.nodes[elementId];
  if (!node) {
    return {
      ok: false,
      error: { code: "ELEMENT_NOT_FOUND", message: `Element "${elementId}" does not exist.` },
    };
  }
  const style = { ...(node.style ?? {}) };
  for (const key of keys) delete style[key];
  const parsed = ElementStyleTokensSchema.safeParse(style);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "ELEMENT_STYLE_INVALID", message: "Invalid style tokens." },
    };
  }
  const nodes: Record<string, ElementNode> = { ...tree.nodes };
  nodes[elementId] = { ...node, style: parsed.data };
  return { ok: true, value: { rootIds: [...tree.rootIds], nodes } };
}

/** Delete geometry keys from a node, returning a validated tree. */
function deleteGeometryKeys(
  tree: ElementTree,
  elementId: string,
  keys: string[],
): ElementResult<ElementTree> {
  const node = tree.nodes[elementId];
  if (!node) {
    return {
      ok: false,
      error: { code: "ELEMENT_NOT_FOUND", message: `Element "${elementId}" does not exist.` },
    };
  }
  const geometry = { ...(node.geometry ?? { mode: "flow" as const }) } as Record<string, unknown>;
  for (const key of keys) delete geometry[key];
  const parsed = ElementGeometrySchema.safeParse(geometry);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_GEOMETRY_INVALID",
        message: parsed.error.issues[0]?.message ?? "Invalid geometry.",
      },
    };
  }
  const nodes: Record<string, ElementNode> = { ...tree.nodes };
  nodes[elementId] = { ...node, geometry: parsed.data };
  return { ok: true, value: { rootIds: [...tree.rootIds], nodes } };
}

/** Clear a key from a viewport override record (dropping empty records). */
export function clearViewportOverride(
  tree: ElementTree,
  elementId: string,
  breakpoint: Exclude<InspectorBreakpoint, "base">,
  keys: string[],
): ElementResult<ElementTree> {
  const node = tree.nodes[elementId];
  if (!node) {
    return {
      ok: false,
      error: { code: "ELEMENT_NOT_FOUND", message: `Element "${elementId}" does not exist.` },
    };
  }
  const current = node.viewport?.[breakpoint];
  if (!current) return { ok: true, value: tree };
  const nextAtBreakpoint = { ...current };
  for (const key of keys) delete nextAtBreakpoint[key];
  const parsed = ElementStyleTokensSchema.safeParse(nextAtBreakpoint);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "ELEMENT_VIEWPORT_INVALID", message: "Invalid viewport overrides." },
    };
  }
  const viewport = { ...(node.viewport ?? {}) };
  if (Object.keys(parsed.data).length === 0) {
    delete viewport[breakpoint];
  } else {
    viewport[breakpoint] = parsed.data;
  }
  const nodes: Record<string, ElementNode> = { ...tree.nodes };
  const next: ElementNode = { ...node };
  if (Object.keys(viewport).length === 0) delete next.viewport;
  else next.viewport = viewport as ElementNode["viewport"];
  nodes[elementId] = next;
  return { ok: true, value: { rootIds: [...tree.rootIds], nodes } };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

/** True when a style-key reset (delete) is requested. */
function isResetValue(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/**
 * Apply one field change to the tree. `value === undefined` deletes the key
 * (reset-to-default). Returns the new validated tree (or an error).
 */
export function applyInspectorFieldChange(
  tree: ElementTree,
  elementId: string,
  field: InspectorFieldDef,
  value: unknown,
  breakpoint: InspectorBreakpoint,
): ElementResult<ElementTree> {
  const node = tree.nodes[elementId];
  if (!node) {
    return {
      ok: false,
      error: { code: "ELEMENT_NOT_FOUND", message: `Element "${elementId}" does not exist.` },
    };
  }

  // Field-level validation + normalization (bounds, safety, length caps). The
  // UI validates first; this is the defense-in-depth second gate so the adapter
  // is safe to call directly.
  const validated = validateInspectorFieldValue(field, value);
  if (!validated.ok) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_TREE_INVALID",
        message: validated.error ?? "Invalid value.",
      },
    };
  }
  const normalized = validated.value;

  // ---- Node-level booleans (hidden / locked) ----
  if (field.source === "node") {
    if (field.key === "hidden") return setElementHidden(tree, elementId, normalized === true);
    if (field.key === "locked") return setElementLocked(tree, elementId, normalized === true);
    return {
      ok: false,
      error: { code: "ELEMENT_TREE_INVALID", message: `Unsupported node field "${field.key}".` },
    };
  }

  // ---- Style tokens (base or viewport override) ----
  if (field.source === "style") {
    const styleValue = normalizeNumericStyleValue(normalized);
    if (breakpoint === "base") {
      if (isResetValue(styleValue)) {
        return deleteStyleTokens(tree, elementId, [field.key]);
      }
      return updateElementStyle(tree, elementId, { [field.key]: styleValue } as ElementStyleTokens);
    }
    if (isResetValue(styleValue)) {
      return clearViewportOverride(tree, elementId, breakpoint, [field.key]);
    }
    return updateElementViewport(tree, elementId, breakpoint, { [field.key]: styleValue } as ElementStyleTokens);
  }

  // ---- Grid columns (Phase P22-F): base writes props.columns, tablet/mobile
  // writes the gridTemplateColumns viewport override (the renderer already
  // resolves it through the shared viewport-override path). ----
  if (field.kind === "grid-columns" && field.source === "props") {
    if (breakpoint === "base") {
      if (isResetValue(normalized)) {
        // updateElementProps merges over the base, so a true key-delete is
        // not expressible — reset to the default count (3), which is the
        // same effective value as an absent columns prop.
        return updateElementProps(tree, elementId, { columns: field.default ?? 3 });
      }
      return updateElementProps(tree, elementId, { columns: normalized });
    }
    if (isResetValue(normalized)) {
      return clearViewportOverride(tree, elementId, breakpoint, ["gridTemplateColumns"]);
    }
    return updateElementViewport(tree, elementId, breakpoint, {
      gridTemplateColumns: `repeat(${normalized}, minmax(0, 1fr))`,
    } as ElementStyleTokens);
  }

  // ---- Geometry ----
  if (field.source === "geometry") {
    if (isResetValue(normalized)) {
      return deleteGeometryKeys(tree, elementId, [field.key]);
    }
    return updateElementGeometry(tree, elementId, { [field.key]: normalized } as Partial<ElementGeometry>);
  }

  // ---- Props ----
  if (field.source === "props") {
    if (isResetValue(normalized)) {
      const props = { ...node.props };
      delete props[field.key];
      return updateElementProps(tree, elementId, props);
    }
    return updateElementProps(tree, elementId, { [field.key]: normalized });
  }

  // ---- Accessibility ----
  if (field.source === "a11y") {
    if (isResetValue(normalized)) {
      const a11y = { ...(node.a11y ?? {}) } as Record<string, unknown>;
      delete a11y[field.key];
      return updateElementAccessibility(tree, elementId, a11y as Partial<ElementAccessibility>);
    }
    return updateElementAccessibility(tree, elementId, { [field.key]: normalized } as Partial<ElementAccessibility>);
  }

  // ---- Phase P22-G — whole-object animation / interaction metadata ----
  if (field.source === "animation") {
    return updateElementAnimation(
      tree,
      elementId,
      (normalized === null ? null : (normalized as ElementAnimation)),
    );
  }
  if (field.source === "interaction") {
    return updateElementInteraction(
      tree,
      elementId,
      (normalized === null ? null : (normalized as ElementInteraction)),
    );
  }
  // Phase P22-J — whole-object data binding.
  if (field.source === "binding") {
    return updateElementBinding(
      tree,
      elementId,
      (normalized === null ? null : (normalized as ElementBinding)),
    );
  }

  return {
    ok: false,
    error: { code: "ELEMENT_TREE_INVALID", message: `Unsupported value source "${field.source}".` },
  };
}

/**
 * Reset a field to its default: delete the base style key or the viewport
 * override key (geometry/props/node fields fall back to apply-with-undefined).
 */
export function resetInspectorField(
  tree: ElementTree,
  elementId: string,
  field: InspectorFieldDef,
  breakpoint: InspectorBreakpoint,
): ElementResult<ElementTree> {
  if (field.source === "style" && field.responsiveCapable && breakpoint !== "base") {
    return clearViewportOverride(tree, elementId, breakpoint, [field.key]);
  }
  // Grid columns reset at tablet/mobile deletes the gridTemplateColumns
  // override only (base props.columns is untouched).
  if (field.kind === "grid-columns" && breakpoint !== "base") {
    return clearViewportOverride(tree, elementId, breakpoint, ["gridTemplateColumns"]);
  }
  return applyInspectorFieldChange(tree, elementId, field, undefined, breakpoint);
}

// ---------------------------------------------------------------------------
// Spacing helpers — per-side writes with shorthand collapse/expand
// ---------------------------------------------------------------------------

/**
 * Apply a per-side spacing change. When the user edits one side, the side is
 * written as a longhand token and the shorthand is removed so the longhands
 * win cleanly. When all four sides are equal, the shorthand is written and
 * the longhands removed (deterministic, round-trippable).
 */
export function applySpacingSideChange(
  tree: ElementTree,
  elementId: string,
  field: InspectorFieldDef,
  side: "top" | "right" | "bottom" | "left",
  value: string,
  breakpoint: InspectorBreakpoint,
): ElementResult<ElementTree> {
  const node = tree.nodes[elementId];
  if (!node) {
    return {
      ok: false,
      error: { code: "ELEMENT_NOT_FOUND", message: `Element "${elementId}" does not exist.` },
    };
  }

  const surface =
    breakpoint === "base" ? (node.style ?? {}) : (node.viewport?.[breakpoint] ?? {});
  const sides = splitSpacingToken(surface[field.key]) ?? {
    top: "",
    right: "",
    bottom: "",
    left: "",
  };
  // Seed the sides from existing per-side longhands so collapsing works when
  // previous edits stored longhand tokens.
  for (const suffix of ["Top", "Right", "Bottom", "Left"] as const) {
    const longhand = surface[`${field.key}${suffix}`];
    if (typeof longhand === "string" && longhand.trim().length > 0) {
      sides[suffix.toLowerCase() as keyof typeof sides] = longhand.trim();
    }
  }
  sides[side] = value;

  const allEqual =
    sides.top === sides.right &&
    sides.right === sides.bottom &&
    sides.bottom === sides.left;

  const longhandKey = `${field.key}${side[0].toUpperCase()}${side.slice(1)}`;
  const patch: Record<string, unknown> = {};
  const keysToRemove: string[] = [];

  if (allEqual && sides.top !== "") {
    patch[field.key] = sides.top;
    for (const s of ["top", "right", "bottom", "left"] as const) {
      const key = `${field.key}${s[0].toUpperCase()}${s.slice(1)}`;
      keysToRemove.push(key);
    }
  } else {
    patch[longhandKey] = value;
    keysToRemove.push(field.key);
  }

  if (breakpoint === "base") {
    let result: ElementResult<ElementTree> = { ok: true, value: tree };
    if (keysToRemove.length > 0) {
      result = deleteStyleTokens(result.value, elementId, keysToRemove);
    }
    if (!result.ok) return result;
    return updateElementStyle(result.value, elementId, patch as ElementStyleTokens);
  }

  let result: ElementResult<ElementTree> = { ok: true, value: tree };
  if (keysToRemove.length > 0) {
    result = clearViewportOverride(result.value, elementId, breakpoint, keysToRemove);
  }
  if (!result.ok) return result;
  return updateElementViewport(result.value, elementId, breakpoint, patch as ElementStyleTokens);
}
