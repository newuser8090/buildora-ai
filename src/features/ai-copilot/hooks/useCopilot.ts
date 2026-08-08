"use client";

import { useCallback, useEffect } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useInlineEditingStore } from "@/features/inline-editing/store/inline-editing-store";
import { useLaunchReadiness } from "@/features/launch-readiness/hooks/useLaunchReadiness";
import { getLaunchReadinessReport } from "@/features/launch-readiness/engine/launch-readiness";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { useCopilotStore, openCopilotPanel } from "../store/copilot-store";
import {
  applyCopilotPlan,
  applyElementSuggestion,
  handleCopilotMessage,
  requestElementSuggestion,
  resolveEffectiveScope,
} from "../services/copilot-service";
import {
  toAiEditScope,
  type CopilotScope,
  type CopilotScopeChoice,
} from "../types";

// ---------------------------------------------------------------------------
// Summary copy (beginner-first)
// ---------------------------------------------------------------------------

function buildPlanPreparedCopy(operationCount: number): string {
  return `I prepared ${operationCount} proposed change${operationCount === 1 ? "" : "s"} — review them before applying.`;
}

function buildAppliedCopy(summary: { applied: number; opLabels: string[] }): string {
  if (summary.applied === 0) {
    return "No changes were applied.";
  }
  const lines = [`Done — updated ${summary.applied} thing${summary.applied === 1 ? "" : "s"}:`];
  for (const label of summary.opLabels) {
    lines.push(`• ${label}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCopilot() {
  // Derived, memoized readiness for reactive UI (score, findings).
  const readiness = useLaunchReadiness();

  // The hook reads live editor state imperatively via useEditorStore.getState()
  // inside each action (the panel is only mounted while open), so no reactive
  // editor selectors are needed here.

  // ---- Reactive copilot state ----
  const open = useCopilotStore((s) => s.open);
  const status = useCopilotStore((s) => s.status);
  const scopeChoice = useCopilotStore((s) => s.scopeChoice);
  const messages = useCopilotStore((s) => s.messages);
  const planState = useCopilotStore((s) => s.planState);
  const elementSuggestion = useCopilotStore((s) => s.elementSuggestion);
  const error = useCopilotStore((s) => s.error);
  const appliedSummary = useCopilotStore((s) => s.appliedSummary);
  const lastRequest = useCopilotStore((s) => s.lastRequest);

  // Inline field selection (read live via the global store).
  const selectedField = useInlineEditingStore((s) => s.selectedField);

  const undo = useEditorStore((s) => s.undo);

  // -------------------------------------------------------------------------
  // Open / close
  // -------------------------------------------------------------------------

  const openPanel = useCallback(() => {
    openCopilotPanel();
  }, []);

  const closePanel = useCallback(() => {
    useCopilotStore.getState().closePanel();
  }, []);

  const togglePanel = useCallback(() => {
    const wasOpen = useCopilotStore.getState().open;
    useCopilotStore.getState().togglePanel();
    if (!wasOpen) openCopilotPanel();
  }, []);

  const setScopeChoice = useCallback((choice: CopilotScopeChoice) => {
    useCopilotStore.getState().setScopeChoice(choice);
  }, []);

  const setSelectedOperationIds = useCallback((ids: string[]) => {
    useCopilotStore.getState().setSelectedOperationIds(ids);
  }, []);

  // -------------------------------------------------------------------------
  // Send a message
  // -------------------------------------------------------------------------

  const sendMessage = useCallback(async (rawInstruction: string) => {
    const store = useCopilotStore.getState();
    const instruction = rawInstruction.trim();
    if (!instruction) return;
    if (store.status === "planning" || store.status === "applying") return;

    // The user moved on — discard any pending plan/suggestion so a stale
    // approval surface can never linger or render alongside a new request.
    store.clearPlan();

    const editor = useEditorStore.getState();
    const field = useInlineEditingStore.getState().selectedField;

    // Resolve the scope NOW so it is available for the conversation record,
    // the plan request, and Regenerate — even if planning fails.
    const scope = resolveEffectiveScope(
      store.scopeChoice,
      editor.project,
      editor.selectedPageId,
      editor.selectedSectionId,
      field,
      store.messages,
      instruction,
    );

    store.addUserMessage(instruction);
    store.setStatus("planning");
    store.setLastRequest({ instruction, scope });

    const seq = store.nextRequestSeq();

    // Fresh deterministic readiness report (never stale from a closure).
    const report = getLaunchReadinessReport(editor.project, {
      hasPreviewedMobile: useGuidedBuilderStore.getState().hasPreviewedMobile,
    });

    const outcome = await handleCopilotMessage(
      {
        instruction,
        scopeChoice: scope, // already resolved — the service uses it directly
        project: editor.project,
        revision: editor.revision,
        selectedPageId: editor.selectedPageId,
        selectedSectionId: editor.selectedSectionId,
        selectedField: field,
        readiness: report,
        device: editor.viewport,
        messages: store.messages,
      },
      {},
    );

    // Stale async response (conversation cleared / project switched).
    if (seq !== useCopilotStore.getState().requestSeq) return;

    const current = useCopilotStore.getState();

    switch (outcome.kind) {
      case "ask":
      case "readiness-review":
        current.addAssistantMessage(outcome.answer, { kind: "question" });
        current.setStatus("completed");
        break;

      case "plan-ready": {
        current.setPlanReady(outcome.planState);
        current.setLastRequest(outcome.lastRequest);
        current.addAssistantMessage(buildPlanPreparedCopy(outcome.planState.plan.operations.length), {
          kind: "edit-plan",
          metadata: {
            scope: toAiEditScope(outcome.lastRequest.scope),
            pageId: outcome.lastRequest.scope.type === "page" ? outcome.lastRequest.scope.pageId : undefined,
            sectionId:
              outcome.lastRequest.scope.type === "section" || outcome.lastRequest.scope.type === "element"
                ? outcome.lastRequest.scope.sectionId
                : undefined,
            planId: outcome.planState.plan.id,
          },
        });
        break;
      }

      case "error":
        current.setError(outcome.error);
        current.addAssistantMessage(outcome.error.message, { kind: "error", status: "error" });
        break;
    }
  }, []);

  // -------------------------------------------------------------------------
  // Apply the awaiting-approval plan
  // -------------------------------------------------------------------------

  const applyPlan = useCallback(() => {
    const store = useCopilotStore.getState();
    const planState = store.planState;
    if (!planState || store.status !== "awaiting-approval") return;
    if (planState.selectedOperationIds.length === 0) return;

    const editor = useEditorStore.getState();

    // Stale guard surfaced early (the editor store also enforces it).
    if (editor.revision !== planState.plan.baseRevision) {
      store.setError({
        code: "COPILOT_PLAN_STALE",
        message: "The page changed before the suggestion could be applied. Try again.",
        retryable: true,
      });
      store.addAssistantMessage(
        "The page changed before the suggestion could be applied. Try again.",
        { kind: "error", status: "error" },
      );
      return;
    }

    store.setApplying();

    // Explicitly checking a high-risk operation IS the confirmation.
    const hasHighRisk = planState.plan.operations.some(
      (op) => op.risk === "high" && planState.selectedOperationIds.includes(op.id),
    );

    const result = applyCopilotPlan(planState.plan, planState.selectedOperationIds, {
      allowDestructive: hasHighRisk,
    });

    const current = useCopilotStore.getState();
    if (!result.ok) {
      current.setError(result.error);
      current.addAssistantMessage(result.error.message, { kind: "error", status: "error" });
      return;
    }

    current.setApplied(result.summary);
    current.addAssistantMessage(buildAppliedCopy(result.summary), {
      kind: "applied",
      metadata: {
        opLabels: result.summary.opLabels,
        pageId: planState.plan.scope.type === "page" ? planState.plan.scope.pageId : undefined,
        sectionId: planState.plan.scope.type === "section" ? planState.plan.scope.sectionId : undefined,
        scope: planState.plan.scope,
      },
    });
  }, []);

  // -------------------------------------------------------------------------
  // Element quick actions (selected text) — single-field suggestions
  // -------------------------------------------------------------------------

  const runElementQuickAction = useCallback(
    async (action: { label: string; instruction: string }) => {
    const store = useCopilotStore.getState();
    if (store.status === "planning" || store.status === "applying") return;

    const field = useInlineEditingStore.getState().selectedField;
    if (!field) {
      store.setError({
        code: "COPILOT_QUICK_ACTION_UNAVAILABLE",
        message: "Select some text on the page first, then try again.",
        retryable: false,
      });
      return;
    }

    // A quick action is a new request — discard any pending plan first.
    store.clearPlan();

    store.addUserMessage(`${action.label}: ${field.label}`);
      store.setStatus("planning");
      const seq = store.nextRequestSeq();

      const editor = useEditorStore.getState();
      const result = await requestElementSuggestion(
        {
          instruction: action.instruction,
          field,
          project: editor.project,
          revision: editor.revision,
        },
        {},
      );

      if (seq !== useCopilotStore.getState().requestSeq) return;
      const current = useCopilotStore.getState();

      if (!result.ok) {
        current.setError(result.error);
        current.addAssistantMessage(result.error.message, { kind: "error", status: "error" });
        return;
      }

      current.setElementSuggestion(result.suggestion, field);
      current.addAssistantMessage(
        `Here's a suggested rewrite for “${field.label}”:\n“${result.suggestion.suggestedValue}”${
          result.suggestion.explanation ? `\n\n${result.suggestion.explanation}` : ""
        }\n\nApply it, or keep editing — either way you can undo with one step.`,
        { kind: "edit-plan" },
      );
    },
    [],
  );

  const applyElementSuggestionAction = useCallback(() => {
    const store = useCopilotStore.getState();
    const suggestion = store.elementSuggestion;
    if (!suggestion || store.status !== "awaiting-approval") return;

    store.setApplying();
    const result = applyElementSuggestion(suggestion.field, suggestion.suggestion);

    const current = useCopilotStore.getState();
    if (!result.ok) {
      current.setError(result.error);
      current.addAssistantMessage(result.error.message, { kind: "error", status: "error" });
      return;
    }

    current.setApplied({
      opLabels: [`“${suggestion.field.label}” text`],
      applied: 1,
      skipped: 0,
    });
    current.addAssistantMessage(
      `Done — updated “${suggestion.field.label}”. Undo with one step if you'd like it back.`,
      { kind: "applied" },
    );
  }, []);

  const rejectElementSuggestion = useCallback(() => {
    const store = useCopilotStore.getState();
    if (!store.elementSuggestion) return;
    store.clearElementSuggestion();
    store.setStatus("completed");
    store.addAssistantMessage("No changes made — the suggestion was dismissed.", {
      kind: "system",
    });
  }, []);

  // -------------------------------------------------------------------------
  // Undo — the normal editor history (no AI-only undo stack)
  // -------------------------------------------------------------------------

  const undoLast = useCallback(() => {
    undo();
    // The summary claimed a change was applied — once undone, clear it so the
    // UI never claims a change that no longer exists. The normal editor
    // history owns the actual state.
    useCopilotStore.setState({ appliedSummary: null, status: "completed" });
    useCopilotStore.getState().addAssistantMessage(
      "Undone — the previous version is restored.",
      { kind: "system" },
    );
  }, [undo]);

  // -------------------------------------------------------------------------
  // Retry / regenerate the last request
  // -------------------------------------------------------------------------

  const regenerate = useCallback(() => {
    const request = useCopilotStore.getState().lastRequest;
    if (!request) return;
    void sendMessage(request.instruction);
  }, [sendMessage]);

  // -------------------------------------------------------------------------
  // Clear conversation
  // -------------------------------------------------------------------------

  const clearConversation = useCallback(() => {
    useCopilotStore.getState().clearConversation();
  }, []);

  // -------------------------------------------------------------------------
  // Reset on project switch
  // -------------------------------------------------------------------------

  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.activeProjectId !== prev.activeProjectId) {
        useCopilotStore.getState().reset();
      }
    });
    return unsub;
  }, []);

  return {
    open,
    status,
    scopeChoice,
    messages,
    planState,
    elementSuggestion,
    error,
    appliedSummary,
    lastRequest,
    selectedField,
    readiness,
    openPanel,
    closePanel,
    togglePanel,
    setScopeChoice,
    setSelectedOperationIds,
    sendMessage,
    applyPlan,
    runElementQuickAction,
    applyElementSuggestionAction,
    rejectElementSuggestion,
    undoLast,
    regenerate,
    clearConversation,
    canUndo: useEditorStore((s) => s.canUndo()),
  };
}

// ---------------------------------------------------------------------------
// Re-exports for UI convenience
// ---------------------------------------------------------------------------

export type { CopilotScope };
