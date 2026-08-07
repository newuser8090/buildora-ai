import type { BaseSection } from "./section";
import type { Theme } from "./theme";
import type { Asset } from "@/features/assets/types";
import type { SiteSettings } from "@/features/site-settings/types";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  theme: Theme;
  pages: Page[];
  /** Project assets (images, logos, backgrounds, icons, etc.) */
  assets: Asset[];
  createdAt: string;
  updatedAt: string;
  /** Phase P7 — optional site-wide settings (name, SEO, social, favicon). */
  siteSettings?: SiteSettings;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Optional per-page SEO metadata used when exporting the site. */
export interface PageMeta {
  /** Overrides the page title in <title> / metadata. */
  title?: string;
  /** Meta description for the page. */
  description?: string;
  /** Phase P7 — dedicated search-engine title (Google title). */
  seoTitle?: string;
  /** Phase P7 — dedicated search-engine description (Google description). */
  seoDescription?: string;
  /** Phase P7 — social share title override. */
  socialTitle?: string;
  /** Phase P7 — social share description override. */
  socialDescription?: string;
  /** Phase P7 — social share image (AssetRef into project.assets). */
  socialImage?: import("@/features/assets/types").AssetRef;
  /** Phase P7 — whether search engines may index this page. Default true. */
  index?: boolean;
  /** Phase P7 — canonical URL override for this page. */
  canonicalUrl?: string;
}

export interface Page {
  id: string;
  title: string;
  slug: string;
  sections: BaseSection[];
  /** Optional per-page metadata (preserved through import/export). */
  meta?: PageMeta;
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export type Viewport = "desktop" | "tablet" | "mobile";
