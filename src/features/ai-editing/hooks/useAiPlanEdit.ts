"use client";

import { useCallback, useEffect } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { useAiPlanStore } from "../store/plan-store";
import {
  runPlanEdit,
  PlanEditClientError,
  buildPlanPreparedSummary,
  buildPlanAppliedSummary,
  buildStalePlanSummary,
} from "../services/plan-service";
import { simulatePlan } from "../services/plan-simulator";
import { buildDiffs } from "../services/diff-builder";
import type { AiEditPlanError, AiEditScope } from "../plan-types";

// ---------------------------------------------------------------------------
// useAiPlanEdit — drives the Phase L plan lifecycle
//
//   createPlan → planning → ready (plan + diffs stored) → applyPlan → applied
//   stale detection: applyPlan re-checks revision; store also enforces it
//   plan survives sidebar tab changes (store is global, not component state)
//   cleared on project switch/delete (store reset via subscription)
//   stale async responses ignored via the requestSeq token
// ---------------------------------------------------------------------------

export function useAiPlanEdit() {
  const setGenerating = useEditorStore((s) => s.setGenerating);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);

  const createPlan = useCallback(
    async (instruction: string, scope: AiEditScope) => {
      const store = useAiPlanStore.getState();
      // Repeated request blocked while planning/applying.
      if (store.status === "planning" || store.status === "applying") return;

      addMessage({ role: "user", content: instruction, status: "complete" });
      addMessage({ role: "assistant", content: "", status: "pending" });
      const pendingId = [...useChatStore.getState().messages]
        .reverse()
        .find((m) => m.status === "pending")?.id;
      if (!pendingId) return;

      const seq = useAiPlanStore.getState().nextRequestSeq();
      const editor = useEditorStore.getState();
      useAiPlanStore.getState().beginPlanning();
      setGenerating(true);

      try {
        const result = await runPlanEdit({
          instruction,
          scope,
          project: editor.project,
          selectedPageId: editor.selectedPageId ?? undefined,
          selectedSectionId: editor.selectedSectionId ?? undefined,
          baseRevision: editor.revision,
        });
        // Stale async response (project switched / plan reset) — ignore.
        if (seq !== useAiPlanStore.getState().requestSeq) return;

        // Client-side re-simulation: revalidates the plan against the live
        // project and produces before/after snapshots for diffs.
        const simulation = simulatePlan(editor.project, result.plan.operations, {
          captureSnapshots: true,
        });
        if (!simulation.ok) {
          const error: AiEditPlanError = {
            code: "PLAN_SIMULATION_FAILED",
            message: `The plan no longer fits the project: ${simulation.error.message}`,
          };
          useAiPlanStore.getState().setError(error);
          updateMessage(pendingId, {
            content: error.message,
            status: "error",
          });
          return;
        }

        const diffs = buildDiffs(result.plan.operations, simulation.snapshots);
        const defaultSelection = result.plan.operations
          .filter((op) => op.risk !== "high")
          .map((op) => op.id);

        useAiPlanStore.getState().setReady({
          plan: result.plan,
          selectedOperationIds: defaultSelection,
          diffs,
          warnings: result.warnings,
          lastRequest: {
            instruction,
            scope,
            selectedPageId: editor.selectedPageId ?? undefined,
            selectedSectionId: editor.selectedSectionId ?? undefined,
          },
        });

        updateMessage(pendingId, {
          content: buildPlanPreparedSummary(result.plan, result.source),
          status: "complete",
        });
      } catch (err) {
        if (seq !== useAiPlanStore.getState().requestSeq) return;
        const error: AiEditPlanError =
          err instanceof PlanEditClientError
            ? { code: err.code as AiEditPlanError["code"], message: err.message }
            : {
                code: "PLAN_PROVIDER_FAILED",
                message:
                  err instanceof Error
                    ? err.message
                    : "I couldn't prepare a plan. Please try again.",
              };
        useAiPlanStore.getState().setError(error);
        updateMessage(pendingId, {
          content: error.message,
          status: "error",
        });
      } finally {
        setGenerating(false);
      }
    },
    [addMessage, updateMessage, setGenerating],
  );

  const applyPlan = useCallback(
    async (
      selectedIds?: string[] | null,
      options?: { allowDestructive?: boolean },
    ) => {
      const store = useAiPlanStore.getState();
      const plan = store.plan;
      if (!plan || store.status === "applying") return;

      const editor = useEditorStore.getState();

      // Stale detection before applying — never silently apply a stale plan.
      if (editor.revision !== plan.baseRevision) {
        useAiPlanStore.getState().setStale();
        addMessage({
          role: "assistant",
          content: buildStalePlanSummary(plan),
          status: "complete",
        });
        return;
      }

      useAiPlanStore.getState().setApplying();
      const result = editor.applyAiEditPlan(
        plan,
        selectedIds ?? undefined,
        options,
      );

      if (!result.ok) {
        if (result.error.code === "PLAN_STALE") {
          useAiPlanStore.getState().setStale();
          addMessage({
            role: "assistant",
            content: buildStalePlanSummary(plan),
            status: "complete",
          });
        } else {
          useAiPlanStore.getState().setError(result.error);
        }
        // Review stays open so the user can retry or adjust.
        return;
      }

      useAiPlanStore.getState().setApplied();
      addMessage({
        role: "assistant",
        content: buildPlanAppliedSummary(
          plan,
          result.applied,
          result.skipped,
          plan.provider,
          store.warnings,
        ),
        status: "complete",
      });

      // Success closes the plan — applying remaining operations later
      // requires a regenerated plan (revision changed).
      useAiPlanStore.getState().reset();
    },
    [addMessage],
  );

  // Clear plan state on project switch/delete.
  useEffect(() => {
    const unsub = useEditorStore.subscribe((state, prev) => {
      if (state.activeProjectId !== prev.activeProjectId) {
        useAiPlanStore.getState().reset();
      }
    });
    return unsub;
  }, []);

  const rejectPlan = useCallback(() => {
    useAiPlanStore.getState().reset();
  }, []);

  const regenerate = useCallback(() => {
    const { lastRequest, status } = useAiPlanStore.getState();
    if (!lastRequest) return Promise.resolve();
    if (status === "planning" || status === "applying") return Promise.resolve();
    return createPlan(lastRequest.instruction, lastRequest.scope);
  }, [createPlan]);

  const setSelectedOperationIds = useCallback((ids: string[]) => {
    useAiPlanStore.getState().setSelectedOperationIds(ids);
  }, []);

  // Reactive snapshot for UI rendering.
  const status = useAiPlanStore((s) => s.status);
  const plan = useAiPlanStore((s) => s.plan);
  const selectedOperationIds = useAiPlanStore((s) => s.selectedOperationIds);
  const warnings = useAiPlanStore((s) => s.warnings);
  const error = useAiPlanStore((s) => s.error);
  const diffs = useAiPlanStore((s) => s.diffs);
  const lastRequest = useAiPlanStore((s) => s.lastRequest);

  return {
    createPlan,
    applyPlan,
    rejectPlan,
    regenerate,
    setSelectedOperationIds,
    status,
    plan,
    selectedOperationIds,
    warnings,
    error,
    diffs,
    lastRequest,
    isBusy: status === "planning" || status === "applying",
  };
}
