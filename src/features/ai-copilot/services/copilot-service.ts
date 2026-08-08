// ---------------------------------------------------------------------------
// AI Copilot — orchestration service (Phase P10, spec §6–§9)
//
// Framework-independent flow for one user message:
//
//   sanitize → resolve scope (auto / follow-up) → classify intent
//     → ASK: deterministic answer (no mutation, no provider)
//     → PLAN-EDIT: runPlanEdit (existing provider path with Gemini +
//       rule-based fallback) → client re-simulation + diffs → awaiting
//       approval → apply through editor.applyAiEditPlan (ONE atomic history
//       entry, stale/destructive guards) → change summary + undo.
//
// This service never mutates the editor store directly and never persists.
// All mutations flow through the canonical editor store.
// ---------------------------------------------------------------------------

import type { Project, Viewport } from "@/types/project";
import type { EditableFieldDescriptor } from "@/features/inline-editing/types";
import type { InlineAiSuggestion } from "@/features/inline-editing/types";
import { runInlineSuggestion, InlineSuggestionClientError } from "@/features/inline-editing/services/inline-suggestion-service";
import type { LaunchReadinessReport } from "@/features/launch-readiness/types";
import type {
  AiEditPlan,
  AiEditPlanError,
} from "@/features/ai-editing/plan-types";
import { simulatePlan } from "@/features/ai-editing/services/plan-simulator";
import { buildDiffs } from "@/features/ai-editing/services/diff-builder";
import { runPlanEdit, PlanEditClientError } from "@/features/ai-editing/services/plan-service";
import { scanPayloadForSecurityIssues } from "@/features/ai-editing/schemas/plan-schemas";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { markPerf } from "@/features/perf/perf-instrumentation";
import { COPILOT_PERF, beginnerMessageFor } from "../constants";
import { buildCopilotContext, contextByteLength } from "../context/context-builder";
import { resolveFollowUpTarget, sanitizeInstruction } from "../conversation/conversation";
import { classifyCopilotIntent } from "./intent-classifier";
import { answerQuestion, buildReadinessReview } from "./ask-answerer";
import type {
  CopilotAppliedSummary,
  CopilotError,
  CopilotMessage,
  CopilotPlanState,
  CopilotScope,
  CopilotScopeChoice,
} from "../types";

// ---------------------------------------------------------------------------
// Dependencies (injectable for tests)
// ---------------------------------------------------------------------------

export interface CopilotServiceDeps {
  requestPlan?: typeof runPlanEdit;
  requestElementSuggestion?: typeof runInlineSuggestion;
}

// ---------------------------------------------------------------------------
// Outcome of handling one user message
// ---------------------------------------------------------------------------

export type CopilotMessageOutcome =
  | { kind: "ask"; answer: string; planInstruction?: string }
  | { kind: "readiness-review"; answer: string }
  | {
      kind: "plan-ready";
      planState: CopilotPlanState;
      lastRequest: { instruction: string; scope: CopilotScope };
    }
  | { kind: "error"; error: CopilotError };

export interface HandleMessageInput {
  instruction: string;
  scopeChoice: CopilotScopeChoice;
  project: Project;
  revision: number;
  selectedPageId: string | null;
  selectedSectionId: string | null;
  selectedField: EditableFieldDescriptor | null;
  readiness: LaunchReadinessReport | null;
  device: Viewport;
  messages: CopilotMessage[];
}

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective scope for a message. Explicit choices win; "auto"
 * resolves through follow-up-aware rules (live selection first, then the
 * last plan/applied conversation target, then the current page, then whole
 * website).
 */
