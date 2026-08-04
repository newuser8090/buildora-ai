// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// useAiPlanEdit — Phase L plan lifecycle hook tests (spec §37)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiPlanEdit } from "../useAiPlanEdit";
import { useAiPlanStore } from "../../store/plan-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useChatStore } from "@/features/chat/store/chat-store";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { runPlanEdit } from "../../services/plan-service";
import type { AiEditOperation, AiEditPlan } from "../../plan-types";

vi.mock("../../services/plan-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/plan-service")>();
  return { ...actual, runPlanEdit: vi.fn() };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const REVISION = 3;

function visibilityOp(overrides?: Partial<AiEditOperation>): AiEditOperation {
  return {
    id: "op-1",
    type: "set-section-visibility",
    pageId: "page-1",
    sectionId: "s-faq",
    visible: false,
    label: "Hide FAQ",
    explanation: "Hides the FAQ section.",
    risk: "low",
    ...overrides,
  } as AiEditOperation;
}

function makePlan(overrides?: Partial<AiEditPlan>): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "proj-1",
    baseRevision: REVISION,
    scope: { type: "page", pageId: "page-1" },
    instruction: "Hide the FAQ",
    summary: "One change.",
    operations: [visibilityOp()],
    warnings: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "rule-based",
    ...overrides,
  };
}

type PlanEditResult = Awaited<ReturnType<typeof runPlanEdit>>;

function mockRunPlan(result: PlanEditResult) {
  vi.mocked(runPlanEdit).mockResolvedValue(result);
}

function hydrate() {
  useEditorStore.getState().hydrateProject(MOCK_PROJECT, REVISION);
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiPlanStore.getState().reset();
  useChatStore.getState().clearMessages();
  hydrate();
});

// ---------------------------------------------------------------------------
// Plan creation
// ---------------------------------------------------------------------------

describe("useAiPlanEdit — createPlan", () => {
  it("moves to ready with a plan, diffs, and a default non-destructive selection", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });

    expect(result.current.status).toBe("ready");
    expect(result.current.plan?.id).toBe("plan-1");
    expect(result.current.diffs).toHaveLength(1);
    // default selection includes the low-risk op
    expect(result.current.selectedOperationIds).toEqual(["op-1"]);
    // chat timeline: user + prepared summary
    const messages = useChatStore.getState().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].content).toContain("I prepared 1 proposed change");
    expect(messages[1].status).toBe("complete");
  });

  it("excludes high-risk operations from the default selection", async () => {
    mockRunPlan({
      source: "rule-based",
      plan: makePlan({
        operations: [
          visibilityOp({ id: "op-1" }),
          {
            ...visibilityOp({ id: "op-2" }),
            risk: "high",
            type: "delete-section",
            sectionId: "s-cta",
          } as AiEditOperation,
        ],
      }),
      warnings: [],
    });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide and delete", { type: "page", pageId: "page-1" });
    });

    expect(result.current.selectedOperationIds).toEqual(["op-1"]);
  });

  it("blocks repeated requests while planning", async () => {
    let resolveFetch: (value: PlanEditResult | PromiseLike<PlanEditResult>) => void = () => {};
    vi.mocked(runPlanEdit).mockImplementation(
      () =>
        new Promise<PlanEditResult>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const { result } = renderHook(() => useAiPlanEdit());

    act(() => {
      void result.current.createPlan("first", { type: "page", pageId: "page-1" });
    });
    expect(result.current.status).toBe("planning");
    expect(vi.mocked(runPlanEdit)).toHaveBeenCalledTimes(1);

    act(() => {
      void result.current.createPlan("second", { type: "page", pageId: "page-1" });
    });
    expect(vi.mocked(runPlanEdit)).toHaveBeenCalledTimes(1);

    // resolve so the test does not leak a pending request
    await act(async () => {
      resolveFetch({ source: "rule-based", plan: makePlan(), warnings: [] });
    });
  });

  it("ignores stale async responses after the plan store is reset", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    let resolvePromise: (value: PlanEditResult | PromiseLike<PlanEditResult>) => void = () => {};
    vi.mocked(runPlanEdit).mockImplementation(
      () =>
        new Promise<PlanEditResult>((resolve) => {
          resolvePromise = resolve;
        }),
    );

    let first: Promise<void>;
    act(() => {
      first = result.current.createPlan("hide", { type: "page", pageId: "page-1" });
    });
    expect(result.current.status).toBe("planning");

    // Reset while the request is in flight (e.g. project switch).
    act(() => {
      useAiPlanStore.getState().reset();
    });

    await act(async () => {
      resolvePromise({
        source: "rule-based",
        plan: makePlan(),
        warnings: [],
      });
      await first;
    });

    // The stale response must not resurrect a plan.
    expect(result.current.status).toBe("idle");
    expect(result.current.plan).toBeNull();
  });

  it("surfaces a server error as an error status and chat error", async () => {
    vi.mocked(runPlanEdit).mockRejectedValue(
      new Error("PlanEditClientError: PLAN_PROVIDER_FAILED boom"),
    );
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("improve", { type: "page", pageId: "page-1" });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toContain("boom");
    expect(useChatStore.getState().messages[1].status).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

describe("useAiPlanEdit — applyPlan", () => {
  it("applies the plan atomically and posts an applied summary", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });
    expect(result.current.status).toBe("ready");

    await act(async () => {
      await result.current.applyPlan();
    });

    const faq = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-faq")!;
    expect(faq.visible).toBe(false);
    // applied → plan is reset and closed
    expect(result.current.status).toBe("idle");
    expect(result.current.plan).toBeNull();
    // one history entry
    expect(useEditorStore.getState().history.past.length).toBe(1);
    // chat summary
    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].content).toContain("Applied 1 change");
  });

  it("detects a stale plan before applying and does not mutate the project", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });

    // The project changes after plan creation → revision moves to 4.
    act(() => {
      useEditorStore.getState().setRevision(REVISION + 1);
    });

    await act(async () => {
      await result.current.applyPlan();
    });

    expect(result.current.status).toBe("stale");
    const faq = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-faq")!;
    expect(faq.visible).toBe(true);
    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].content).toContain("changed since the plan");
  });

  it("keeps the review open (error status) when application fails", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });

    // Break the plan: delete the referenced section so application fails.
    const project = useEditorStore.getState().project;
    useEditorStore.getState().setProject({
      ...project,
      pages: [{
        ...project.pages[0],
        sections: project.pages[0].sections.filter((s) => s.id !== "s-faq"),
      }],
    });

    await act(async () => {
      await result.current.applyPlan();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error?.code).toBe("PLAN_OPERATION_INVALID");
  });

  it("applies only the selected operations", async () => {
    mockRunPlan({
      source: "rule-based",
      plan: makePlan({
        operations: [
          visibilityOp({ id: "op-1", sectionId: "s-faq" }),
          {
            ...visibilityOp({ id: "op-2" }),
            sectionId: "s-pricing",
            visible: false,
          } as AiEditOperation,
        ],
      }),
      warnings: [],
    });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide two", { type: "page", pageId: "page-1" });
    });
    await act(async () => {
      await result.current.applyPlan(["op-2"]);
    });

    const store = useEditorStore.getState().project;
    const faq = store.pages[0].sections.find((s) => s.id === "s-faq")!;
    const pricing = store.pages[0].sections.find((s) => s.id === "s-pricing")!;
    expect(faq.visible).toBe(true); // skipped
    expect(pricing.visible).toBe(false); // applied
    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].content).toContain("Skipped 1 change");
  });
});

