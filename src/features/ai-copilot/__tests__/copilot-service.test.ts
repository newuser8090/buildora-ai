// ---------------------------------------------------------------------------
// AI Copilot — orchestration service tests (spec §6–§10)
//   - scope resolution (auto / explicit / follow-up)
//   - plan request + client-side revalidation (invalid plans never shown)
//   - structured error mapping (beginner-safe)
//   - atomic apply → ONE history boundary, undo, no half-applied plans
//   - stale plans apply nothing
//   - ASK vs EDIT routing
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { resetPerf, countPerf } from "@/features/perf/perf-instrumentation";
import { COPILOT_PERF } from "../constants";
import type { AiEditPlan } from "@/features/ai-editing/plan-types";
import type { EditableFieldDescriptor } from "@/features/inline-editing/types";
import {
  resolveEffectiveScope,
  toCopilotError,
  requestCopilotPlan,
  applyCopilotPlan,
  handleCopilotMessage,
  applyElementSuggestion,
  requestElementSuggestion,
  type CopilotServiceDeps,
} from "../services/copilot-service";
import { hydrateEditor, makePlan, makeOperation, MOCK_PROJECT, REVISION } from "./helpers";
import type { CopilotMessage } from "../types";

function heroField(): EditableFieldDescriptor {
  return {
    pageId: "page-1",
    sectionId: "s-hero",
    sectionType: "hero",
    fieldPath: ["headline"],
    kind: "textarea",
    label: "Headline",
    currentValue: "Build beautiful websites\nwith AI assistance",
    aiEditable: true,
  };
}

function okPlanResult(plan: AiEditPlan) {
  return { source: "rule-based" as const, plan, warnings: [] };
}

function depsWith(requestPlan: CopilotServiceDeps["requestPlan"]): CopilotServiceDeps {
  return { requestPlan };
}

beforeEach(() => {
  resetPerf();
  hydrateEditor();
  vi.clearAllMocks();
});

describe("resolveEffectiveScope", () => {
  it("honors an explicit scope choice", () => {
    const scope = resolveEffectiveScope(
      { type: "page", pageId: "page-1" },
      MOCK_PROJECT,
      null,
      null,
      null,
      [],
      "improve",
    );
    expect(scope).toEqual({ type: "page", pageId: "page-1" });
  });

  it("auto-scope prefers a selected editable element", () => {
    const scope = resolveEffectiveScope(
      "auto",
      MOCK_PROJECT,
      "page-1",
      "s-hero",
      heroField(),
      [],
      "make it shorter",
    );
    expect(scope.type).toBe("element");
  });

  it("auto-scope defaults to the current page when nothing is selected", () => {
    const scope = resolveEffectiveScope("auto", MOCK_PROJECT, "page-1", null, null, [], "improve");
    expect(scope).toEqual({ type: "page", pageId: "page-1" });
  });

  it("auto-scope resolves an explicit page reference in a follow-up", () => {
    const project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as typeof MOCK_PROJECT;
    project.pages = [
      ...project.pages,
      { id: "page-2", title: "About", slug: "/about", sections: [], meta: {} },
    ];
    const scope = resolveEffectiveScope("auto", project, "page-1", null, null, [], "do the same on the About page");
    expect(scope).toEqual({ type: "page", pageId: "page-2" });
  });
});

describe("toCopilotError", () => {
  it("maps stale/mismatch to a beginner retryable message", () => {
    const error = toCopilotError({ code: "PLAN_STALE", message: "raw" });
    expect(error.code).toBe("COPILOT_PLAN_STALE");
    expect(error.message).toMatch(/changed before/i);
    expect(error.retryable).toBe(true);
  });

  it("maps validation failures to a safety message without raw details", () => {
    const error = toCopilotError({
      code: "PLAN_VALIDATION_FAILED",
      message: "secret internal detail",
    });
    expect(error.code).toBe("COPILOT_PLAN_INVALID");
    expect(error.message).not.toContain("secret internal detail");
  });
});