export function resolveEffectiveScope(
  scopeChoice: CopilotScopeChoice,
  project: Project,
  selectedPageId: string | null,
  selectedSectionId: string | null,
  selectedField: EditableFieldDescriptor | null,
  messages: CopilotMessage[],
  instruction: string,
): CopilotScope {
  if (scopeChoice !== "auto") return scopeChoice;

  // A selected editable element is the tightest scope.
  if (selectedField) {
    return {
      type: "element",
      pageId: selectedField.pageId,
      sectionId: selectedField.sectionId,
      fieldPath: selectedField.fieldPath,
    };
  }

  // Follow-up resolution (explicit page refs, live section selection, then
  // last conversation target, then current page, then project).
  const resolved = resolveFollowUpTarget({
    instruction,
    project,
    selectedPageId,
    selectedSectionId,
    selectedField,
    messages,
  });

  // When the follow-up resolved to project scope and nothing is selected,
  // prefer the current page when one exists (better default for beginners).
  if (resolved.scope.type === "project") {
    const pageId = selectedPageId ?? project.pages[0]?.id;
    if (pageId && project.pages.some((p) => p.id === pageId)) {
      return { type: "page", pageId };
    }
  }
  return resolved.scope;
}

// ---------------------------------------------------------------------------
// Error mapping — structured plan errors → beginner-safe Copilot errors
// ---------------------------------------------------------------------------

