// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// AiEditPlanReview — review panel tests (spec §16, §37)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AiEditPlanReview } from "../AiEditPlanReview";
import { useAiPlanStore } from "../../store/plan-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { simulatePlan } from "../../services/plan-simulator";
import { buildDiffs } from "../../services/diff-builder";
import type {
  AiEditDiff,
  AiEditOperation,
  AiEditPlan,
  AiEditScope,
} from "../../plan-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVISION = 3;

function baseOp(id: string, risk: AiEditOperation["risk"] = "low"): Partial<AiEditOperation> {
  return { id, label: `Change ${id}`, explanation: `Explanation for ${id}.`, risk };
}

function makePlan(scope: AiEditScope = { type: "page", pageId: "page-1" }): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "proj-1",
    baseRevision: REVISION,
    scope,
    instruction: "Hide the FAQ",
    summary: "One change for the page.",
    operations: [
      {
        ...baseOp("op-1"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "s-faq",
        visible: false,
      } as AiEditOperation,
    ],
    warnings: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "rule-based",
  };
}

function makePlanWithDepsAndRisks(): AiEditPlan {
  const insert: AiEditOperation = {
    ...baseOp("op-1"),
    type: "insert-section",
    pageId: "page-1",
    sectionType: "faq",
    section: {
      id: "new-faq",
      type: "faq",
      order: 99,
      visible: true,
      props: { title: "FAQ", items: [{ question: "Q", answer: "A" }] },
      styles: {},
    },
    position: { type: "end" },
  } as AiEditOperation;
  const update: AiEditOperation = {
    ...baseOp("op-2"),
    type: "update-section-props",
    pageId: "page-1",
    sectionId: "new-faq",
    sectionType: "faq",
    nextProps: { title: "FAQ v2", items: [{ question: "Q", answer: "A" }] },
    dependsOn: ["op-1"],
  } as AiEditOperation;
  const deleteOp: AiEditOperation = {
    ...baseOp("op-3", "high"),
    type: "delete-section",
    pageId: "page-1",
    sectionId: "s-cta",
  } as AiEditOperation;
  return {
    ...makePlan(),
    summary: "Insert, update, delete.",
    operations: [insert, update, deleteOp],
  };
}

function buildDiffsFor(plan: AiEditPlan): AiEditDiff[] {
  const simulation = simulatePlan(MOCK_PROJECT, plan.operations, {
    captureSnapshots: true,
  });
  if (!simulation.ok) return [];
  return buildDiffs(plan.operations, simulation.snapshots);
}

function seedReady(plan: AiEditPlan, selectedIds?: string[]) {
  const diffs = buildDiffsFor(plan);
  const selection =
    selectedIds ?? plan.operations.filter((op) => op.risk !== "high").map((op) => op.id);
  useAiPlanStore.getState().setReady({
    plan,
    selectedOperationIds: selection,
    diffs,
    warnings: [],
    lastRequest: {
      instruction: plan.instruction,
      scope: plan.scope,
    },
  });
}

function hydrate() {
  useEditorStore.getState().hydrateProject(MOCK_PROJECT, REVISION);
}

