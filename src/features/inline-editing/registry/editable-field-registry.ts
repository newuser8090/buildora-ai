// ---------------------------------------------------------------------------
// Editable field registry — the single source of truth for safe fields
//
// Framework-independent (no React, no store). Maps each supported section
// type to its registered safe editable fields. Path templates use "*" as an
// array-index placeholder which is resolved to concrete numeric indices when
// descriptors are built for a live section instance.
//
// Guarantees:
//   - only registered fields are editable
//   - no href / AssetRef / price / id / structural field is ever exposed
//   - malformed props never crash resolution (safe getters throughout)
//   - deterministic output for a given section
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import type { SectionType } from "@/features/editor/section-library/types";
import type {
  EditableFieldDefinition,
  EditableFieldDescriptor,
  FieldPathSegment,
} from "../types";

// ---------------------------------------------------------------------------
// Field definitions per section type
// ---------------------------------------------------------------------------

const HEADER_FIELDS: EditableFieldDefinition[] = [
  { id: "header.logoText", kind: "text", label: "Logo text", path: ["logoText"], maxLength: 120, aiEditable: true },
  { id: "header.navLinks.text", kind: "link-text", label: "Nav link text", path: ["navLinks", "*", "text"], maxLength: 120, aiEditable: true },
  { id: "header.ctaText", kind: "button-text", label: "CTA text", path: ["ctaText"], maxLength: 120, aiEditable: true },
];

const HERO_FIELDS: EditableFieldDefinition[] = [
  { id: "hero.headline", kind: "heading", label: "Headline", path: ["headline"], maxLength: 300, aiEditable: true },
  { id: "hero.subheadline", kind: "description", label: "Subheadline", path: ["subheadline"], maxLength: 600, aiEditable: true },
  { id: "hero.primaryCta.text", kind: "button-text", label: "Primary CTA text", path: ["primaryCta", "text"], maxLength: 120, aiEditable: true },
  { id: "hero.secondaryCta.text", kind: "button-text", label: "Secondary CTA text", path: ["secondaryCta", "text"], maxLength: 120, aiEditable: true },
];

const FEATURES_FIELDS: EditableFieldDefinition[] = [
  { id: "features.title", kind: "heading", label: "Title", path: ["title"], maxLength: 300, aiEditable: true },
  { id: "features.subtitle", kind: "description", label: "Subtitle", path: ["subtitle"], maxLength: 600, aiEditable: true },
  { id: "features.feature.title", kind: "heading", label: "Feature title", path: ["features", "*", "title"], maxLength: 300, aiEditable: true },
  { id: "features.feature.description", kind: "textarea", label: "Feature description", path: ["features", "*", "description"], maxLength: 1200, aiEditable: true },
];

const PRICING_FIELDS: EditableFieldDefinition[] = [
  { id: "pricing.title", kind: "heading", label: "Title", path: ["title"], maxLength: 300, aiEditable: true },
  { id: "pricing.subtitle", kind: "description", label: "Subtitle", path: ["subtitle"], maxLength: 600, aiEditable: true },
  { id: "pricing.plan.name", kind: "heading", label: "Plan name", path: ["plans", "*", "name"], maxLength: 120, aiEditable: true },
  { id: "pricing.plan.description", kind: "textarea", label: "Plan description", path: ["plans", "*", "description"], maxLength: 600, aiEditable: true },
  { id: "pricing.plan.cta", kind: "button-text", label: "Plan CTA text", path: ["plans", "*", "cta"], maxLength: 120, aiEditable: true },
  { id: "pricing.plan.feature", kind: "text", label: "Plan feature", path: ["plans", "*", "features", "*"], maxLength: 300, aiEditable: true },
];

