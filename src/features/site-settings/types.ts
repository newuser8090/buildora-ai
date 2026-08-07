// ---------------------------------------------------------------------------
// Site Settings — project-level site metadata (Phase P7)
//
// Lives inside ProjectSchema (optional, backward compatible). These are
// "content" fields: they are exported with the site, imported with the
// project, and edited with normal undo/history. No deployment credentials
// ever live here.
// ---------------------------------------------------------------------------

import type { AssetRef } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface SiteSeoSettings {
  /** Browser/SEO title. Falls back to siteName. */
  title?: string;
  /** Meta description shown in search results. */
  description?: string;
  /** Optional keywords (advanced). */
  keywords?: string[];
  /** Canonical URL override (advanced). */
  canonicalUrl?: string;
  /** Whether search engines may index the site. Default true. */
  robotsIndex?: boolean;
  /** Whether search engines may follow links. Default true. */
  robotsFollow?: boolean;
}

export interface SiteSocialSettings {
  /** Social share title. Falls back to SEO title, then siteName. */
  title?: string;
  /** Social share description. Falls back to SEO description. */
  description?: string;
  /** Social share image (AssetRef). */
  image?: AssetRef;
}

export interface SiteAppearanceSettings {
  /** Browser theme color (mobile chrome). Falls back to theme background. */
  themeColor?: string;
}

export interface SiteSettings {
  /** The site name shown to visitors / in the browser tab. */
  siteName: string;
  /** One-line description of the site. */
  siteDescription?: string;
  /** BCP-47 language tag, e.g. "en", "fr". */
  language?: string;
  /** Site icon / favicon (AssetRef into project.assets). */
  favicon?: AssetRef;
  seo?: SiteSeoSettings;
  social?: SiteSocialSettings;
  appearance?: SiteAppearanceSettings;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_LANGUAGE = "en";

/** Default theme color used when no appearance.themeColor is set. */
export const FALLBACK_THEME_COLOR = "#ffffff";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the effective site name (settings → project name → fallback). */
export function resolveSiteName(
  settings: SiteSettings | undefined,
  projectName: string,
): string {
  const name = settings?.siteName?.trim();
  if (name) return name;
  const project = projectName?.trim();
  return project || "My website";
}

/** Resolve the effective SEO title. */
export function resolveSeoTitle(
  settings: SiteSettings | undefined,
  projectName: string,
): string {
  const t = settings?.seo?.title?.trim();
  if (t) return t;
  return resolveSiteName(settings, projectName);
}

/** Resolve the effective meta description. */
export function resolveSeoDescription(
  settings: SiteSettings | undefined,
): string {
  return settings?.seo?.description?.trim() ||
    settings?.siteDescription?.trim() ||
    "";
}

/** Resolve the effective social share title. */
export function resolveSocialTitle(
  settings: SiteSettings | undefined,
  projectName: string,
): string {
  const t = settings?.social?.title?.trim();
  if (t) return t;
  return resolveSeoTitle(settings, projectName);
}

/** Resolve the effective social share description. */
export function resolveSocialDescription(
  settings: SiteSettings | undefined,
): string {
  const d = settings?.social?.description?.trim();
  if (d) return d;
  return resolveSeoDescription(settings);
}

/** Resolve the language tag with fallback. */
export function resolveLanguage(settings: SiteSettings | undefined): string {
  return settings?.language?.trim() || DEFAULT_LANGUAGE;
}
