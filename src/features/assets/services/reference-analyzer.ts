// ---------------------------------------------------------------------------
// Asset Reference Analyzer
//
// Scans all pages and section props for asset references using explicit,
// typed field mappings per section type. This ensures schema changes are
// predictable and safe — no arbitrary string matching on object fields.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { AssetRef } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AssetUsageReference {
  pageId: string;
  pageName?: string;
  sectionId: string;
  sectionType: string;
  /** The prop field containing the AssetRef, e.g. "logoImage" */
  field: string;
  /** For array fields like features[i].iconImage, the index in the array */
  itemIndex?: number;
}

export interface ReferenceAnalysisOptions {
  /** Only count references in visible sections */
  visibleOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Typed field mapping — each section type explicitly declares which props
// contain AssetRef values.
//
// To add a new asset-supporting field in a future sprint:
//   1. Add the field to the section's TypeScript interface
//   2. Add a mapping entry here
//   3. Add it to the Zod schema
// ---------------------------------------------------------------------------

interface AssetFieldMapping {
  /** Top-level prop key, e.g. "logoImage" */
  field: string;
  /** For array fields: the key inside each array item, e.g. "iconImage" */
  itemField?: string;
  /** Whether the field contains an array of items with nested AssetRefs */
  isArray?: boolean;
}

const SECTION_ASSET_FIELDS: Record<string, AssetFieldMapping[]> = {
  header: [
    { field: "logoImage" },
  ],
  hero: [
    { field: "heroImage" },
    { field: "backgroundImage" },
  ],
  features: [
    { field: "features", itemField: "iconImage", isArray: true },
  ],
  cta: [
    { field: "backgroundImage" },
  ],
  footer: [
    { field: "logoImage" },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a value looks like a valid AssetRef object. */
function isValidAssetRef(value: unknown): value is AssetRef {
  if (!value || typeof value !== "object") return false;
  return typeof (value as AssetRef).assetId === "string";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Find all references to a specific asset across the project.
 * Returns structured references with page, section, and field info.
 */
export function findAssetReferences(
  project: Project,
  assetId: string,
  options?: ReferenceAnalysisOptions,
): AssetUsageReference[] {
  const results: AssetUsageReference[] = [];

  for (const page of project.pages || []) {
    for (const section of page.sections || []) {
      // Skip invisible sections if options says so
      if (options?.visibleOnly && section.visible === false) continue;

      const mappings = SECTION_ASSET_FIELDS[section.type];
      if (!mappings) continue;

      for (const mapping of mappings) {
        if (mapping.isArray) {
          // Scan array items for matching asset ref
          const items = section.props[mapping.field] as Array<Record<string, unknown>> | undefined;
          if (!items || !Array.isArray(items)) continue;

          for (let i = 0; i < items.length; i++) {
            const ref = items[i]?.[mapping.itemField!];
            if (isValidAssetRef(ref) && (ref as AssetRef).assetId === assetId) {
              results.push({
                pageId: page.id,
                pageName: page.title,
                sectionId: section.id,
                sectionType: section.type,
                field: `${mapping.field}[${i}].${mapping.itemField}`,
                itemIndex: i,
              });
            }
          }
        } else {
          // Direct AssetRef field
          const ref = section.props[mapping.field];
          if (isValidAssetRef(ref) && (ref as AssetRef).assetId === assetId) {
            results.push({
              pageId: page.id,
              pageName: page.title,
              sectionId: section.id,
              sectionType: section.type,
              field: mapping.field,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Count the number of times an asset is referenced in the project.
 */
export function getAssetUsageCount(
  project: Project,
  assetId: string,
  options?: ReferenceAnalysisOptions,
): number {
  return findAssetReferences(project, assetId, options).length;
}

/**
 * Get a human-readable summary of asset usage, grouped by section type.
 */
export function getAssetUsageSummary(
  project: Project,
  assetId: string,
  options?: ReferenceAnalysisOptions,
): { sectionType: string; count: number; field: string }[] {
  const refs = findAssetReferences(project, assetId, options);
  const summary = new Map<string, { sectionType: string; count: number; field: string }>();

  for (const ref of refs) {
    const key = `${ref.sectionType}:${ref.field}`;
    const existing = summary.get(key);
    if (existing) {
      existing.count++;
    } else {
      summary.set(key, { sectionType: ref.sectionType, count: 1, field: ref.field });
    }
  }

  return Array.from(summary.values());
}

/**
 * Collect all unique asset IDs referenced across the project.
 * Supports filtering to only visible sections (for export).
 */
export function collectReferencedAssetIds(
  project: Project,
  options?: ReferenceAnalysisOptions & { includePages?: boolean },
): Set<string> {
  const ids = new Set<string>();

  for (const page of project.pages || []) {
    for (const section of page.sections || []) {
      if (options?.visibleOnly && section.visible === false) continue;

      const mappings = SECTION_ASSET_FIELDS[section.type];
      if (!mappings) continue;

      for (const mapping of mappings) {
        if (mapping.isArray) {
          const items = section.props[mapping.field] as Array<Record<string, unknown>> | undefined;
          if (!items || !Array.isArray(items)) continue;
          for (const item of items) {
            const ref = item?.[mapping.itemField!];
            if (isValidAssetRef(ref)) {
              ids.add((ref as AssetRef).assetId);
            }
          }
        } else {
          const ref = section.props[mapping.field];
          if (isValidAssetRef(ref)) {
            ids.add((ref as AssetRef).assetId);
          }
        }
      }
    }
  }

  return ids;
}