const FAQ_FIELDS: EditableFieldDefinition[] = [
  { id: "faq.title", kind: "heading", label: "Title", path: ["title"], maxLength: 300, aiEditable: true },
  { id: "faq.question", kind: "text", label: "Question", path: ["items", "*", "question"], maxLength: 300, aiEditable: true },
  { id: "faq.answer", kind: "textarea", label: "Answer", path: ["items", "*", "answer"], maxLength: 2000, aiEditable: true },
];

const CTA_FIELDS: EditableFieldDefinition[] = [
  { id: "cta.headline", kind: "heading", label: "Headline", path: ["headline"], maxLength: 300, aiEditable: true },
  { id: "cta.subheadline", kind: "description", label: "Subheadline", path: ["subheadline"], maxLength: 600, aiEditable: true },
  { id: "cta.ctaText", kind: "button-text", label: "CTA text", path: ["ctaText"], maxLength: 120, aiEditable: true },
];

const FOOTER_FIELDS: EditableFieldDefinition[] = [
  { id: "footer.text", kind: "text", label: "Footer text", path: ["text"], maxLength: 600, aiEditable: true },
  { id: "footer.links.text", kind: "link-text", label: "Link text", path: ["links", "*", "text"], maxLength: 120, aiEditable: true },
];

const REGISTRY: Record<SectionType, EditableFieldDefinition[]> = {
  header: HEADER_FIELDS,
  hero: HERO_FIELDS,
  features: FEATURES_FIELDS,
  pricing: PRICING_FIELDS,
  faq: FAQ_FIELDS,
  cta: CTA_FIELDS,
  footer: FOOTER_FIELDS,
};

// ---------------------------------------------------------------------------
// Safe path helpers
// ---------------------------------------------------------------------------

/**
 * Read a value at a path without ever throwing. Missing intermediate objects
 * resolve to undefined. Used by the registry to derive current values.
 */
export function getValueAtPath(
  props: Record<string, unknown> | unknown[] | unknown,
  path: FieldPathSegment[],
): unknown {
  let current: unknown = props;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined;
      if (segment < 0 || segment >= current.length) return undefined;
      current = current[segment];
    } else {
      if (typeof current !== "object" || Array.isArray(current)) return undefined;
      const record = current as Record<string, unknown>;
      // Prototype pollution guard — never traverse inherited props.
      if (!Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
      current = record[segment];
    }
  }
  return current;
}

/** Read a string value at a path, or undefined when not a string. */
export function getStringValueAtPath(
  props: Record<string, unknown>,
  path: FieldPathSegment[],
): string | undefined {
  const value = getValueAtPath(props, path);
  return typeof value === "string" ? value : undefined;
}

/**
 * Enumerate concrete index positions for a path template's "*" placeholders
 * by walking the actual props. Returns an array of index tuples, one per
 * concrete path the template matches against the live data.
 */
