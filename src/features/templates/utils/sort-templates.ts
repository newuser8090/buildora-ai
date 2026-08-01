// ---------------------------------------------------------------------------
// sortTemplates — pure, deterministic template ordering
//
// Documented default order:
//   1. Blank template first (always easy to find)
//   2. Featured templates
//   3. sortOrder ascending (undefined treated as a large value)
//   4. template name ascending
//   5. template ID ascending (final deterministic tie-breaker)
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";

export function sortTemplates(templates: BuildoraTemplate[]): BuildoraTemplate[] {
  return [...templates].sort((a, b) => {
    // 1. Blank first
    const aBlank = a.category === "blank" ? 0 : 1;
    const bBlank = b.category === "blank" ? 0 : 1;
    if (aBlank !== bBlank) return aBlank - bBlank;

    // 2. Featured next
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;

    // 3. sortOrder ascending
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // 4. Name ascending
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;

    // 5. ID tie-breaker
    return a.id.localeCompare(b.id);
  });
}

/** Featured templates, in sort order. */
export function featuredTemplates(templates: BuildoraTemplate[]): BuildoraTemplate[] {
  return sortTemplates(templates).filter((t) => t.featured);
}
