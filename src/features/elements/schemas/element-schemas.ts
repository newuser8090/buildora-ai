// ---------------------------------------------------------------------------
// Element schemas (Phase P22-A) — validation boundary for all element data
//
// Security posture mirrors the P1/P3 policies (custom-block-schema):
//   - prototype-pollution / dangerous keys are rejected at any depth
//   - executable CSS values are rejected (no javascript:/vbscript:/expression)
//   - every string is length-capped; every record is key-count-capped
//   - customCode is DATA ONLY — validated and capped, never executed
//
// The node schema refines `type` against the known built-in catalogue
// (Phase O block types + element-only families). Registry-level validation
// (engine/element-validation.ts) additionally checks the LIVE registry so
// newly registered types work without schema edits.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { ALL_BLOCK_TYPES } from "@/features/blocks/registry/default-blocks";
import { ELEMENT_ONLY_TYPES } from "../types";
import type { ElementStyleTokens, ElementTree } from "../types";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

export const ELEMENT_MAX_NODES = 1000;
export const ELEMENT_MAX_DEPTH = 12;
export const ELEMENT_MAX_TEXT_LENGTH = 4000;
export const ELEMENT_MAX_CHILDREN = 32;
export const ELEMENT_MAX_PROPS_KEYS = 64;
export const ELEMENT_MAX_STYLE_KEYS = 64;
export const ELEMENT_MAX_VIEWPORT_KEYS = 2;
export const ELEMENT_MAX_RESPONSIVE_BREAKPOINTS = 5;
export const ELEMENT_MAX_STRING_LENGTH = 120;
export const ELEMENT_MAX_CUSTOM_CODE_LENGTH = 20_000;
/** Aggregate cap across css+js+html (bounds the emitted sandbox document). */
export const ELEMENT_MAX_CUSTOM_CODE_TOTAL = 48_000;
export const ELEMENT_MAX_ATTRIBUTES = 16;
export const ELEMENT_MAX_GEOMETRY_VALUE = 10_000;
export const ELEMENT_MAX_ANIMATION_DURATION = 60_000;
export const ELEMENT_MAX_LIST_ITEMS = 64;

// ---------------------------------------------------------------------------
// Safety policy (mirrors Phase P1/P3)
// ---------------------------------------------------------------------------

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const DANGEROUS_STYLE_KEYS = new Set([
  "behavior",
  "binding",
  "mozbinding",
  "-moz-binding",
]);

export function isSafeElementCssValue(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    !lower.includes("javascript:") &&
    !lower.includes("vbscript:") &&
    !lower.includes("expression(") &&
    !lower.includes("behavior:") &&
    !lower.includes("binding:") &&
    !lower.includes("url(javascript:")
  );
}

/** Find dangerous keys / unsafe values at any depth. Empty when safe. */
export function findDangerousElementKeys(
  payload: unknown,
  path = "",
): string[] {
  const problems: string[] = [];
  if (payload === null || typeof payload !== "object") return problems;

  if (Array.isArray(payload)) {
    payload.forEach((item, index) => {
      problems.push(...findDangerousElementKeys(item, `${path}[${index}]`));
    });
    return problems;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (DANGEROUS_KEYS.has(key)) {
      problems.push(`Dangerous key "${key}"${path ? ` at ${path}` : ""} is not allowed.`);
      continue;
    }
    if (typeof value === "string" && !isSafeElementCssValue(value)) {
      problems.push(`Unsafe value for "${key}"${path ? ` at ${path}` : ""} was rejected.`);
    }
    if (value !== null && typeof value === "object") {
      problems.push(...findDangerousElementKeys(value, `${path}.${key}`));
    }
  }
  return problems;
}

