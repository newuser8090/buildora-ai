// ---------------------------------------------------------------------------
// SEO preview — pure derivation of Google-style + social share card previews
//
// No external fetch. Everything is derived from validated settings/assets.
// Fallbacks are visible and coaching messages guide length/size without
// hard-failing on arbitrary values.
// ---------------------------------------------------------------------------

import type { SiteSettings } from "../types";
import type { Asset } from "@/features/assets/types";
import { resolveAsset } from "@/features/assets/services/asset-resolver";

// ---------------------------------------------------------------------------
// Length guidance (industry-typical, coaching only — never hard fails)
// ---------------------------------------------------------------------------

export const GOOGLE_TITLE_MAX = 60;
export const GOOGLE_DESCRIPTION_MAX = 155;
export const SOCIAL_TITLE_MAX = 60;
export const SOCIAL_DESCRIPTION_MAX = 200;

// ---------------------------------------------------------------------------
// Google-style result
// ---------------------------------------------------------------------------

export interface GoogleResultPreview {
  /** The URL line shown under the title. */
  url: string;
  title: string;
  description: string;
  /** True when the description or title is empty (fallback in effect). */
  usingFallback: boolean;
  coaching: string[];
}

export function deriveGooglePreview(
  settings: SiteSettings | undefined,
  projectName: string,
  /** Canonical URL or site name used to build the display URL. */
  url: string,
): GoogleResultPreview {
  const coaching: string[] = [];

  const title = settings?.seo?.title?.trim() || settings?.siteName?.trim() || projectName || "My website";
  const description =
    settings?.seo?.description?.trim() ||
    settings?.siteDescription?.trim() ||
    "Add a description so people know what your site is about before they click.";

  const usingFallback =
    !settings?.seo?.title?.trim() || !settings?.seo?.description?.trim();

  if (settings?.seo?.title?.trim() && settings.seo.title.trim().length > GOOGLE_TITLE_MAX) {
    coaching.push("Your title may get cut off in search results.");
  }
  if (settings?.seo?.description?.trim() && settings.seo.description.trim().length > GOOGLE_DESCRIPTION_MAX) {
    coaching.push("This description is a little long — it may get cut off.");
  }
  if (!settings?.seo?.title?.trim()) {
    coaching.push("Add a title to control how your site appears in search results.");
  }
  if (!settings?.seo?.description?.trim()) {
    coaching.push("Add a description so your site stands out in search results.");
  }

  return { url, title, description, usingFallback, coaching };
}

// ---------------------------------------------------------------------------
// Social share card
// ---------------------------------------------------------------------------

export interface SocialSharePreview {
  title: string;
  description: string;
  /** Resolved image src (data URL) or undefined. */
  imageSrc?: string;
  /** Site name shown on the card. */
  siteName: string;
  usingFallback: boolean;
  coaching: string[];
}

export function deriveSocialPreview(
  settings: SiteSettings | undefined,
  projectName: string,
  assets: Asset[],
): SocialSharePreview {
  const coaching: string[] = [];

  const title =
    settings?.social?.title?.trim() ||
    settings?.seo?.title?.trim() ||
    settings?.siteName?.trim() ||
    projectName ||
    "My website";
  const description =
    settings?.social?.description?.trim() ||
    settings?.seo?.description?.trim() ||
    settings?.siteDescription?.trim() ||
    "";
  const siteName = settings?.siteName?.trim() || projectName || "My website";

  // Resolve the social image from the AssetRef (fallback to SEO-less default).
  const imageRef = settings?.social?.image;
  const resolved = imageRef ? resolveAsset(imageRef, assets) : undefined;
  const imageSrc = resolved?.src;

  const usingFallback =
    !settings?.social?.title?.trim() ||
    !settings?.social?.description?.trim() ||
    !imageSrc;

  if (settings?.social?.title?.trim() && settings.social.title.trim().length > SOCIAL_TITLE_MAX) {
    coaching.push("Your share title may get cut off.");
  }
  if (
    settings?.social?.description?.trim() &&
    settings.social.description.trim().length > SOCIAL_DESCRIPTION_MAX
  ) {
    coaching.push("This description is a little long — it may get cut off.");
  }
  if (!imageSrc) {
    coaching.push("Add an image so shared links stand out.");
  }

  return { title, description, imageSrc, siteName, usingFallback, coaching };
}

// ---------------------------------------------------------------------------
// Favicon guidance
// ---------------------------------------------------------------------------

export interface FaviconGuidance {
  /** True when the favicon resolves to a real asset with valid image data. */
  valid: boolean;
  /** True when the favicon asset is square (or missing dims — unknown). */
  square: boolean | null;
  coaching: string[];
}

export function deriveFaviconGuidance(
  settings: SiteSettings | undefined,
  assets: Asset[],
): FaviconGuidance {
  const coaching: string[] = [];
  const ref = settings?.favicon;
  if (!ref?.assetId) {
    return {
      valid: false,
      square: null,
      coaching: [
        "Add a site icon so your site looks finished in browser tabs and bookmarks.",
      ],
    };
  }
  const resolved = resolveAsset(ref, assets);
  if (!resolved.src || resolved.missing || resolved.invalid) {
    return {
      valid: false,
      square: null,
      coaching: ["The selected site icon can't be found. Choose another image."],
    };
  }
  const asset = resolved.asset;
  let square: boolean | null = null;
  if (asset && typeof asset.width === "number" && typeof asset.height === "number") {
    square = Math.abs(asset.width - asset.height) <= 1;
    if (!square) {
      coaching.push("Square images work best for site icons.");
    }
  } else {
    coaching.push("Square images work best for site icons.");
  }
  return { valid: true, square, coaching };
}
