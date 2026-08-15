// ---------------------------------------------------------------------------
// Inspector capabilities (Phase P22-C) — which control groups each type gets
//
// One deterministic map from element type → capability groups. New element
// types are supported by editing THIS map (or adding registry editableFields)
// — never by writing a bespoke inspector. Elements not listed still receive
// the universal appearance/layout/spacing/advanced groups.
// ---------------------------------------------------------------------------

import type { ElementDefinition } from "../types";

/** Element types whose style surface is text-first (typography group). */
export const TYPOGRAPHY_CAPABLE_TYPES = new Set<string>([
  "heading",
  "paragraph",
  "button",
  "badge",
  "text",
  "price",
  "list",
  "menu",
]);

/** Element types that carry an image source (content group: src/alt). */
export const IMAGE_CAPABLE_TYPES = new Set<string>([
  "image",
  "video",
  "logo",
]);

/** Container-like types that expose flex-direction in Layout. */
export const CONTAINER_CAPABLE_TYPES = new Set<string>([
  "container",
  "column",
  "stack",
  "row",
  "grid",
  "card",
  "feature-card",
  "faq-item",
  "pricing-card",
  "review-card",
  "team-member",
  "navbar",
  "footer",
  "form",
  "tabs",
  "accordion",
  "section",
  "carousel",
  "product-card",
  "custom-component",
  "custom-block",
  "hero",
  "header",
  "features",
  "pricing",
  "faq",
  "cta",
]);

export type InspectorCapability =
  | "content"
  | "typography"
  | "appearance"
  | "layout"
  | "spacing"
  | "advanced";

/**
 * Resolve the capability groups for an element type (deterministic).
 * The registry definition is optional but lets content detection follow the
 * declared editableFields (text-capable blocks get a Content section).
 */
export function capabilitiesForType(
  type: string,
  definition?: ElementDefinition,
): InspectorCapability[] {
  const capabilities: InspectorCapability[] = [
    "appearance",
    "layout",
    "spacing",
    "advanced",
  ];
  if (TYPOGRAPHY_CAPABLE_TYPES.has(type)) {
    capabilities.unshift("typography");
  }
  const hasEditableContent = (definition?.editableFields?.length ?? 0) > 0;
  if (IMAGE_CAPABLE_TYPES.has(type) || hasEditableContent) {
    capabilities.unshift("content");
  }
  return capabilities;
}
