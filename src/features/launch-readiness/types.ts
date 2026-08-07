// ---------------------------------------------------------------------------
// Launch readiness — types (Phase P7)
//
// A check is a single deterministic finding. The engine derives a 0–100
// score from check weights. Never AI, never persisted, never mutates.
// ---------------------------------------------------------------------------

export type LaunchCategoryId =
  | "site-basics"
  | "pages"
  | "navigation"
  | "content"
  | "mobile"
  | "accessibility"
  | "search-sharing"
  | "links-actions"
  | "performance"
  | "publish";

export const LAUNCH_CATEGORY_LABELS: Record<LaunchCategoryId, string> = {
  "site-basics": "Site basics",
  pages: "Pages",
  navigation: "Navigation",
  content: "Content",
  mobile: "Mobile",
  accessibility: "Accessibility",
  "search-sharing": "Search & sharing",
  "links-actions": "Links & buttons",
  performance: "Performance hints",
  publish: "Publish readiness",
};

export type LaunchCheckStatus = "pass" | "warning" | "fail" | "info";

export type LaunchSeverity = "info" | "minor" | "major" | "critical";

export type LaunchFixActionId =
  | "open-site-settings"
  | "open-page-settings"
  | "select-section"
  | "open-mobile-preview"
  | "open-broken-link"
  | "open-seo-settings"
  | null;

export interface LaunchCheck {
  /** Stable id — used for keys and tests. */
  id: string;
  category: LaunchCategoryId;
  status: LaunchCheckStatus;
  /** Beginner-facing title. */
  title: string;
  /** Beginner explanation. */
  explanation: string;
  /** Page / section / block name when applicable. */
  affected?: string;
  /** Beginner-facing suggested action. */
  suggestedAction: string;
  /** Optional fix action (one-click). */
  fixActionId?: LaunchFixActionId;
  severity: LaunchSeverity;
  /** Score weight — 0 for informational checks. */
  weight: number;
}

export interface LaunchCategorySummary {
  id: LaunchCategoryId;
  label: string;
  earned: number;
  possible: number;
  status: "pass" | "warning" | "fail" | "info";
}

export interface LaunchReadinessReport {
  /** 0–100, deterministic, explained by per-check deductions. */
  score: number;
  checks: LaunchCheck[];
  categories: LaunchCategorySummary[];
  /** Short positive statements. */
  strong: string[];
  /** Short "worth checking" statements. */
  couldImprove: string[];
  /** True when a critical fail (export/security/project-schema) exists. */
  blocked: boolean;
  /** Beginner-safe reasons when blocked. */
  blockers: string[];
}

// ---------------------------------------------------------------------------
// Score policy
// ---------------------------------------------------------------------------

/** Fraction of weight earned by a warning (vs a pass). */
export const WARNING_SCORE_FACTOR = 0.5;

/** Compute the earned weight for a check. */
export function earnedWeight(check: LaunchCheck): number {
  if (check.weight <= 0) return 0;
  if (check.status === "pass") return check.weight;
  if (check.status === "warning") return check.weight * WARNING_SCORE_FACTOR;
  return 0;
}