export function isSafeElementPayload(payload: unknown): boolean {
  return findDangerousElementKeys(payload).length === 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Bounded record guard used for props/style payloads. Uses z.custom so the
 * RAW input is checked (never rebuilt) — an own "__proto__" key cannot
 * silently change the prototype during a z.record rebuild.
 */
function boundedRecord(
  maxKeys: number,
  capText: boolean,
): z.ZodType<Record<string, unknown>> {
  return z.custom<Record<string, unknown>>(
    (value) => {
      if (!isPlainRecord(value)) return false;
      if (Object.keys(value).length > maxKeys) return false;
      if (Object.keys(value).some((key) => DANGEROUS_KEYS.has(key))) return false;
      if (Object.keys(value).some((key) => DANGEROUS_STYLE_KEYS.has(key))) return false;
      if (!isSafeElementPayload(value)) return false;
      if (!capText) return true;
      return Object.values(value).every(
        (item) =>
          typeof item !== "string" ||
          item.length <= ELEMENT_MAX_TEXT_LENGTH,
      );
    },
    { message: "Record exceeds limits or contains unsafe keys/values." },
  );
}

// ---------------------------------------------------------------------------
// Field schemas
// ---------------------------------------------------------------------------

export const ElementStyleTokensSchema = boundedRecord(ELEMENT_MAX_STYLE_KEYS, true) as z.ZodType<ElementStyleTokens>;

const boundedNumber = (max: number) =>
  z.number().finite().min(-max).max(max);

export const ElementGeometrySchema = z.object({
  mode: z.enum(["flow", "absolute"]).default("flow"),
  x: boundedNumber(ELEMENT_MAX_GEOMETRY_VALUE).optional(),
  y: boundedNumber(ELEMENT_MAX_GEOMETRY_VALUE).optional(),
  width: boundedNumber(ELEMENT_MAX_GEOMETRY_VALUE).optional(),
  height: boundedNumber(ELEMENT_MAX_GEOMETRY_VALUE).optional(),
  rotation: boundedNumber(3600).optional(),
  zIndex: z.number().int().min(-1000).max(1000).optional(),
});

export const ElementViewportStylesSchema = z
  .object({
    tablet: ElementStyleTokensSchema.optional(),
    mobile: ElementStyleTokensSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length <= ELEMENT_MAX_VIEWPORT_KEYS,
    { message: "Too many viewport keys." },
  );

const animationEasing = z.string().max(64).regex(
  /^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\([0-9.,\s-]+\))$/i,
  { message: "Unsupported easing value." },
);

export const ElementAnimationSchema = z.object({
  trigger: z.enum(["load", "hover", "click", "scroll", "viewport"]),
  type: z.enum([
    "fade",
    "slide",
    "scale",
    "bounce",
    "reveal",
    "blur",
    "rotate",
    "custom",
  ]),
  durationMs: z
    .number()
    .int()
    .min(0)
    .max(ELEMENT_MAX_ANIMATION_DURATION)
    .optional(),
  delayMs: z
    .number()
    .int()
    .min(0)
    .max(ELEMENT_MAX_ANIMATION_DURATION)
    .optional(),
  easing: animationEasing.optional(),
  repeat: z.union([z.literal("none"), z.literal("infinite"), z.number().int().min(0).max(1000)]).optional(),
  direction: z.enum(["normal", "reverse", "alternate"]).optional(),
});

/** Unsafe URL schemes are rejected at the data boundary (mirrors preview nav). */
function isSafeTargetUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith("javascript:")) return false;
  if (lower.startsWith("vbscript:")) return false;
  if (lower.startsWith("data:text/html")) return false;
  return true;
}

export const NavTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("page"), pageId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
  z.object({
    kind: z.literal("section"),
    pageId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH).optional(),
    sectionId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH),
  }),
  z.object({
    kind: z.literal("external"),
    url: z.string().min(1).max(2048).refine(isSafeTargetUrl, { message: "Unsafe URL scheme." }),
  }),
  z.object({ kind: z.literal("email"), to: z.string().min(1).max(320) }),
  z.object({ kind: z.literal("phone"), number: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("back") }),
]);

