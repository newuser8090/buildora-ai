// ---------------------------------------------------------------------------
// sortProjects — pure utility for sorting projects by sort mode
// Does not mutate the input array.
// ---------------------------------------------------------------------------

import type { DashboardProject, ProjectSortMode } from "../types";

/**
 * Sort projects by the given sort mode.
 *
 * Order:
 *   1. Pinned projects first (for every sort mode)
 *   2. By the requested sort mode
 *   3. Deterministic tie-breaker: project ID ascending
 *
 * Returns a new sorted array (does not mutate input).
 */
export function sortProjects(
  projects: DashboardProject[],
  sortMode: ProjectSortMode,
): DashboardProject[] {
  const sorted = [...projects];

  sorted.sort((a, b) => {
    // Pinned first
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    // Primary sort
    const primary = compareBySortMode(a, b, sortMode);
    if (primary !== 0) return primary;

    // Deterministic tie-breaker: project ID ascending
    return a.id.localeCompare(b.id);
  });

  return sorted;
}

function compareBySortMode(
  a: DashboardProject,
  b: DashboardProject,
  sortMode: ProjectSortMode,
): number {
  switch (sortMode) {
    case "last-edited": {
      const aTime = new Date(a.updatedAt).getTime();
      const bTime = new Date(b.updatedAt).getTime();
      // NaN-safe: treat invalid dates as epoch
      return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
    }
    case "recently-created": {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
    }
    case "name-asc":
      return a.name.localeCompare(b.name);
    case "name-desc":
      return b.name.localeCompare(a.name);
    default:
      return 0;
  }
}
