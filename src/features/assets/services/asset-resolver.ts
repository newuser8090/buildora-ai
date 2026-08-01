// ---------------------------------------------------------------------------
// Shared Asset Resolver — resolves AssetRef to safe renderable values
//
// Separate module so all section renderers use the same resolution logic.
// Never throws. Returns safe fallback values for any input.
// ---------------------------------------------------------------------------

import type { Asset, AssetRef } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Resolved result
// ---------------------------------------------------------------------------

export interface ResolvedAsset {
  /** The resolved Asset record, if found and valid. */
  asset?: Asset;
  /** Safe image src: data URL from resolved asset, or undefined. */
  src?: string;
  /** Alt text for accessibility: AssetRef.altText > asset.name > "" */
  alt: string;
  /** Whether this asset should be rendered with empty alt (decorative). */
  decorative: boolean;
  /** true when an AssetRef.assetId is specified but the asset is not found. */
  missing: boolean;
  /** true when the asset data URL is malformed or the source type is unsupported. */
  invalid: boolean;
}

// ---------------------------------------------------------------------------
// Dev-only warning tracking — logs once per missing asset ID to avoid spam
// ---------------------------------------------------------------------------

const warned = new Set<string>();

function devWarnMissing(assetId: string) {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    if (!warned.has(assetId)) {
      warned.add(assetId);
      console.warn(`[Buildora] Asset "${assetId}" not found in project. Rendering fallback.`);
    }
  }
}

/** Reset warning cache (useful for tests). */
export function resetWarningCache() {
  warned.clear();
}

// ---------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------

/**
 * Resolve an AssetRef against a project's asset list.
 *
 * Precedence:
 * 1. Valid AssetRef with matching asset → renderable image
 * 2. Valid AssetRef with missing asset → missing state
 * 3. No AssetRef → decorative false, no src
 */
export function resolveAsset(
  ref: AssetRef | undefined,
  assets: Asset[],
): ResolvedAsset {
  // No ref — nothing to resolve
  if (!ref) {
    return { alt: "", decorative: false, missing: false, invalid: false };
  }

  const { assetId, altText } = ref;

  // Find asset in project
  const asset = assets.find((a) => a.id === assetId);

  // Missing asset
  if (!asset) {
    devWarnMissing(assetId);
    return {
      alt: altText ?? "",
      decorative: !altText,
      missing: true,
      invalid: false,
    };
  }

  // Validate source
  if (!asset.source || asset.source.type !== "data-url" || !asset.source.value) {
    return {
      asset,
      alt: altText || asset.name || "",
      decorative: !(altText || asset.name),
      missing: false,
      invalid: true,
    };
  }

  // Valid asset
  return {
    asset,
    src: asset.source.value,
    alt: altText || asset.name || "",
    decorative: !altText && !asset.name,
    missing: false,
    invalid: false,
  };
}
