// ---------------------------------------------------------------------------
// Types for the rule-based generation pipeline
// ---------------------------------------------------------------------------

export type WebsiteType = "saas" | "portfolio" | "agency" | "restaurant" | "ecommerce";

export type ThemeStyle = "modern" | "minimal" | "dark" | "light" | "luxury" | "startup";

// ---------------------------------------------------------------------------
// Planned section — a type + its props, to be generated
// ---------------------------------------------------------------------------

export interface PlannedSection {
  type: string;
  order: number;
  props: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Planned page — a multi-page site plan entry (Phase P22-I)
// ---------------------------------------------------------------------------

export interface PlannedPage {
  title: string;
  slug: string;
  sections: PlannedSection[];
}

// ---------------------------------------------------------------------------
// Full generation plan produced by the analyzers
// ---------------------------------------------------------------------------

export interface GenerationPlan {
  websiteType: WebsiteType;
  brandName: string;
  theme: ThemeStyle;
  sections: PlannedSection[];
  /**
   * Phase P22-I — multi-page site plan (2–6 pages). Present only for site
   * generation; ordinary create plans keep the single-page `sections` shape.
   */
  pages?: PlannedPage[];
}
