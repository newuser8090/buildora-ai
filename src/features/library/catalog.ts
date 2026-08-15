// ---------------------------------------------------------------------------
// Element Library (Phase P22-D) — catalog
//
// Centralized, registry-driven catalogue of every library item. The single
// source of truth is the Phase P22-A element registry (which derives block
// types from the Phase O block registry), so the library can never drift from
// what the builder can actually render and persist.
//
// Element-only types (text, logo, list, carousel, product-card, price,
// custom-component, section) are deliberately NOT exposed: they have no
// renderer and no custom-block persistence path yet, so inserting them would
// produce non-functional content. Only block types have a valid path today.
//
// Pure and framework-independent (no React, no DOM, no store).
// ---------------------------------------------------------------------------

import { elementRegistry } from "@/features/elements/registry/element-registry";
import { isElementOnlyType } from "@/features/elements/types";
import type { BlockType } from "@/features/blocks/types";
import type {
  LibraryCategory,
  LibraryCategoryId,
  LibraryItem,
} from "./types";

// ---------------------------------------------------------------------------
// Categories — friendly labels over the element-registry category values
// ---------------------------------------------------------------------------

export const LIBRARY_CATEGORIES: readonly LibraryCategory[] = [
  { id: "layout", label: "Layout", description: "Structure & containers" },
  { id: "content", label: "Content", description: "Text, buttons, media" },
  { id: "interactive", label: "Interactive", description: "Forms & controls" },
  { id: "composite", label: "Cards", description: "Ready-made card layouts" },
  { id: "navigation", label: "Navigation", description: "Menus & page chrome" },
];

const CATEGORY_IDS = new Set<string>(LIBRARY_CATEGORIES.map((c) => c.id));

/** Map a registry category to a library category id (or null when ungrouped). */
export function libraryCategoryOf(category: string): LibraryCategoryId | null {
  return CATEGORY_IDS.has(category)
    ? (category as LibraryCategoryId)
    : null;
}

export function libraryCategoryLabel(id: LibraryCategoryId): string {
  return (
    LIBRARY_CATEGORIES.find((c) => c.id === id)?.label ?? id
  );
}

// ---------------------------------------------------------------------------
// Plain-language synonyms (same pattern as the block browser)
// ---------------------------------------------------------------------------

const SYNONYMS: Record<string, string[]> = {
  button: ["action", "cta", "click", "get started"],
  heading: ["title", "headline", "main message", "text"],
  paragraph: ["description", "body", "copy", "text"],
  image: ["photo", "picture", "visual"],
  video: ["player", "embed", "youtube"],
  "pricing-card": ["pricing", "plan", "price", "cost"],
  "review-card": ["review", "testimonial", "customer", "trust"],
  "faq-item": ["faq", "question", "answer"],
  navbar: ["nav", "navigation", "menu", "header", "top"],
  footer: ["bottom", "contact", "copyright"],
  menu: ["links", "list"],
  card: ["panel", "box"],
  form: ["contact form", "fields", "inputs"],
  accordion: ["collapsible", "questions", "expand"],
  tabs: ["tabbed", "switch"],
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * Build the library catalogue from the element registry. Deterministic
 * (registry order) and additive — new registered block types appear
 * automatically. Element-only types are excluded (no valid path yet).
 */
export function buildLibraryCatalog(): LibraryItem[] {
  const items: LibraryItem[] = [];
  for (const type of elementRegistry.types) {
    if (isElementOnlyType(type)) continue;
    const definition = elementRegistry.get(type);
    if (!definition) continue;
    const category = libraryCategoryOf(definition.category);
    if (!category) continue;
    items.push({
      type: definition.type as BlockType,
      label: definition.label,
      description: definition.description,
      iconKey: definition.iconKey,
      category,
      keywords: definition.keywords,
      beginnerFriendly: definition.beginnerFriendly ?? false,
      canHaveChildren: definition.canHaveChildren,
    });
  }
  return items;
}

/**
 * Does the item match a free-text query? Matches label, description,
 * keywords, type, and plain-language synonyms (case-insensitive).
 */
export function matchesLibraryQuery(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = [
    item.label,
    item.description,
    item.type,
    ...item.keywords,
    ...(SYNONYMS[item.type] ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export interface LibraryFilter {
  category: LibraryCategoryId | "all";
  query: string;
}

/**
 * Filter the catalog by category + free-text query. Deterministic: catalog
 * order is preserved. Empty query and "all" category are no-ops.
 */
export function filterLibraryItems(
  items: LibraryItem[],
  filter: LibraryFilter,
): LibraryItem[] {
  const { category, query } = filter;
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    return matchesLibraryQuery(item, query);
  });
}
