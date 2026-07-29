import type { BaseSection } from "./section";
import type { Theme } from "./theme";

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  theme: Theme;
  pages: Page[];
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
