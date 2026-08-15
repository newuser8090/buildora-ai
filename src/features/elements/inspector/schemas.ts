// ---------------------------------------------------------------------------
// Inspector schema registry (Phase P22-C) — pure, deterministic
//
// Resolves the applicable inspector schema for ANY element type from the
// capability map + shared field factories + the element registry definition.
// No bespoke per-type editors: a type gets content/typography when it is
// text-capable, content when it is media-capable, and always gets
// appearance/layout/spacing/advanced.
// ---------------------------------------------------------------------------

import { elementRegistry } from "../registry/element-registry";
import type { ElementType } from "../types";
import type { ElementDefinition } from "../types";
import { capabilitiesForType, CONTAINER_CAPABLE_TYPES } from "./capabilities";
import {
  advancedFields,
  animationField,
  appearanceFields,
  bindingField,
  contentFields,
  interactionField,
  layoutFields,
  spacingFields,
  typographyFields,
} from "./fields";
import type { ElementInspectorSchema, InspectorSectionDef } from "./types";

const SCHEMA_CACHE = new Map<string, ElementInspectorSchema>();

/** Build the sections for a set of capabilities. */
function buildSections(
  definition: ElementDefinition | undefined,
  type: ElementType,
): InspectorSectionDef[] {
  const capabilities = capabilitiesForType(type, definition);
  const sections: InspectorSectionDef[] = [];

  if (capabilities.includes("content")) {
    const fields = contentFields(definition?.editableFields ?? [], type);
    if (fields.length > 0) {
      sections.push({ id: "content", label: "Content", fields });
    }
  }
  if (capabilities.includes("typography")) {
    sections.push({ id: "typography", label: "Typography", fields: typographyFields() });
  }
  if (capabilities.includes("appearance")) {
    sections.push({ id: "appearance", label: "Appearance", fields: appearanceFields() });
  }
  if (capabilities.includes("layout")) {
    sections.push({
      id: "layout",
      label: "Layout",
      fields: layoutFields(CONTAINER_CAPABLE_TYPES.has(type), type === "grid"),
    });
  }
  if (capabilities.includes("spacing")) {
    sections.push({ id: "spacing", label: "Spacing", fields: spacingFields() });
  }
  sections.push({ id: "advanced", label: "Advanced", fields: advancedFields() });
  // Phase P22-G — animation + interactions are universal groups (every
  // element can carry the declarative model); they sit last so the first
  // section keeps its default-open behavior.
  sections.push({ id: "animation", label: "Animation", fields: [animationField()] });
  sections.push({ id: "interactions", label: "Interactions", fields: [interactionField()] });
  // Phase P22-J — data binding is a universal group (every element can carry
  // the declarative binding model).
  sections.push({ id: "data", label: "Data", fields: [bindingField()] });
  return sections;
}

/**
 * Resolve the inspector schema for an element type. Deterministic and cached
 * per type; falls back to the universal groups for unknown types (registry
 * safety — the UI can never crash on an unregistered type).
 */
export function getInspectorSchema(type: ElementType): ElementInspectorSchema {
  const cached = SCHEMA_CACHE.get(type);
  if (cached) return cached;

  const definition = elementRegistry.get(type);
  const label = definition?.label ?? type;
  const schema: ElementInspectorSchema = {
    elementType: type,
    label,
    sections: buildSections(definition, type),
  };
  SCHEMA_CACHE.set(type, schema);
  return schema;
}

/** Clear the schema cache (tests). */
export function clearInspectorSchemaCache(): void {
  SCHEMA_CACHE.clear();
}
