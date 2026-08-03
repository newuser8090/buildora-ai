// ---------------------------------------------------------------------------
// Section library — filtering utilities
//
// Pure functions. No React, no browser, no persistence.
// ---------------------------------------------------------------------------

import type {
  SectionLibraryCategory,
  SectionLibraryDefinition,
} from "../types";

export interface SectionLibraryFilter {
  query?: string;
  category?: SectionLibraryCategory | "all";
}

const CATEGORY_LABELS: Record<SectionLibraryCategory, string> = {
  navigation: "Navigation",
  hero: "Hero",
  content: "Content",
  commerce: "Commerce",
  conversion: "Conversion",
  footer: "Footer",
};

export function categoryLabel(category: SectionLibraryCategory): string {
  return CATEGORY_LABELS[category];
}

export const SECTION_CATEGORIES: SectionLibraryCategory[] = [
  "navigation",
  "hero",
  "content",
  "commerce",
  "conversion",
  "footer",
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Filter definitions by a free-text query (matched against name, description,
 * and keywords) and/or a category. A missing/blank query matches everything.
 * Deterministic: preserves input order.
 */
export function filterSectionDefinitions(
  definitions: SectionLibraryDefinition[],
  filter: SectionLibraryFilter,
): SectionLibraryDefinition[] {
  const query = normalize(filter.query ?? "");

  return definitions.filter((definition) => {
    if (filter.category && filter.category !== "all") {
      if (definition.category !== filter.category) return false;
    }

    if (query) {
      const haystack = normalize(
        [
          definition.name,
          definition.description,
          ...definition.keywords,
        ].join(" "),
      );
      // Match against every whitespace-separated query token so "landing
      // page" matches a definition containing both words.
      const tokens = query.split(/\s+/);
      const matches = tokens.every((token) => haystack.includes(token));
      if (!matches) return false;
    }

    return true;
  });
}

export function searchSectionDefinitions(
  definitions: SectionLibraryDefinition[],
  query: string,
): SectionLibraryDefinition[] {
  return filterSectionDefinitions(definitions, { query });
}
