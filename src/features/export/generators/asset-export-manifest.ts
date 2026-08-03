// ---------------------------------------------------------------------------
// Asset Export Manifest
//
// Builds a deterministic manifest of all assets referenced by visible
// exported sections, validates their data URLs, and generates OutputFile
// entries for the ZIP.
//
// Recoverable warnings:
//   - Hero content image (heroImage) missing AssetRef with a valid legacy
//     `image` URL: allows fallback, does not block export.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { OutputFile } from "../pipeline/types";
import type { Asset } from "@/features/assets/types";
import { collectReferencedAssetIds } from "@/features/assets/services/reference-analyzer";
import { buildFilenameMap } from "@/features/assets/utils/filename-collision";
import { validateDataUrl, matchesMimeType, extractBase64 } from "@/features/assets/utils/data-url-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportAssetEntry {
  /** Stable asset ID from the project */
  assetId: string;
  /** The full Asset record */
  asset: Asset;
  /** Sanitised, collision-free filename for ZIP (e.g. "logo.png") */
  filename: string;
  /** Public path for generated code references (e.g. "/assets/logo.png") */
  publicPath: string;
}

export interface ExportAssetManifest {
  /** Ordered list of all exported assets */
  entries: ExportAssetEntry[];
  /** Quick lookup: assetId → ExportAssetEntry */
  byAssetId: Map<string, ExportAssetEntry>;
  /** Blocking errors — export cannot proceed */
  errors: string[];
  /** Non-blocking warnings — export can proceed with fallback */
  warnings: string[];
  /** Whether the manifest can be used for export (true when no blocking errors) */
  valid: boolean;
}

// ---------------------------------------------------------------------------
// Supported MIME types for export
// ---------------------------------------------------------------------------

const SUPPORTED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

// ---------------------------------------------------------------------------
// Build manifest
// ---------------------------------------------------------------------------

/**
 * Build an export asset manifest from a project.
 *
 * Steps:
 * 1. Collect referenced asset IDs from visible sections only
 * 2. Look up each asset in project.assets
 * 3. Validate data URL, MIME type, and payload
 * 4. Generate deterministic filenames (handles collisions)
 * 5. Build public paths
 *
 * Does not mutate the project.
 *
 * Recoverable errors: A missing Hero content image (heroImage) reference
 * is treated as a warning (not a blocking error) when the section also
 * has a valid legacy `image` URL. The page generator will fall back to it.
 */
export function buildExportAssetManifest(project: Project): ExportAssetManifest {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Collect referenced asset IDs (visible sections only)
  const referencedIds = collectReferencedAssetIds(project, { visibleOnly: true });

  // Pre-scan for Hero sections that have a legacy `image` fallback
  const heroContentFallbackIds = findRecoverableHeroRefs(project);

  // 2. Look up assets and validate
  const assetEntries: { id: string; asset: Asset }[] = [];

  for (const assetId of referencedIds) {
    const asset = project.assets?.find((a) => a.id === assetId);
    if (!asset) {
      // Missing referenced asset
      if (heroContentFallbackIds.has(assetId)) {
        // Recoverable: Hero content image with legacy URL fallback
        warnings.push(
          `Hero content image "${assetId}" not found. Falling back to legacy image URL.`,
        );
      } else {
        // Blocking: no fallback available
        errors.push(`Referenced asset "${assetId}" not found in project.assets.`);
      }
      continue;
    }

    // Validate data URL
    const source = asset.source;
    if (source.type !== "data-url") {
      errors.push(`Asset "${asset.id}" ("${asset.name}"): only data-url sources are supported for export.`);
      continue;
    }

    const validation = validateDataUrl(source.value);
    if (!validation.valid) {
      errors.push(
        `Asset "${asset.id}" ("${asset.name}"): invalid data URL — ${validation.error}`,
      );
      continue;
    }

    // Validate MIME type
    if (!SUPPORTED_MIME_TYPES.includes(asset.mimeType)) {
      errors.push(
        `Asset "${asset.id}" ("${asset.name}"): unsupported MIME type "${asset.mimeType}". ` +
        `Supported: ${SUPPORTED_MIME_TYPES.join(", ")}`,
      );
      continue;
    }

    // Verify MIME matches the data URL
    if (!matchesMimeType(source.value, asset.mimeType)) {
      errors.push(
        `Asset "${asset.id}" ("${asset.name}"): MIME type "${asset.mimeType}" does not match data URL content.`,
      );
      continue;
    }

    // Verify base64 extraction works
    const base64 = extractBase64(source.value);
    if (!base64) {
      errors.push(
        `Asset "${asset.id}" ("${asset.name}"): cannot extract base64 payload from data URL.`,
      );
      continue;
    }

    assetEntries.push({ id: assetId, asset });
  }

  // 3. Generate deterministic filenames
  const filenameMap = buildFilenameMap(assetEntries.map((e) => ({ id: e.id, name: e.asset.name })));

  // 4. Build entries
  const entries: ExportAssetEntry[] = assetEntries.map(({ id, asset }) => {
    const filename = filenameMap.get(id) || "file.bin";
    return {
      assetId: id,
      asset,
      filename,
      publicPath: `/assets/${filename}`,
    };
  });

  // 5. Build lookup map
  const byAssetId = new Map<string, ExportAssetEntry>();
  for (const entry of entries) {
    byAssetId.set(entry.assetId, entry);
  }

  return {
    entries,
    byAssetId,
    errors,
    warnings,
    valid: errors.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find Hero content image (heroImage) asset IDs that are recoverable
 * because the section has a legacy `image` URL as fallback.
 */
function findRecoverableHeroRefs(project: Project): Set<string> {
  const ids = new Set<string>();

  for (const page of project.pages || []) {
    for (const section of page.sections || []) {
      if (section.type !== "hero") continue;
      if (section.visible === false) continue;

      const heroImageRef = section.props?.heroImage as { assetId: string } | undefined;
      const legacyImage = section.props?.image;

      if (heroImageRef?.assetId && typeof legacyImage === "string" && legacyImage.length > 0) {
        ids.add(heroImageRef.assetId);
      }
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Generate OutputFiles from manifest
// ---------------------------------------------------------------------------

/**
 * Generate OutputFile entries for all assets in the manifest.
 *
 * Each file is written to public/assets/<filename> with base64 encoding.
 */
export function generateAssetFiles(manifest: ExportAssetManifest): OutputFile[] {
  const files: OutputFile[] = [];

  for (const entry of manifest.entries) {
    const base64 = extractBase64(entry.asset.source.value);
    if (!base64) {
      // Should not happen if manifest was built correctly, but guard anyway
      continue;
    }

    files.push({
      path: `public/assets/${entry.filename}`,
      content: base64,
      encoding: "base64",
    });
  }

  return files;
}
