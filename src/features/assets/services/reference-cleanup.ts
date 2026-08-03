// ---------------------------------------------------------------------------
// Asset Reference Cleanup
//
// Pure function that returns an updated project with all references to a
// given asset removed. The original project is not mutated.
//
// This powers the reference-safe deletion in the editor store.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { AssetRef } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Typed field mapping (mirrors reference-analyzer.ts)
//
// This mapping is duplicated intentionally to keep the cleanup module
// self-contained and free of circular dependencies.
// ---------------------------------------------------------------------------

interface CleanupFieldMapping {
  field: string;
  itemField?: string;
  isArray?: boolean;
}

const ASSET_FIELDS: Record<string, CleanupFieldMapping[]> = {
  header: [{ field: "logoImage" }],
  hero: [{ field: "heroImage" }, { field: "backgroundImage" }],
  features: [{ field: "features", itemField: "iconImage", isArray: true }],
  cta: [{ field: "backgroundImage" }],
  footer: [{ field: "logoImage" }],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return a deep-cloned project with all references to `assetId` cleared.
 *
 * Rules:
 * - Direct AssetRef fields are deleted entirely (not set to null/undefined).
 * - Array item AssetRef fields are deleted from their parent item.
 * - All unrelated section props are preserved.
 * - The original project is never mutated.
 */
export function clearAssetReferences(project: Project, assetId: string): Project {
  const updated: Project = JSON.parse(JSON.stringify(project));

  for (const page of updated.pages || []) {
    for (const section of page.sections || []) {
      const mappings = ASSET_FIELDS[section.type];
      if (!mappings) continue;

      for (const mapping of mappings) {
        if (mapping.isArray && mapping.itemField) {
          // Scan array items for matching AssetRef
          const items = section.props[mapping.field] as Array<Record<string, unknown>> | undefined;
          if (!items || !Array.isArray(items)) continue;

          for (const item of items) {
            const ref = item[mapping.itemField] as AssetRef | undefined;
            if (ref?.assetId === assetId) {
              delete item[mapping.itemField];
            }
          }
        } else {
          // Direct AssetRef field
          const ref = section.props[mapping.field] as AssetRef | undefined;
          if (ref?.assetId === assetId) {
            delete section.props[mapping.field];
          }
        }
      }
    }
  }

  return updated;
}