export function toCopilotError(error: AiEditPlanError): CopilotError {
  switch (error.code) {
    case "PLAN_STALE":
    case "PLAN_PROJECT_MISMATCH":
      return {
        code: "COPILOT_PLAN_STALE",
        message: "The page changed before the suggestion could be applied. Try again.",
        retryable: true,
      };
    case "PLAN_OPERATION_INVALID":
      return {
        code: "COPILOT_TARGET_REMOVED",
        message: "The part this suggestion targeted no longer exists, so nothing was applied. Try again.",
        retryable: true,
      };
    case "PLAN_SIMULATION_FAILED":
    case "PLAN_VALIDATION_FAILED":
      return {
        code: "COPILOT_PLAN_INVALID",
        message: "The AI suggestion didn't pass Buildora's safety checks — nothing was applied.",
        retryable: true,
      };
    case "PLAN_NO_CHANGES":
      return {
        code: "COPILOT_PLAN_FAILED",
        message: error.message || "The AI couldn't determine a concrete change from that request.",
        retryable: false,
      };
    case "PLAN_PROVIDER_FAILED":
      return {
        code: "COPILOT_PROVIDER_FAILED",
        message: "I couldn't prepare that suggestion right now. Please try again.",
        retryable: true,
      };
    case "PLAN_APPLY_FAILED":
      return {
        code: "COPILOT_APPLY_FAILED",
        message: "The change couldn't be applied. Your site is unchanged.",
        retryable: true,
      };
    default:
      return {
        code: "COPILOT_PLAN_FAILED",
        message: beginnerMessageFor(error.code, error.message),
        retryable: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Plan request + client-side revalidation
// ---------------------------------------------------------------------------

interface RequestPlanInput {
  instruction: string;
  scope: CopilotScope;
  project: Project;
  revision: number;
  selectedPageId?: string;
  selectedSectionId?: string;
}

export type RequestPlanResult =
  | { ok: true; planState: CopilotPlanState }
  | { ok: false; error: CopilotError };

export async function requestCopilotPlan(
  input: RequestPlanInput,
  deps: CopilotServiceDeps = {},
): Promise<RequestPlanResult> {
  const requestPlan = deps.requestPlan ?? runPlanEdit;

  // Map the Copilot scope onto the planner scope.
  const plannerScope =
    input.scope.type === "element"
      ? { type: "section" as const, pageId: input.scope.pageId, sectionId: input.scope.sectionId }
      : input.scope.type === "project"
        ? ({ type: "project" } as const)
        : ({ type: "page" as const, pageId: input.scope.pageId } as const);

  try {
    const result = await requestPlan({
      instruction: input.instruction,
      scope: plannerScope,
      project: input.project,
      selectedPageId: input.selectedPageId,
      selectedSectionId: input.selectedSectionId,
      baseRevision: input.revision,
    });
    markPerf(COPILOT_PERF.planReceived);

    // Defense-in-depth (spec §16): re-scan the provider's plan for adversarial
    // payloads client-side. The server already rejects these, but a plan must
    // never be shown or applied if it somehow reaches the client with
    // prototype-pollution keys or unsafe URL schemes.
    const securityIssues = scanPayloadForSecurityIssues(result.plan);
    if (securityIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: "COPILOT_PLAN_INVALID",
          message: "The AI suggestion didn't pass Buildora's safety checks — nothing was applied.",
          retryable: true,
        },
      };
    }

    // Client-side re-simulation against the LIVE project — revalidates the
    // plan and produces before/after snapshots for the review diffs. A plan
    // that no longer fits the project is never shown.
    const simulation = simulatePlan(input.project, result.plan.operations, {
      captureSnapshots: true,
    });
    if (!simulation.ok) {
      return {
        ok: false,
        error: {
          code: "COPILOT_PLAN_INVALID",
          message: "The AI suggestion no longer fits your site — nothing was applied. Try again.",
          retryable: true,
        },
      };
    }
    markPerf(COPILOT_PERF.planValidated);

    const diffs = buildDiffs(result.plan.operations, simulation.snapshots);
    const defaultSelection = result.plan.operations
      .filter((op) => op.risk !== "high")
      .map((op) => op.id);

    return {
      ok: true,
      planState: {
        plan: result.plan,
        diffs,
        selectedOperationIds: defaultSelection,
        warnings: result.warnings,
      },
    };
  } catch (err) {
    if (err instanceof PlanEditClientError) {
      return {
        ok: false,
        error: toCopilotError({
          code: err.code as AiEditPlanError["code"],
          message: err.message,
        }),
      };
    }
    // Never leak raw provider errors into the UI — always the same
    // beginner-safe copy for unexpected failures.
    return {
      ok: false,
      error: {
        code: "COPILOT_PROVIDER_FAILED",
        message: "I couldn't prepare that suggestion right now. Please try again.",
        retryable: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Element suggestions — single-field quick actions (spec §13)
//
// One registered text field, validated by the canonical inline service and
// applied through editor.updateEditableFieldValue (ONE atomic history entry).
// The suggestion is shown in the panel and requires an explicit Apply click.
// ---------------------------------------------------------------------------

export type ElementSuggestionResult =
  | { ok: true; suggestion: InlineAiSuggestion }
  | { ok: false; error: CopilotError };

export async function requestElementSuggestion(
  input: {
    instruction: string;
    field: EditableFieldDescriptor;
    project: Project;
    revision: number;
  },
  deps: CopilotServiceDeps = {},
): Promise<ElementSuggestionResult> {
  const request = deps.requestElementSuggestion ?? runInlineSuggestion;

  // Bounded surrounding context (same shape the inline feature uses).
  const page = input.project.pages.find((p) => p.id === input.field.pageId);
  const section = page?.sections.find((s) => s.id === input.field.sectionId);
  const surroundingContext = section
    ? JSON.stringify(section.props).slice(0, 6000)
    : undefined;

  try {
    const result = await request({
      instruction: input.instruction,
      projectId: input.project.id,
      baseRevision: input.revision,
      pageId: input.field.pageId,
      sectionId: input.field.sectionId,
      sectionType: input.field.sectionType,
      fieldPath: input.field.fieldPath,
      fieldKind: input.field.kind,
      currentValue: input.field.currentValue,
      surroundingContext,
    });
    return { ok: true, suggestion: result.suggestion };
  } catch (err) {
    if (err instanceof InlineSuggestionClientError) {
      return {
        ok: false,
        error: {
          code: "COPILOT_QUICK_ACTION_UNAVAILABLE",
          message: err.message || "I couldn't rewrite that text right now. Please try again.",
          retryable: true,
        },
      };
    }
    // Never leak raw provider errors into the UI.
    return {
      ok: false,
      error: {
        code: "COPILOT_QUICK_ACTION_UNAVAILABLE",
        message: "I couldn't rewrite that text right now. Please try again.",
        retryable: true,
      },
    };
  }
}

/**
 * Apply a validated element suggestion — one atomic history entry, undoable
 * with the normal Ctrl/⌘+Z. Stale guards mirror the inline feature.
 */
export function applyElementSuggestion(
  field: EditableFieldDescriptor,
  suggestion: InlineAiSuggestion,
): { ok: true } | { ok: false; error: CopilotError } {
  const editor = useEditorStore.getState();

  if (editor.project.id !== suggestion.projectId || editor.revision !== suggestion.baseRevision) {
    return {
      ok: false,
      error: {
        code: "COPILOT_PLAN_STALE",
        message: "This text changed before the suggestion could be applied. Try again.",
        retryable: true,
      },
    };
  }

  const result = editor.updateEditableFieldValue(field, suggestion.suggestedValue);
  if (!result.ok) {
    return {
      ok: false,
      error: {
        code: "COPILOT_APPLY_FAILED",
        message: "The change couldn't be applied. Your text is unchanged.",
        retryable: true,
      },
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Apply — ONE atomic history entry through the canonical editor store
// ---------------------------------------------------------------------------

export function applyCopilotPlan(
  plan: AiEditPlan,
  selectedOperationIds: string[],
  options?: { allowDestructive?: boolean },
): { ok: true; summary: CopilotAppliedSummary } | { ok: false; error: CopilotError } {
  if (selectedOperationIds.length === 0) {
    return {
      ok: false,
      error: {
        code: "COPILOT_PLAN_FAILED",
        message: "Choose at least one change to apply.",
        retryable: false,
      },
    };
  }

  const result = useEditorStore
    .getState()
    .applyAiEditPlan(plan, selectedOperationIds, options);

  if (!result.ok) {
    return { ok: false, error: toCopilotError(result.error) };
  }

  markPerf(COPILOT_PERF.planApplied, { count: result.applied });

  const opLabels = plan.operations
    .filter((op) => selectedOperationIds.includes(op.id))
    .map((op) => op.label);

  return {
    ok: true,
    summary: {
      opLabels,
      applied: result.applied,
      skipped: result.skipped,
    },
  };
}

// ---------------------------------------------------------------------------
// Message handling — the single entry point
// ---------------------------------------------------------------------------

/**
 * Handle one user message: build the bounded context, classify intent, and
 * either answer (ASK), run a readiness review, or request a plan. The caller
 * (useCopilot) is responsible for recording conversation messages and
 * updating store status around this.
 */
export async function handleCopilotMessage(
  input: HandleMessageInput,
  deps: CopilotServiceDeps = {},
): Promise<CopilotMessageOutcome> {
  const instruction = sanitizeInstruction(input.instruction);

  if (!instruction) {
    return {
      kind: "error",
      error: {
        code: "COPILOT_EMPTY_INSTRUCTION",
        message: "Write what you'd like to ask or change first.",
        retryable: false,
      },
    };
  }

  const scope = resolveEffectiveScope(
    input.scopeChoice,
    input.project,
    input.selectedPageId,
    input.selectedSectionId,
    input.selectedField,
    input.messages,
    instruction,
  );

  // Build the bounded context only now (never per keystroke).
  const context = buildCopilotContext({
    project: input.project,
    scope,
    selectedPageId: input.selectedPageId,
    selectedSectionId: input.selectedSectionId,
    selectedField: input.selectedField
      ? {
          label: input.selectedField.label,
          currentValue: input.selectedField.currentValue,
          pageId: input.selectedField.pageId,
          sectionId: input.selectedField.sectionId,
          fieldPath: input.selectedField.fieldPath,
        }
      : null,
    readiness: input.readiness,
    device: input.device,
    messages: input.messages,
    instruction,
  });
  markPerf(COPILOT_PERF.contextBuild, { count: contextByteLength(context) });

  const intent = classifyCopilotIntent(instruction);

  if (intent.kind === "ask") {
    const result = answerQuestion(instruction, context);
    return { kind: "ask", answer: result.answer, planInstruction: result.planInstruction };
  }

  if (intent.kind === "readiness-review") {
    return { kind: "readiness-review", answer: buildReadinessReview(context).answer };
  }

  // Plan-edit.
  const planResult = await requestCopilotPlan(
    {
      instruction,
      scope,
      project: input.project,
      revision: input.revision,
      selectedPageId: input.selectedPageId ?? undefined,
      selectedSectionId: input.selectedSectionId ?? undefined,
    },
    deps,
  );

  if (!planResult.ok) return { kind: "error", error: planResult.error };

  return {
    kind: "plan-ready",
    planState: planResult.planState,
    lastRequest: { instruction, scope },
  };
}
