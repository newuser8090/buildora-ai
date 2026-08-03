// ---------------------------------------------------------------------------
// filterTemplates — pure, deterministic template search + category filter
// ---------------------------------------------------------------------------

import type { BuildoraTemplate, TemplateCategory } from "../types";

export interface TemplateFilterOptions {
  /** Case-insensitive query against name, description, tags, and category. */
  search?: string;
  /** Optional category filter. Omit or use "all" for no filter. */
  category?: TemplateCategory | "all";
}

/**
 * Filter templates by a trimmed, case-insensitive query combined with an
 * optional category filter. Never mutates the input array.
 *
 * Empty/whitespace-only query restores all templates (within the category).
 */
export function filterTemplates(
  templates: BuildoraTemplate[],
  options: TemplateFilterOptions = {},
): BuildoraTemplate[] {
  const query = (options.search ?? "").trim().toLowerCase();
  const category = options.category ?? "all";

  return templates.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    if (!query) return true;

    const haystack = [t.name, t.description, t.category, ...t.tags]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });
}

/** The distinct categories present in a template list (excluding blank). */
export function templateCategories(
  templates: BuildoraTemplate[],
): TemplateCategory[] {
  const seen = new Set<TemplateCategory>();
  for (const t of templates) {
    if (t.category !== "blank") seen.add(t.category);
  }
  return Array.from(seen);
}