export const ElementActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("navigate"), target: NavTargetSchema }),
  z.object({ kind: z.literal("scroll-to"), elementId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
  z.object({ kind: z.literal("toggle"), elementId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
  z.object({ kind: z.literal("open-modal"), elementId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
  z.object({ kind: z.literal("start-animation"), elementId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
  z.object({ kind: z.literal("submit-form"), formId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
  z.object({ kind: z.literal("custom"), handlerId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH) }),
]);

export const ElementHoverEffectSchema = z.object({
  color: z.string().max(64).optional(),
  backgroundColor: z.string().max(64).optional(),
  scale: z.number().finite().min(0).max(10).optional(),
  shadow: z.enum(["none", "sm", "md", "lg"]).optional(),
  animation: ElementAnimationSchema.optional(),
});

export const ElementScrollEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reveal"), animation: ElementAnimationSchema }),
  z.object({ kind: z.literal("sticky"), offset: z.number().finite().min(-10_000).max(10_000).optional() }),
  z.object({ kind: z.literal("parallax"), speed: z.number().finite().min(0).max(5).optional() }),
]);

export const ElementInteractionSchema = z.object({
  click: ElementActionSchema.nullable().optional(),
  hover: ElementHoverEffectSchema.nullable().optional(),
  focus: ElementHoverEffectSchema.nullable().optional(),
  scroll: ElementScrollEffectSchema.nullable().optional(),
  load: ElementAnimationSchema.nullable().optional(),
});

export const ElementBindingSchema = z.object({
  source: z.enum(["page", "project", "collection", "form", "auth"]),
  collectionId: z.string().max(ELEMENT_MAX_STRING_LENGTH).optional(),
  path: z.string().max(512).optional(),
  field: z.string().max(ELEMENT_MAX_STRING_LENGTH).optional(),
});

export const ElementAccessibilitySchema = z.object({
  alt: z.string().max(2048).optional(),
  label: z.string().max(2048).optional(),
  role: z.string().max(128).optional(),
  ariaHidden: z.boolean().optional(),
  focusable: z.boolean().optional(),
});

export const ElementCustomCodeSchema = z
  .object({
    // Phase P23 — explicit opt-in. Custom code is inert data until enabled;
    // absent/legacy payloads default to false (never executed anywhere).
    enabled: z.boolean().default(false),
    css: z.string().max(ELEMENT_MAX_CUSTOM_CODE_LENGTH).optional(),
    js: z.string().max(ELEMENT_MAX_CUSTOM_CODE_LENGTH).optional(),
    html: z.string().max(ELEMENT_MAX_CUSTOM_CODE_LENGTH).optional(),
    attributes: z
      .record(z.string().max(128), z.string().max(2048))
      .refine(
        (record) => Object.keys(record).length <= ELEMENT_MAX_ATTRIBUTES,
        { message: "Too many custom attributes." },
      )
      .optional(),
  })
  .refine(
    (value) =>
      (value.css?.length ?? 0) +
        (value.js?.length ?? 0) +
        (value.html?.length ?? 0) <=
      ELEMENT_MAX_CUSTOM_CODE_TOTAL,
    { message: "Custom code exceeds the total size limit." },
  );

// ---------------------------------------------------------------------------
// Node / tree schemas
// ---------------------------------------------------------------------------

const elementTypeRefine = z
  .string()
  .min(1)
  .max(64)
  .refine(isKnownElementType, { message: "Unknown element type." });

/** True when the type is part of the built-in catalogue (block or element-only). */
export function isKnownElementType(type: string): boolean {
  return (
    (ALL_BLOCK_TYPES as readonly string[]).includes(type) ||
    (ELEMENT_ONLY_TYPES as readonly string[]).includes(type)
  );
}

export const ElementNodeSchema = z.object({
  id: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH),
  type: elementTypeRefine,
  parentId: z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH).nullable(),
  children: z.array(z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH)).max(ELEMENT_MAX_CHILDREN),
  props: boundedRecord(ELEMENT_MAX_PROPS_KEYS, true),
  style: ElementStyleTokensSchema,
  responsive: z.record(z.string().max(32), ElementStyleTokensSchema).refine(
    (record) => Object.keys(record).length <= ELEMENT_MAX_RESPONSIVE_BREAKPOINTS,
    { message: "Too many responsive breakpoints." },
  ),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  geometry: ElementGeometrySchema.optional(),
  viewport: ElementViewportStylesSchema.optional(),
  animation: ElementAnimationSchema.optional(),
  interaction: ElementInteractionSchema.optional(),
  binding: ElementBindingSchema.optional(),
  a11y: ElementAccessibilitySchema.optional(),
  customCode: ElementCustomCodeSchema.optional(),
});

export type ValidatedElementNode = z.infer<typeof ElementNodeSchema>;

// ---------------------------------------------------------------------------
// Structural tree validation (registry-independent)
// ---------------------------------------------------------------------------

export interface ElementTreeProblem {
  message: string;
}

export interface ElementTreeValidation {
  valid: boolean;
  problems: ElementTreeProblem[];
}

/**
 * Validate the structural invariants of an element tree without depending on
 * the element registry: caps, unique ids, known built-in types, consistent
 * parent/children references, acyclicity, no orphaned nodes. Nesting rules
 * are checked separately against the live registry by validateElementTree
 * (engine/element-validation.ts).
 */
export function validateElementTreeStructure(
  tree: unknown,
): ElementTreeValidation {
  const problems: ElementTreeProblem[] = [];
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) {
    return { valid: false, problems: [{ message: "The element tree is not an object." }] };
  }
  const candidate = tree as Partial<ElementTree>;
  const rootIds = Array.isArray(candidate.rootIds)
    ? candidate.rootIds.filter((r): r is string => typeof r === "string")
    : [];
  const nodes =
    isPlainRecord(candidate.nodes) ? candidate.nodes : {};

  const nodeIds = Object.keys(nodes);
  if (nodeIds.length > ELEMENT_MAX_NODES) {
    problems.push({
      message: `An element tree can contain at most ${ELEMENT_MAX_NODES} elements (found ${nodeIds.length}).`,
    });
  }
  if (nodeIds.length === 0) {
    problems.push({ message: "The element tree contains no elements." });
  }

  const seen = new Set<string>();
  const push = (message: string) => problems.push({ message });

  const walk = (nodeId: string, depth: number, ancestors: Set<string>): void => {
    if (depth > ELEMENT_MAX_DEPTH) {
      push(`The element tree is nested deeper than ${ELEMENT_MAX_DEPTH} levels.`);
      return;
    }
    const raw = nodes[nodeId];
    if (!isPlainRecord(raw)) {
      push(`Element "${nodeId}" is referenced but missing.`);
      return;
    }
    if (ancestors.has(nodeId)) {
      push(`Cycle detected at "${nodeId}".`);
      return;
    }
    if (seen.has(nodeId)) {
      push(`Element "${nodeId}" is reachable more than once.`);
      return;
    }
    seen.add(nodeId);

    if (typeof raw.type !== "string" || !isKnownElementType(raw.type)) {
      push(`Element "${nodeId}" has unknown type "${String(raw.type)}".`);
    }
    if (raw.parentId !== null && typeof raw.parentId !== "string") {
      push(`Element "${nodeId}" has an invalid parent reference.`);
    }
    if (!Array.isArray(raw.children)) {
      push(`Element "${nodeId}" has an invalid children list.`);
      return;
    }
    if (raw.children.length > ELEMENT_MAX_CHILDREN) {
      push(`Element "${nodeId}" has more than ${ELEMENT_MAX_CHILDREN} children.`);
    }
    for (const childId of raw.children) {
      if (typeof childId !== "string") {
        push(`Element "${nodeId}" has a non-string child id.`);
        continue;
      }
      const child = nodes[childId];
      if (!isPlainRecord(child)) {
        push(`Element "${nodeId}" references a missing child "${childId}".`);
        continue;
      }
      if (child.parentId !== nodeId) {
        push(`Child "${childId}" does not point back to its parent "${nodeId}".`);
      }
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(nodeId);
      walk(childId, depth + 1, nextAncestors);
    }
  };

  for (const rootId of rootIds) {
    const root = nodes[rootId];
    if (!isPlainRecord(root)) {
      push(`Root "${rootId}" is missing from the node map.`);
      continue;
    }
    if (root.parentId !== null) {
      push(`Root "${rootId}" must not have a parent.`);
    }
    walk(rootId, 1, new Set());
  }

  for (const id of nodeIds) {
    if (!seen.has(id)) {
      push(`Element "${id}" is orphaned (not reachable from any root).`);
    }
  }

  return { valid: problems.length === 0, problems };
}

export const ElementTreeSchema = z
  .object({
    rootIds: z.array(z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH)),
    nodes: z.record(z.string().min(1).max(ELEMENT_MAX_STRING_LENGTH), ElementNodeSchema),
  })
  .refine((tree) => validateElementTreeStructure(tree).valid, {
    message: "The element tree failed structural validation.",
  });

export type ValidatedElementTree = z.infer<typeof ElementTreeSchema>;