describe("requestCopilotPlan", () => {
  it("returns a plan state with diffs and a safe default selection", async () => {
    const plan = makePlan();
    const result = await requestCopilotPlan(
      {
        instruction: "Hide the FAQ",
        scope: { type: "page", pageId: "page-1" },
        project: MOCK_PROJECT,
        revision: REVISION,
      },
      depsWith(vi.fn().mockResolvedValue(okPlanResult(plan))),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.planState.plan.id).toBe("plan-1");
    expect(result.planState.diffs.length).toBeGreaterThan(0);
    expect(result.planState.selectedOperationIds).toContain("op-1");
    expect(countPerf(COPILOT_PERF.planReceived)).toBe(1);
    expect(countPerf(COPILOT_PERF.planValidated)).toBe(1);
  });

  it("never shows a plan whose operations no longer fit the project", async () => {
    // Operation targets a section that does not exist in the live project.
    const plan = makePlan(
      { type: "page", pageId: "page-1" },
      [
        makeOperation({
          type: "set-section-visibility",
          pageId: "page-1",
          sectionId: "s-does-not-exist",
          visible: false,
        }),
      ],
    );
    const result = await requestCopilotPlan(
      {
        instruction: "hide something",
        scope: { type: "page", pageId: "page-1" },
        project: MOCK_PROJECT,
        revision: REVISION,
      },
      depsWith(vi.fn().mockResolvedValue(okPlanResult(plan))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_INVALID");
    expect(result.error.message).toMatch(/no longer fits/i);
  });

  it("maps a provider failure to a beginner error", async () => {
    const result = await requestCopilotPlan(
      {
        instruction: "improve",
        scope: { type: "page", pageId: "page-1" },
        project: MOCK_PROJECT,
        revision: REVISION,
      },
      depsWith(vi.fn().mockRejectedValue(new Error("timeout at provider"))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PROVIDER_FAILED");
    expect(result.error.message).not.toContain("timeout at provider");
  });

  it("rejects a plan carrying a javascript: href before it can be shown or applied", async () => {
    const hero = MOCK_PROJECT.pages[0].sections.find((s) => s.type === "hero")!;
    const nextProps = JSON.parse(JSON.stringify(hero.props));
    nextProps.primaryCta.href = "javascript:alert(1)";
    const maliciousPlan = makePlan(
      { type: "page", pageId: "page-1" },
      [
        makeOperation({
          id: "op-x",
          type: "update-section-props",
          pageId: "page-1",
          sectionId: hero.id,
          sectionType: "hero",
          nextProps,
        }),
      ],
      { id: "plan-malicious" },
    );
    const result = await requestCopilotPlan(
      {
        instruction: "Make the CTA dangerous",
        scope: { type: "page", pageId: "page-1" },
        project: MOCK_PROJECT,
        revision: REVISION,
      },
      depsWith(vi.fn().mockResolvedValue(okPlanResult(maliciousPlan))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_INVALID");
    expect(result.error.message).toMatch(/safety checks/i);
  });

  it("rejects a plan with prototype-pollution keys", async () => {
    const hero = MOCK_PROJECT.pages[0].sections.find((s) => s.type === "hero")!;
    // Build the payload with an OWN enumerable "__proto__" key (plain
    // assignment or object-literal syntax would set the prototype instead).
    const nextProps = JSON.parse(JSON.stringify(hero.props));
    Object.defineProperty(nextProps, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const pollutedPlan = makePlan(
      { type: "page", pageId: "page-1" },
      [
        makeOperation({
          id: "op-x",
          type: "update-section-props",
          pageId: "page-1",
          sectionId: hero.id,
          sectionType: "hero",
          nextProps,
        }),
      ],
      { id: "plan-polluted" },
    );
    const result = await requestCopilotPlan(
      {
        instruction: "Change the hero",
        scope: { type: "page", pageId: "page-1" },
        project: MOCK_PROJECT,
        revision: REVISION,
      },
      depsWith(vi.fn().mockResolvedValue(okPlanResult(pollutedPlan))),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_INVALID");
  });
});

describe("applyCopilotPlan — atomicity and history", () => {
  it("applies the selected operations as ONE history entry", () => {
    const plan = makePlan(
      { type: "page", pageId: "page-1" },
      [
        makeOperation({
          id: "op-1",
          type: "set-section-visibility",
          pageId: "page-1",
          sectionId: "s-faq",
          visible: false,
        }),
        makeOperation({
          id: "op-2",
          type: "set-section-visibility",
          pageId: "page-1",
          sectionId: "s-pricing",
          visible: false,
        }),
      ],
    );

    const result = applyCopilotPlan(plan, ["op-1", "op-2"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.applied).toBe(2);
    expect(result.summary.skipped).toBe(0);

    const store = useEditorStore.getState();
    const faq = store.project.pages[0].sections.find((s) => s.id === "s-faq")!;
    const pricing = store.project.pages[0].sections.find((s) => s.id === "s-pricing")!;
    expect(faq.visible).toBe(false);
    expect(pricing.visible).toBe(false);
    // Exactly one history entry for the whole plan.
    expect(store.history.past.length).toBe(1);
    expect(countPerf(COPILOT_PERF.planApplied)).toBe(1);
  });

  it("undo restores the pre-plan state in one step", () => {
    const plan = makePlan();
    const result = applyCopilotPlan(plan, ["op-1"]);
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-faq")!.visible).toBe(false);

    useEditorStore.getState().undo();
    const faq = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-faq")!;
    expect(faq.visible).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("rejects an empty selection without touching the project", () => {
    const plan = makePlan();
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = applyCopilotPlan(plan, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_FAILED");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });

  it("rejects a stale plan and applies nothing", () => {
    const plan = makePlan();
    useEditorStore.getState().setRevision(REVISION + 1);
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = applyCopilotPlan(plan, ["op-1"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_STALE");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("rejects a plan from another project", () => {
    const plan = makePlan({ type: "project" }, [], { projectId: "other-project" });
    const result = applyCopilotPlan(plan, ["op-1"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_STALE"); // PLAN_PROJECT_MISMATCH → COPILOT_PLAN_STALE
  });

  it("requires explicit confirmation for destructive operations", () => {
    const plan = makePlan(
      { type: "page", pageId: "page-1" },
      [
        makeOperation({
          id: "op-del",
          type: "delete-section",
          pageId: "page-1",
          sectionId: "s-cta",
          risk: "high",
        }),
      ],
    );
    const result = applyCopilotPlan(plan, ["op-del"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_FAILED");
    expect(result.error.message).toMatch(/confirmation/i);
  });
});

describe("handleCopilotMessage", () => {
  function input(overrides: Record<string, unknown> = {}) {
    return {
      instruction: "Make the hero shorter",
      scopeChoice: "auto" as const,
      project: MOCK_PROJECT,
      revision: REVISION,
      selectedPageId: "page-1",
      selectedSectionId: null,
      selectedField: null,
      readiness: null,
      device: "desktop" as const,
      messages: [] as CopilotMessage[],
      ...overrides,
    };
  }

  it("routes questions to ASK with no provider call and no mutation", async () => {
    const requestPlan = vi.fn();
    const result = await handleCopilotMessage(
      input({ instruction: "What does canonical URL mean?" }),
      depsWith(requestPlan),
    );
    expect(result.kind).toBe("ask");
    expect(requestPlan).not.toHaveBeenCalled();
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("routes readiness reviews to the deterministic review answer", async () => {
    const result = await handleCopilotMessage(
      input({ instruction: "Check this page for obvious problems" }),
    );
    expect(result.kind).toBe("readiness-review");
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("routes edits through the planner and returns a plan-ready outcome", async () => {
    const plan = makePlan();
    const result = await handleCopilotMessage(
      input({ instruction: "Hide the FAQ" }),
      depsWith(vi.fn().mockResolvedValue(okPlanResult(plan))),
    );
    expect(result.kind).toBe("plan-ready");
    if (result.kind !== "plan-ready") return;
    expect(result.lastRequest.scope.type).toBe("page");
    expect(countPerf(COPILOT_PERF.contextBuild)).toBe(1);
  });

  it("returns an error outcome for empty instructions", async () => {
    const result = await handleCopilotMessage(input({ instruction: "   " }));
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error.code).toBe("COPILOT_EMPTY_INSTRUCTION");
  });

  it("surfaces planner failures as beginner error outcomes", async () => {
    const result = await handleCopilotMessage(
      input({ instruction: "Hide the FAQ" }),
      depsWith(vi.fn().mockRejectedValue(new Error("provider down"))),
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.error.code).toBe("COPILOT_PROVIDER_FAILED");
  });
});

describe("applyElementSuggestion — quick actions", () => {
  it("applies a suggestion atomically when revision matches", () => {
    const suggestion = {
      projectId: "proj-1",
      baseRevision: REVISION,
      sectionId: "s-hero",
      fieldPath: ["headline"],
      suggestedValue: "Ship faster with AI",
      reason: "Sharper headline",
    };
    const result = applyElementSuggestion(heroField(), suggestion as never);
    expect(result.ok).toBe(true);
    const store = useEditorStore.getState();
    const hero = store.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect((hero.props as Record<string, unknown>).headline).toBe("Ship faster with AI");
    expect(store.history.past.length).toBe(1);
  });

  it("rejects a stale suggestion and changes nothing", () => {
    const suggestion = {
      projectId: "proj-1",
      baseRevision: REVISION + 5,
      sectionId: "s-hero",
      fieldPath: ["headline"],
      suggestedValue: "Stale",
      reason: "old",
    };
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = applyElementSuggestion(heroField(), suggestion as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("COPILOT_PLAN_STALE");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });
});

describe("style notes → instruction suffix (Phase P11)", () => {
  function styleInput(overrides: Record<string, unknown> = {}) {
    return {
      instruction: "Make the hero friendlier",
      scopeChoice: "auto" as const,
      project: MOCK_PROJECT,
      revision: REVISION,
      selectedPageId: "page-1",
      selectedSectionId: "s-hero",
      selectedField: null,
      readiness: null,
      device: "desktop" as const,
      messages: [] as CopilotMessage[],
      styleNotes: ["keep it friendly", "use British spelling"],
      ...overrides,
    };
  }

  it("appends the bounded style suffix to a plan-edit instruction", async () => {
    const requestPlan = vi.fn().mockResolvedValue(okPlanResult(makePlan()));
    const outcome = await handleCopilotMessage(
      styleInput(),
      depsWith(requestPlan),
    );
    expect(outcome.kind).toBe("plan-ready");
    const sent = requestPlan.mock.calls[0][0].instruction as string;
    expect(sent).toContain("keep it friendly");
    expect(sent).toContain("use British spelling");
  });

  it("keeps the raw instruction in lastRequest so Regenerate re-applies the suffix", async () => {
    const requestPlan = vi.fn().mockResolvedValue(okPlanResult(makePlan()));
    const outcome = await handleCopilotMessage(
      styleInput(),
      depsWith(requestPlan),
    );
    if (outcome.kind !== "plan-ready") throw new Error("expected plan-ready");
    expect(outcome.lastRequest.instruction).toBe("Make the hero friendlier");
    expect(outcome.lastRequest.instruction).not.toContain("keep it friendly");
  });

  it("does not append style notes for ASK intents (no provider call)", async () => {
    const requestPlan = vi.fn();
    const outcome = await handleCopilotMessage(
      styleInput({ instruction: "Why does this page feel crowded?" }),
      depsWith(requestPlan),
    );
    expect(outcome.kind).toBe("ask");
    expect(requestPlan).not.toHaveBeenCalled();
  });

  it("passes the style suffix to element quick-action suggestions", async () => {
    const request = vi.fn().mockResolvedValue({
      suggestion: {
        projectId: "proj-1",
        baseRevision: REVISION,
        sectionId: "s-hero",
        fieldPath: ["headline"],
        suggestedValue: "Friendlier headline",
        reason: "style",
      },
    });
    const result = await requestElementSuggestion(
      {
        instruction: "Rewrite this text",
        field: heroField(),
        project: MOCK_PROJECT,
        revision: REVISION,
        styleNotes: ["keep it friendly"],
      },
      { requestElementSuggestion: request },
    );
    expect(result.ok).toBe(true);
    const sent = request.mock.calls[0][0].instruction as string;
    expect(sent).toContain("keep it friendly");
  });
});
