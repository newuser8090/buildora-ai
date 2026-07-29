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
// Full generation plan produced by the analyzers
// ---------------------------------------------------------------------------

export interface GenerationPlan {
  websiteType: WebsiteType;
  brandName: string;
  theme: ThemeStyle;
  sections: PlannedSection[];
}
