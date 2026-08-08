// ---------------------------------------------------------------------------
// AI Copilot — Phase P10 constants
//
// Limits, starter prompts, quick actions, and the beginner copy used for
// common failure states. No logic lives here.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Limits (bounded context / conversation / requests)
// ---------------------------------------------------------------------------

export const COPILOT_LIMITS = {
  /** Max conversation messages retained (oldest pairs trimmed first). */
  maxMessages: 24,
  /** Max context JSON size in bytes — reduced deterministically when exceeded. */
  maxContextBytes: 12_000,
  /** Max user instruction length sent to the planner. */
  maxInstructionLength: 3000,
  /** Max provider-response plan size is enforced by the existing plan schema. */
} as const;

// ---------------------------------------------------------------------------
// Starter prompts (spec §2 — beginner-first)
// ---------------------------------------------------------------------------

export const STARTER_PROMPTS = [
  "Make this page feel more premium",
  "Rewrite the hero for a SaaS product",
  "Improve the call to action",
  "Make this section shorter",
  "Check this page for obvious problems",
  "Make the mobile layout cleaner",
] as const;

// ---------------------------------------------------------------------------
// Quick actions (spec §13 — focused first version)
// ---------------------------------------------------------------------------

export type ElementQuickActionId =
  | "rewrite"
  | "shorter"
  | "longer"
  | "clarity"
  | "grammar";

export type SectionQuickActionId =
  | "improve-section"
  | "simplify"
  | "mobile-layout"
  | "duplicate-idea"
  | "suggest-replacement";

export type PageQuickActionId = "improve-page" | "review-content" | "improve-seo";

/** Element quick actions — single-field suggestions via the inline service. */
export const ELEMENT_QUICK_ACTIONS: ReadonlyArray<{
  id: ElementQuickActionId;
  label: string;
  instruction: string;
}> = [
  { id: "rewrite", label: "Rewrite", instruction: "Rewrite this text with fresh, high-quality copy." },
  { id: "shorter", label: "Make shorter", instruction: "Make this text shorter and more concise." },
  { id: "longer", label: "Make longer", instruction: "Expand this text with more useful detail." },
  { id: "clarity", label: "Improve clarity", instruction: "Make this text clearer and easier to understand." },
  { id: "grammar", label: "Fix grammar", instruction: "Fix any grammar or spelling issues, keeping the meaning." },
];

/** Section quick actions — planned edits (require approval). */
export const SECTION_QUICK_ACTIONS: ReadonlyArray<{
  id: SectionQuickActionId;
  label: string;
  instruction: string;
}> = [
  {
    id: "improve-section",
    label: "Improve section",
    instruction:
      "Improve this section's copy and layout. Keep all links, prices, and asset references exactly the same.",
  },
  {
    id: "simplify",
    label: "Simplify",
    instruction:
      "Simplify this section: make it easier to scan and understand. Keep all links, prices, and asset references exactly the same.",
  },
  {
    id: "mobile-layout",
    label: "Improve mobile layout",
    instruction:
      "Improve this section for phones: remove fixed widths, keep text and buttons readable on small screens. Keep all links and asset references exactly the same.",
  },
  {
    id: "duplicate-idea",
    label: "Duplicate idea with new content",
    instruction:
      "Duplicate this section below the original with different but related content for the same purpose.",
  },
  {
    id: "suggest-replacement",
    label: "Suggest replacement",
    instruction:
      "Replace this section with a better version that serves the same purpose. Keep links and asset references exactly the same.",
  },
];

/** Page quick actions — planned edits (require approval). */
export const PAGE_QUICK_ACTIONS: ReadonlyArray<{
  id: PageQuickActionId;
  label: string;
  instruction: string;
}> = [
  {
    id: "improve-page",
    label: "Improve page",
    instruction:
      "Improve this page's copy and structure. Keep all links, prices, and asset references exactly the same.",
  },
  { id: "review-content", label: "Review content", instruction: "" }, // ASK — handled by intent classifier
  {
    id: "improve-seo",
    label: "Improve SEO text",
    instruction:
      "Improve this page's SEO title and description based on its content. Update the page metadata only.",
  },
];

// ---------------------------------------------------------------------------
// Beginner error copy (spec §15 — never raw stack traces)
// ---------------------------------------------------------------------------

export const COPILOT_ERROR_COPY: Record<string, string> = {
  PLAN_STALE: "The page changed before the suggestion could be applied. Try again.",
  PLAN_PROJECT_MISMATCH:
    "This suggestion was made for a different project, so nothing was applied.",
  PLAN_OPERATION_INVALID:
    "The part this suggestion targeted no longer exists, so nothing was applied. Try again.",
  PLAN_SIMULATION_FAILED:
    "The suggestion no longer fits your site, so nothing was applied. Try again.",
  PLAN_VALIDATION_FAILED:
    "The AI suggestion didn't pass Buildora's safety checks — nothing was applied.",
  PLAN_PROVIDER_FAILED:
    "I couldn't prepare that suggestion right now. Please try again.",
  PLAN_NO_CHANGES: "",
  PLAN_DESTRUCTIVE_CONFIRMATION_REQUIRED:
    "This suggestion needs your confirmation before it can be applied.",
  PLAN_DEPENDENCY_INVALID:
    "This suggestion has a part that can't be applied on its own. Choose the full set or regenerate.",
  PLAN_REQUEST_INVALID: "That request wasn't understood. Please try again.",
};

/** Map a structured plan error code to beginner copy (unknown → generic). */
export function beginnerMessageFor(errorCode: string, fallback?: string): string {
  const known = COPILOT_ERROR_COPY[errorCode];
  if (known !== undefined && known !== "") return known;
  return fallback ?? "I couldn't complete that. Please try again.";
}

// ---------------------------------------------------------------------------
// Perf labels (spec §19)
// ---------------------------------------------------------------------------

export const COPILOT_PERF = {
  open: "copilot_open",
  contextBuild: "context_build",
  planReceived: "plan_received",
  planValidated: "plan_validated",
  planApplied: "plan_applied",
} as const;
