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

export interface Page {
  id: string;
  title: string;
  slug: string;
  sections: BaseSection[];
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export type Viewport = "desktop" | "tablet" | "mobile";
