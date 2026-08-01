// ---------------------------------------------------------------------------
// filterProjects — pure utility for filtering projects by search query
// ---------------------------------------------------------------------------

import type { DashboardProject } from "../types";

/**
 * Filter projects by a case-insensitive search query.
 * Does not mutate the input array.
 */
export function filterProjects(
  projects: DashboardProject[],
  query: string,
): DashboardProject[] {
  const trimmed = query.trim();
  if (!trimmed) return projects;

  const lower = trimmed.toLowerCase();
  return projects.filter((p) => p.name.toLowerCase().includes(lower));
}
