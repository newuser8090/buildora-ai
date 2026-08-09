// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — asset collector
//
// Determines the set of assets to package: the typed per-section collector
// (collectReferencedAssetIds) UNION a defensive recursive scan for any object
// shaped like an AssetRef ({ assetId: string }) across the project, intersected
// with the assets actually present in project.assets.
//
// "Only referenced assets" — unreferenced assets and dangling refs are dropped.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { collectReferencedAssetIds } from "@/features/assets/services/reference-analyzer";

/** Cap on recursive scan depth (project props are free-form). */
const MAX_SCAN_DEPTH = 16;

/**
 * Recursively collect every string `assetId` that looks like an AssetRef:
 * an object with a string-valued `assetId` property. Bounded by depth.
 */
function collectAssetRefsDeep(value: unknown, depth: number, out: Set<string>): void {
  if (value === null || typeof value !== "object" || depth > MAX_SCAN_DEPTH) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAssetRefsDeep(item, depth + 1, out);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.assetId === "string" && record.assetId.length > 0) {
    out.add(record.assetId);
  }
  for (const key of Object.keys(record)) {
    if (key === "assetId") continue; // already collected
    collectAssetRefsDeep(record[key], depth + 1, out);
  }
}

/**
 * Collect the ids of assets referenced by the project (typed mapping + defensive
 * scan), restricted to assets that actually exist in project.assets.
 */
export function collectPackagedAssetIds(project: Project): Set<string> {
  const referenced = collectReferencedAssetIds(project);

  // Defensive scan covers any AssetRef the typed mapping does not know about
  // (e.g. site settings images, future section types).
  const deep = new Set<string>();
  collectAssetRefsDeep(project, 0, deep);
  for (const id of deep) {
    referenced.add(id);
  }

  // Only assets that exist in the project are packable.
  const owned = new Set(project.assets.map((a) => a.id));
  const result = new Set<string>();
  for (const id of referenced) {
    if (owned.has(id)) result.add(id);
  }
  return result;
}