// ---------------------------------------------------------------------------
// Reset / selection / project switch
// ---------------------------------------------------------------------------

describe("useAiPlanEdit — lifecycle", () => {
  it("clears plan state when the project switches", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });
    expect(result.current.status).toBe("ready");

    const other = JSON.parse(JSON.stringify(MOCK_PROJECT)) as typeof MOCK_PROJECT;
    other.id = "proj-2";
    act(() => {
      useEditorStore.getState().hydrateProject(other, 1);
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.plan).toBeNull();
  });

  it("rejectPlan discards the plan without touching the project", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });
    await act(async () => {
      result.current.rejectPlan();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.plan).toBeNull();
    const faq = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-faq")!;
    expect(faq.visible).toBe(true);
  });

  it("regenerate re-runs the last request against the current revision", async () => {
    mockRunPlan({ source: "rule-based", plan: makePlan(), warnings: [] });
    const { result } = renderHook(() => useAiPlanEdit());

    await act(async () => {
      await result.current.createPlan("Hide the FAQ", { type: "page", pageId: "page-1" });
    });
    expect(vi.mocked(runPlanEdit)).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.regenerate();
    });
    expect(vi.mocked(runPlanEdit)).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("ready");
  });

  it("is unmount-safe: late responses resolve without throwing", async () => {
    let resolvePromise: (value: PlanEditResult | PromiseLike<PlanEditResult>) => void = () => {};
    vi.mocked(runPlanEdit).mockImplementation(
      () =>
        new Promise<PlanEditResult>((resolve) => {
          resolvePromise = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => useAiPlanEdit());

    act(() => {
      void result.current.createPlan("hide", { type: "page", pageId: "page-1" });
    });
    unmount();

    // The plan store is a global zustand store — no React state is updated
    // after unmount, so this must resolve without throwing or warning.
    await act(async () => {
      resolvePromise({ source: "rule-based", plan: makePlan(), warnings: [] });
    });
    expect(useAiPlanStore.getState().plan?.id).toBe("plan-1");
  });
});
