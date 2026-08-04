// ---------------------------------------------------------------------------
// Guided builder — cross-component event names
// ---------------------------------------------------------------------------

/** Dispatch to focus the AI composer in the left sidebar (detail: scope). */
export const AI_COMPOSER_FOCUS_EVENT = "buildora:focus-ai-composer";

/** Dispatch to trigger the site export from the command palette. */
export const EXPORT_SITE_EVENT = "buildora:export-site";

/** CustomEvent detail for AI composer focus. */
export interface AiComposerFocusDetail {
  scope?: "create" | "section" | "page" | "project";
}
