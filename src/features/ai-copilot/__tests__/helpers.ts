// ---------------------------------------------------------------------------
// AI Copilot — shared test fixtures
// ---------------------------------------------------------------------------

import { useEditorStore } from "@/features/editor/store/editor-store";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { simulatePlan } from "@/features/ai-editing/services/plan-simulator";
import { buildDiffs } from "@/features/ai-editing/services/diff-builder";
import type {
  AiEditOperation,
  AiEditPlan,
  AiEditScope,
} from "@/features/ai-editing/plan-types";

export const REVISION = 3;

/** Hydrate the global editor store with the mock project. */
export function hydrateEditor(): void {
  useEditorStore.getState().hydrateProject(MOCK_PROJECT, REVISION);
}

export function makeOperation(overrides: Partial<AiEditOperation> & { type: AiEditOperation["type"] }): AiEditOperation {
  return {
    id: "op-1",
    label: "Change",
    explanation: "A test operation.",
    risk: "low",
    ...overrides,
  } as AiEditOperation;
}

export function makePlan(
  scope: AiEditScope = { type: "page", pageId: "page-1" },
  operations: AiEditOperation[] = [
    makeOperation({
      type: "set-section-visibility",
      pageId: "page-1",
      sectionId: "s-faq",
      visible: false,
    }),
  ],
  overrides: Partial<AiEditPlan> = {},
): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "proj-1",
    baseRevision: REVISION,
    scope,
    instruction: "Hide the FAQ",
    summary: "One change.",
    operations,
    warnings: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "rule-based",
    ...overrides,
  };
}

/** Build review diffs for a plan against the mock project (as the service does). */
export function diffsForPlan(plan: AiEditPlan) {
  const simulation = simulatePlan(MOCK_PROJECT, plan.operations, {
    captureSnapshots: true,
  });
  if (!simulation.ok) return [];
  return buildDiffs(plan.operations, simulation.snapshots);
}

export { MOCK_PROJECT };
