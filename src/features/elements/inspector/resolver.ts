// ---------------------------------------------------------------------------
// Universal property resolver (Phase P22-C) — pure, deterministic
//
// ElementNode + schema + breakpoint → resolved current values. The effective
// value for a responsive-capable style field is `override ?? base`, mirroring
// the P22-A `resolveElementStyle` precedence (base < viewport overrides).
// ---------------------------------------------------------------------------

import type { ElementNode } from "../types";
import { getInspectorSchema } from "./schemas";
import type {
  ElementInspectorSchema,
  InspectorBreakpoint,
  InspectorFieldDef,
  InspectorModel,
  InspectorResolvedValue,
} from "./types";
import { parseGridTemplateColumnsCount } from "../responsive/decisions";
import { splitSpacingToken } from "./validation";

/** A spacing side value (empty string = not set on that side). */
export interface SpacingSidesDisplay {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

const SPACING_SIDE_SUFFIXES = ["Top", "Right", "Bottom", "Left"] as const;

/**
 * Resolve a spacing field's display value: the shorthand expanded, then any
 * per-side longhand tokens override their side (longhands win cleanly).
 */
export function resolveSpacingSides(
  surface: Record<string, unknown> | undefined,
  field: InspectorFieldDef,
): SpacingSidesDisplay | null {
  const shorthand = surface?.[field.key];
  const sides = splitSpacingToken(shorthand) ?? { top: "", right: "", bottom: "", left: "" };
  let any = sides.top !== "" || sides.right !== "" || sides.bottom !== "" || sides.left !== "";
  for (const suffix of SPACING_SIDE_SUFFIXES) {
    const longhand = surface?.[`${field.key}${suffix}`];
    if (typeof longhand === "string" && longhand.trim().length > 0) {
      sides[suffix.toLowerCase() as keyof SpacingSidesDisplay] = longhand.trim();
      any = true;
    }
  }
  return any ? sides : null;
}

/** Read a field's value from the appropriate node surface (raw). */
export function readRawFieldValue(node: ElementNode, field: InspectorFieldDef): unknown {
  switch (field.source) {
    case "style":
      return node.style?.[field.key];
    case "geometry":
      return node.geometry?.[field.key as keyof typeof node.geometry];
    case "props":
      return node.props?.[field.key];
    case "a11y":
      return node.a11y?.[field.key as keyof typeof node.a11y];
    case "node":
      return (node as unknown as Record<string, unknown>)[field.key];
    // Phase P22-G — whole-object animation / interaction metadata.
    case "animation":
      return node.animation;
    case "interaction":
      return node.interaction;
    // Phase P22-J — whole-object data binding metadata.
    case "binding":
      return node.binding;
    // Phase P23-D — whole-object custom code metadata.
    case "customCode":
      return node.customCode;
    default:
      return undefined;
  }
}

/**
 * Resolve one field's effective value at a breakpoint.
 *
 *   base (desktop):  node.style[key]
 *   tablet/mobile:   node.viewport[breakpoint][key] ?? node.style[key]
 */
export function resolveFieldValue(
  node: ElementNode,
  field: InspectorFieldDef,
  breakpoint: InspectorBreakpoint,
): InspectorResolvedValue {
  // Spacing fields resolve shorthand + per-side longhands together.
  if (field.kind === "spacing" && field.source === "style") {
    const surface =
      breakpoint === "base" ? node.style : (node.viewport?.[breakpoint] ?? {});
    const sides = resolveSpacingSides(surface, field);
    const atBreakpoint = breakpoint !== "base" ? (node.viewport?.[breakpoint] ?? {}) : {};
    const override = atBreakpoint[field.key];
    return {
      value: sides,
      origin: sides ? "base" : "absent",
      overridden: breakpoint !== "base" && field.responsiveCapable === true && override !== undefined,
      inherited: false,
    };
  }

  // Grid columns (Phase P22-F): base = props.columns; tablet/mobile = the
  // gridTemplateColumns viewport override (parsed back to a count).
  if (field.kind === "grid-columns" && field.source === "props") {
    const baseColumns = typeof node.props?.columns === "number" ? node.props.columns : 3;
    if (breakpoint === "base") {
      return {
        value: baseColumns,
        origin: node.props?.columns === undefined ? "absent" : "base",
        overridden: false,
        inherited: false,
      };
    }
    const override = node.viewport?.[breakpoint]?.gridTemplateColumns;
    const parsed = parseGridTemplateColumnsCount(override);
    if (parsed !== null) {
      return {
        value: parsed,
        origin: "override",
        overridden: true,
        inherited: false,
      };
    }
    return {
      value: baseColumns,
      origin: node.props?.columns === undefined ? "absent" : "base",
      overridden: false,
      inherited: true,
    };
  }

  const base = readRawFieldValue(node, field);

  if (field.source !== "style" || !field.responsiveCapable || breakpoint === "base") {
    return {
      value: base,
      origin: base === undefined ? "absent" : "base",
      overridden: false,
      inherited: false,
    };
  }

  const override = node.viewport?.[breakpoint]?.[field.key];
  if (override !== undefined) {
    return {
      value: override,
      origin: "override",
      overridden: true,
      inherited: false,
    };
  }
  return {
    value: base,
    origin: base === undefined ? "absent" : "base",
    overridden: false,
    inherited: true,
  };
}

/** True when an override exists for the field at a given breakpoint. */
export function hasFieldOverride(
  node: ElementNode,
  field: InspectorFieldDef,
  breakpoint: Exclude<InspectorBreakpoint, "base">,
): boolean {
  if (field.kind === "grid-columns" && field.responsiveCapable) {
    return node.viewport?.[breakpoint]?.gridTemplateColumns !== undefined;
  }
  if (field.source !== "style" || !field.responsiveCapable) return false;
  return node.viewport?.[breakpoint]?.[field.key] !== undefined;
}

/**
 * Resolve the full inspector model for a node: applicable schema + current
 * values at the given breakpoint.
 */
export function resolveInspectorModel(
  node: ElementNode,
  breakpoint: InspectorBreakpoint,
): InspectorModel {
  const schema: ElementInspectorSchema = getInspectorSchema(node.type);
  const values: Record<string, InspectorResolvedValue> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      values[field.id] = resolveFieldValue(node, field, breakpoint);
    }
  }
  return { schema, values };
}

/** All fields of a schema in deterministic order (across sections). */
export function allFieldsOf(schema: ElementInspectorSchema): InspectorFieldDef[] {
  return schema.sections.flatMap((section) => section.fields);
}
