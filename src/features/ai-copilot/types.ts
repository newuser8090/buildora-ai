// ---------------------------------------------------------------------------
// AI Copilot — Phase P10 model types
//
// The Copilot is a beginner-first conversation surface over the EXISTING
// plan/apply machinery (ai-editing). This module defines the Copilot's own
// transient model only: scopes, conversation messages, statuses, and the
// plan-preview state it keeps for approval. It contains NO logic and NO
// editor mutations — planning/validation/application all flow through the
// canonical ai-editing + editor-store services.
//
// Guarantees:
//   - the Copilot never mutates the editor store directly
//   - conversation state is session-only and bounded
//   - no provider internals, secrets, or tokens are ever stored
// ---------------------------------------------------------------------------

import type { FieldPathSegment } from "@/features/inline-editing/types";
import type {
  AiEditDiff,
  AiEditPlan,
  AiEditScope,
} from "@/features/ai-editing/plan-types";

// ---------------------------------------------------------------------------
// Scopes — what the AI is acting on
// ---------------------------------------------------------------------------

/**
 * Copilot scope. Unlike AiEditScope, it also covers the selected ELEMENT
 * (an inline-editable text field). "auto" is a UI preference that resolves
 * against live selection; it is never stored in a request.
 */
export type CopilotScope =
  | { type: "project" }
  | { type: "page"; pageId: string }
  | { type: "section"; pageId: string; sectionId: string }
  | { type: "element"; pageId: string; sectionId: string; fieldPath: FieldPathSegment[] };

export type CopilotScopeChoice = "auto" | CopilotScope;

/** Plain-language scope label for the indicator (never implementation jargon). */
export function copilotScopeLabel(scope: CopilotScope): string {
  switch (scope.type) {
    case "project":
      return "Whole website";
    case "page":
      return "this page";
    case "section":
      return "this section";
    case "element":
      return "selected text";
  }
}

/** Map a Copilot scope onto the plan scope understood by the AI planner. */
export function toAiEditScope(scope: CopilotScope): AiEditScope {
  switch (scope.type) {
    case "project":
      return { type: "project" };
    case "page":
      return { type: "page", pageId: scope.pageId };
    case "section":
    case "element":
      return { type: "section", pageId: scope.pageId, sectionId: scope.sectionId };
  }
}

// ---------------------------------------------------------------------------
// Status — spec §2 states mapped 1:1. "closed" is `open === false`.
// ---------------------------------------------------------------------------

export type CopilotStatus =
  | "idle"
  | "composing"
  | "planning"
  | "awaiting-approval"
  | "applying"
  | "completed"
  | "failed";

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export type CopilotMessageKind =
  | "question"
  | "edit-plan"
  | "applied"
  | "error"
  | "system"
  | "quality";

export interface CopilotMessageMetadata {
  /** Plan scope this message relates to (follow-up resolution only). */
  scope?: AiEditScope;
  pageId?: string;
  sectionId?: string;
  planId?: string;
  opLabels?: string[];
  findingId?: string;
}

export interface CopilotMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  status?: "pending" | "complete" | "error";
  kind?: CopilotMessageKind;
  metadata?: CopilotMessageMetadata;
}

// ---------------------------------------------------------------------------
// Errors — beginner-safe, structured
// ---------------------------------------------------------------------------

export type CopilotErrorCode =
  | "COPILOT_ASK_UNAVAILABLE"
  | "COPILOT_NO_SCOPE"
  | "COPILOT_EMPTY_INSTRUCTION"
  | "COPILOT_PLAN_FAILED"
  | "COPILOT_PLAN_STALE"
  | "COPILOT_PLAN_INVALID"
  | "COPILOT_TARGET_REMOVED"
  | "COPILOT_APPLY_FAILED"
  | "COPILOT_PROVIDER_FAILED"
  | "COPILOT_QUICK_ACTION_UNAVAILABLE";

export interface CopilotError {
  code: CopilotErrorCode;
  /** Beginner-safe message suitable for display. */
  message: string;
  /** Optional retry: re-run the last request. */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Plan-preview state kept for approval
// ---------------------------------------------------------------------------

export interface CopilotPlanState {
  plan: AiEditPlan;
  diffs: AiEditDiff[];
  selectedOperationIds: string[];
  warnings: string[];
}

export interface CopilotAppliedSummary {
  /** Operation labels that were actually applied, in plan order. */
  opLabels: string[];
  /** Total applied count (selected set may exclude high-risk ops). */
  applied: number;
  /** Total skipped count. */
  skipped: number;
}

// ---------------------------------------------------------------------------
// Last request — used for Regenerate / Retry
// ---------------------------------------------------------------------------

export interface CopilotLastRequest {
  instruction: string;
  scope: CopilotScope;
}