function renderReview(reopenKey = "1") {
  return render(<AiEditPlanReview reopenKey={reopenKey} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiPlanStore.getState().reset();
  useChatStore.getState().clearMessages();
  hydrate();
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("AiEditPlanReview — rendering", () => {
  it("shows the plan summary, scope, provider, and operation count", () => {
    seedReady(makePlan());
    renderReview();

    expect(screen.getByTestId("ai-plan-review")).toBeTruthy();
    expect(screen.getByText(/One change for the page/)).toBeTruthy();
    expect(screen.getByText(/1 proposed change/)).toBeTruthy();
    expect(screen.getByText(/rule-based/)).toBeTruthy();
    expect(screen.getByText(/revision 3/)).toBeTruthy();
    expect(screen.getByTestId("plan-op-op-1")).toBeTruthy();
  });

  it("renders risk badges per operation", () => {
    seedReady(makePlanWithDepsAndRisks());
    renderReview();

    expect(screen.getByTestId("plan-op-risk-op-1").textContent).toContain("Low");
    expect(screen.getByTestId("plan-op-risk-op-3").textContent).toContain("Destructive");
  });

  it("renders the diff view when expanded", () => {
    const plan = makePlan();
    seedReady(plan);
    renderReview();

    const toggle = screen.getByLabelText("Show diff");
    fireEvent.click(toggle);

    expect(screen.getByText("Visibility")).toBeTruthy();
    expect(screen.getByText("Visible")).toBeTruthy();
  });

  it("returns null when there is no plan", () => {
    const { container } = renderReview();
    expect(container.firstChild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selection & dependencies
// ---------------------------------------------------------------------------

describe("AiEditPlanReview — selection", () => {
  it("high-risk operations are unchecked by default and checkable", () => {
    seedReady(makePlanWithDepsAndRisks());
    renderReview();

    const checkboxes = [
      screen.getByTestId("plan-op-checkbox-op-1"),
      screen.getByTestId("plan-op-checkbox-op-2"),
      screen.getByTestId("plan-op-checkbox-op-3"),
    ] as HTMLInputElement[];

    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
    expect(checkboxes[2].checked).toBe(false); // high-risk default off
    expect(screen.getByTestId("plan-selected-count").textContent).toBe("2");
  });

  it("disables a dependent operation when its prerequisite is unchecked", () => {
    seedReady(makePlanWithDepsAndRisks(), ["op-2"]); // op-2 selected but op-1 not
    renderReview();

    const update = screen.getByTestId("plan-op-checkbox-op-2") as HTMLInputElement;
    expect(update.disabled).toBe(true);
    expect(screen.getByText(/Depends on:/)).toBeTruthy();
    // checked state reflects disabled → visually unchecked
    expect(update.checked).toBe(false);
  });

  it("shows the selected count and Apply Selected applies only those", async () => {
    seedReady(makePlanWithDepsAndRisks());
    renderReview();

    // Select only the insert op.
    const update = screen.getByTestId("plan-op-checkbox-op-2") as HTMLInputElement;
    fireEvent.click(update); // uncheck
    const del = screen.getByTestId("plan-op-checkbox-op-3") as HTMLInputElement;
    fireEvent.click(del); // check high-risk delete
    expect(screen.getByTestId("plan-selected-count").textContent).toBe("2");

    // Destructive confirm flow for Apply Selected.
    fireEvent.click(screen.getByTestId("plan-apply-selected"));
    expect(screen.getByTestId("plan-destructive-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-confirm-destructive"));

    await waitFor(() => {
      const store = useEditorStore.getState();
      const inserted = store.project.pages[0].sections.find((s) => s.id === "new-faq");
      expect(inserted).toBeTruthy();
      expect(store.project.pages[0].sections.some((s) => s.id === "s-cta")).toBe(false);
    });
    // plan closed after success
    expect(useAiPlanStore.getState().plan).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Apply flows
// ---------------------------------------------------------------------------

describe("AiEditPlanReview — apply flows", () => {
  it("Apply All applies every operation in one history entry", async () => {
    const plan = makePlanWithDepsAndRisks();
    seedReady(plan, plan.operations.map((op) => op.id));
    renderReview();

    // High-risk ops are selected → confirmation is required first.
    fireEvent.click(screen.getByTestId("plan-apply-all"));
    expect(screen.getByTestId("plan-destructive-confirm")).toBeTruthy();
    fireEvent.click(screen.getByTestId("plan-confirm-destructive"));

    await waitFor(() => {
      const store = useEditorStore.getState();
      const sections = store.project.pages[0].sections;
      expect(sections.some((s) => s.id === "s-cta")).toBe(false);
      expect(sections.some((s) => s.id === "new-faq")).toBe(true);
      expect(store.history.past.length).toBe(1);
    });
  });

  it("Apply All without high-risk ops applies immediately", async () => {
    seedReady(makePlan());
    renderReview();

    fireEvent.click(screen.getByTestId("plan-apply-all"));

    await waitFor(() => {
      const faq = useEditorStore
        .getState()
        .project.pages[0].sections.find((s) => s.id === "s-faq")!;
      expect(faq.visible).toBe(false);
    });
    expect(useAiPlanStore.getState().plan).toBeNull();
  });

  it("rejects destructive confirmations without applying anything", async () => {
    seedReady(makePlanWithDepsAndRisks());
    renderReview();

    fireEvent.click(screen.getByTestId("plan-apply-all"));
    expect(screen.getByTestId("plan-destructive-confirm")).toBeTruthy();

    // Cancel the confirmation (the secondary button).
    const cancelButtons = screen.getAllByText("Cancel");
    fireEvent.click(cancelButtons[0]);

    expect(screen.queryByTestId("plan-destructive-confirm")).toBeNull();
    const store = useEditorStore.getState();
    expect(store.project.pages[0].sections.some((s) => s.id === "s-cta")).toBe(true);
    expect(useAiPlanStore.getState().plan).not.toBeNull();
  });

  it("keeps the review open with an error banner when application fails", async () => {
    seedReady(makePlan());
    renderReview();

    // Break the project so the plan cannot apply.
    const project = useEditorStore.getState().project;
    useEditorStore.getState().setProject({
      ...project,
      pages: [{
        ...project.pages[0],
        sections: project.pages[0].sections.filter((s) => s.id !== "s-faq"),
      }],
    });

    fireEvent.click(screen.getByTestId("plan-apply-all"));

    await waitFor(() => {
      expect(screen.getByTestId("plan-apply-error")).toBeTruthy();
    });
    // Review stays open so the user can retry.
    expect(screen.getByTestId("ai-plan-review")).toBeTruthy();
    expect(useAiPlanStore.getState().plan).not.toBeNull();
  });

  it("disables apply buttons while applying", () => {
    const plan = makePlan();
    seedReady(plan);
    useAiPlanStore.getState().setApplying();
    renderReview();

    const applyAll = screen.getByTestId("plan-apply-all") as HTMLButtonElement;
    const applySelected = screen.getByTestId("plan-apply-selected") as HTMLButtonElement;
    expect(applyAll.disabled).toBe(true);
    expect(applySelected.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stale / reject / dismiss
// ---------------------------------------------------------------------------

describe("AiEditPlanReview — stale, reject, dismiss", () => {
  it("shows the stale banner with Regenerate and Discard actions", () => {
    seedReady(makePlan());
    useAiPlanStore.getState().setStale();
    renderReview();

    expect(screen.getByTestId("plan-stale-banner")).toBeTruthy();
    expect(screen.getByText(/project changed since the plan was created/i)).toBeTruthy();
    expect(screen.getByTestId("plan-regenerate")).toBeTruthy();
    expect(screen.getByTestId("plan-discard")).toBeTruthy();
    // no apply actions in stale state
    expect(screen.queryByTestId("plan-apply-all")).toBeNull();
  });

  it("Discard clears the plan", () => {
    seedReady(makePlan());
    useAiPlanStore.getState().setStale();
    renderReview();

    fireEvent.click(screen.getByTestId("plan-discard"));
    expect(useAiPlanStore.getState().plan).toBeNull();
    expect(useAiPlanStore.getState().status).toBe("idle");
  });

  it("Reject plan clears the plan and closes the panel", () => {
    seedReady(makePlan());
    renderReview();

    fireEvent.click(screen.getByTestId("plan-reject"));
    expect(useAiPlanStore.getState().plan).toBeNull();
    expect(screen.queryByTestId("ai-plan-review")).toBeNull();
  });

  it("Escape dismisses the panel but keeps the plan alive", () => {
    seedReady(makePlan());
    renderReview();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("ai-plan-review")).toBeNull();
    expect(useAiPlanStore.getState().plan).not.toBeNull();
  });

  it("Escape does not dismiss while applying", () => {
    seedReady(makePlan());
    useAiPlanStore.getState().setApplying();
    renderReview();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("ai-plan-review")).toBeTruthy();
  });

  it("a fresh mount (sidebar remount via key) reopens a dismissed panel", () => {
    seedReady(makePlan());
    const { unmount } = render(<AiEditPlanReview reopenKey="1" />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("ai-plan-review")).toBeNull();

    // The sidebar remounts the panel with a new key on "Review Plan".
    unmount();
    seedReady(makePlan());
    render(<AiEditPlanReview reopenKey="2" />);
    expect(screen.getByTestId("ai-plan-review")).toBeTruthy();
  });
});
