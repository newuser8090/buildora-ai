// ---------------------------------------------------------------------------
// Section library — sorting utilities
//
// Deterministic ordering for the library UI. Pure, framework-independent.
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

/**
 * Sort definitions deterministically:
 *   1. explicit sortOrder (defaults to a high value so unspecified sorts last)
 *   2. recommendedPosition order (top < middle < bottom) as a tie-breaker
 *   3. name, alphabetically, as a final stable tie-breaker
 *
 * Does NOT mutate the input array.
 */
export function sortSectionDefinitions(
  definitions: SectionLibraryDefinition[],
): SectionLibraryDefinition[] {
  const POSITION_ORDER: Record<string, number> = {
    top: 0,
    middle: 1,
    bottom: 2,
  };

  return [...definitions].sort((a, b) => {
    const aOrder = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bOrder = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;

    const aPos = POSITION_ORDER[a.recommendedPosition ?? "middle"] ?? 1;
    const bPos = POSITION_ORDER[b.recommendedPosition ?? "middle"] ?? 1;
    if (aPos !== bPos) return aPos - bPos;

    return a.name.localeCompare(b.name);
  });
}