function enumerateIndices(
  props: unknown,
  template: string[],
): FieldPathSegment[][] {
  const results: FieldPathSegment[][] = [];
  const walk = (
    node: unknown,
    templateIndex: number,
    prefix: FieldPathSegment[],
  ): void => {
    if (templateIndex === template.length) {
      results.push(prefix);
      return;
    }
    const segment = template[templateIndex];
    if (segment === "*") {
      if (!Array.isArray(node)) return;
      for (let i = 0; i < node.length; i += 1) {
        walk(node[i], templateIndex + 1, [...prefix, i]);
      }
      return;
    }
    if (node === null || node === undefined || typeof node !== "object") return;
    if (Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return;
    walk(record[segment], templateIndex + 1, [...prefix, segment]);
  };
  walk(props, 0, []);
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return the registered field definitions for a section type (empty for unknown). */
export function getFieldDefinitions(sectionType: string): EditableFieldDefinition[] {
  return REGISTRY[sectionType as SectionType] ?? [];
}

/** True when the section type has at least one registered editable field. */
export function hasEditableFields(sectionType: string): boolean {
  return getFieldDefinitions(sectionType).length > 0;
}

/** True when a concrete field path matches a registered definition. */
export function isSupportedFieldPath(
  sectionType: string,
  fieldPath: FieldPathSegment[],
): boolean {
  return getFieldDefinitions(sectionType).some((def) => {
    if (def.path.length !== fieldPath.length) return false;
    return def.path.every((segment, i) => {
      if (segment === "*") return typeof fieldPath[i] === "number";
      return fieldPath[i] === segment;
    });
  });
}

/**
 * Build concrete descriptors for a live section instance. Deterministic;
 * malformed or missing data simply yields fewer descriptors.
 */
export function buildDescriptors(
  pageId: string,
  section: BaseSection,
): EditableFieldDescriptor[] {
  const definitions = getFieldDefinitions(section.type);
  if (definitions.length === 0) return [];

  const props = section.props ?? {};
  const descriptors: EditableFieldDescriptor[] = [];

  for (const def of definitions) {
    const hasArrayIndex = def.path.includes("*");
    if (!hasArrayIndex) {
      const value = getStringValueAtPath(props, def.path as string[]);
      if (value === undefined) continue;
      descriptors.push({
        pageId,
        sectionId: section.id,
        sectionType: section.type as SectionType,
        fieldPath: def.path,
        kind: def.kind,
        label: def.label,
        currentValue: value,
        maxLength: def.maxLength,
        aiEditable: def.aiEditable,
      });
      continue;
    }

    // Array field — enumerate concrete index tuples.
    const tuples = enumerateIndices(props, def.path);
    for (const path of tuples) {
      const value = getStringValueAtPath(props, path);
      if (value === undefined) continue;
      descriptors.push({
        pageId,
        sectionId: section.id,
        sectionType: section.type as SectionType,
        fieldPath: path,
        kind: def.kind,
        label: def.label,
        currentValue: value,
        maxLength: def.maxLength,
        aiEditable: def.aiEditable,
      });
    }
  }

  return descriptors;
}

/**
 * Build a descriptor from a stable field id plus concrete indices for the
 * template's "*" placeholders (e.g. features.feature.title with index 2 →
 * path ["features", 2, "title"]). Multiple indices are consumed in order by
 * the "*" placeholders (e.g. pricing.plan.feature with [1, 3] → path
 * ["plans", 1, "features", 3]). Returns null when the field is unknown or
 * the current value is not a string.
 */
export function buildDescriptorFromFieldId(
  pageId: string,
  section: BaseSection,
  fieldId: string,
  index?: number | number[],
): EditableFieldDescriptor | null {
  const def = getFieldDefinitions(section.type).find((d) => d.id === fieldId);
  if (!def) return null;

  const indices = Array.isArray(index) ? index : index !== undefined ? [index] : [];
  let i = 0;
  const path = def.path.map((segment) =>
    segment === "*" ? (indices[i++] ?? 0) : segment,
  );
  return resolveDescriptor(pageId, section, path);
}

/**
 * Resolve a single descriptor for a concrete field path, or null when the
 * path is not a registered safe field or the value is not a string.
 */
export function resolveDescriptor(
  pageId: string,
  section: BaseSection,
  fieldPath: FieldPathSegment[],
): EditableFieldDescriptor | null {
  const definitions = getFieldDefinitions(section.type);
  if (definitions.length === 0) return null;

  const def = definitions.find((d) => {
    if (d.path.length !== fieldPath.length) return false;
    return d.path.every((segment, i) => {
      if (segment === "*") return typeof fieldPath[i] === "number";
      return fieldPath[i] === segment;
    });
  });
  if (!def) return null;

  const value = getStringValueAtPath(section.props ?? {}, fieldPath);
  if (value === undefined) return null;

  return {
    pageId,
    sectionId: section.id,
    sectionType: section.type as SectionType,
    fieldPath,
    kind: def.kind,
    label: def.label,
    currentValue: value,
    maxLength: def.maxLength,
    aiEditable: def.aiEditable,
  };
}
