// ---------------------------------------------------------------------------
// Guided Builder — shared types (Phase N)
//
// Framework-independent model for the beginner-first guided experience:
// experience modes, onboarding selections, recommendations, the building
// journey and the readiness score. None of these types are persisted inside
// a Project; the Project schema is untouched by Phase N.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Experience modes
// ---------------------------------------------------------------------------

export type EditorExperienceMode = "guided" | "standard" | "advanced";

export const EXPERIENCE_MODE_LABELS: Record<EditorExperienceMode, string> = {
  guided: "Guided",
  standard: "Standard",
  advanced: "Advanced",
};

export function isExperienceMode(value: unknown): value is EditorExperienceMode {
  return value === "guided" || value === "standard" || value === "advanced";
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export type OnboardingProjectCategory =
  | "business"
  | "portfolio"
  | "store"
  | "restaurant"
  | "personal"
  | "event"
  | "other";

export const ONBOARDING_CATEGORY_LABELS: Record<OnboardingProjectCategory, string> = {
  business: "Business",
  portfolio: "Portfolio",
  store: "Store",
  restaurant: "Restaurant",
  personal: "Personal page",
  event: "Event",
  other: "Something else",
};

export type OnboardingBeginChoice = "guided" | "template" | "ai" | "blank";

export type OnboardingComfortLevel = "new" | "experienced" | "expert";

export interface OnboardingSelections {
  category: OnboardingProjectCategory;
  begin: OnboardingBeginChoice;
  comfort: OnboardingComfortLevel;
}

/** The site type used by deterministic recommendation rules. */
export type BuilderSiteType =
  | OnboardingProjectCategory
  | "generic";

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

export type BuilderSuggestionType =
  | "add-section"
  | "edit-section"
  | "add-page"
  | "improve-content"
  | "complete-setting";

export type BuilderSuggestionAction =
  | { kind: "add-section"; sectionType: string; position?: "start" | "end" }
  | { kind: "edit-section"; sectionType: string }
  | { kind: "add-page" }
  | { kind: "preview-mobile" }
  | { kind: "export-site" }
  | { kind: "open-blocks" };

export interface BuilderSuggestion {
  /** Stable id — used for dismissal filtering. */
  id: string;
  type: BuilderSuggestionType;
  title: string;
  description: string;
  reason: string;
  /** Lower numbers are more important. */
  priority: number;
  action: BuilderSuggestionAction;
}

// ---------------------------------------------------------------------------
// Readiness score
// ---------------------------------------------------------------------------

export type ReadinessCategoryId =
  | "structure"
  | "content"
  | "trust"
  | "action"
  | "navigation"
  | "mobile"
  | "seo";

export interface ReadinessCategoryResult {
  id: ReadinessCategoryId;
  label: string;
  pointsEarned: number;
  pointsPossible: number;
  /** Human-readable reasons, one per earned or missing point. */
  notes: string[];
}

export interface ReadinessReport {
  score: number;
  categories: ReadinessCategoryResult[];
  /** Short positive statements. */
  strong: string[];
  /** Short "could improve" statements. */
  couldImprove: string[];
}

// ---------------------------------------------------------------------------
// Building journey
// ---------------------------------------------------------------------------

export type JourneyStepId =
  | "main-message"
  | "offer"
  | "next-step"
  | "trust"
  | "contact"
  | "preview-mobile"
  | "preview-site"
  | "export"
  | "publish";

export interface JourneyStep {
  id: JourneyStepId;
  label: string;
  helper: string;
  complete: boolean;
}

export interface BuildingJourney {
  pageTitle: string;
  steps: JourneyStep[];
  completedCount: number;
  total: number;
}
