import type { BaseSection } from "./section";
import type { Theme } from "./theme";
import type { Asset } from "@/features/assets/types";

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
