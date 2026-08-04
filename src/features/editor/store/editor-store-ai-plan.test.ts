// ---------------------------------------------------------------------------
// Editor store — atomic AI plan application (spec §35)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import type { AiEditOperation, AiEditPlan } from "@/features/ai-editing/plan-types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(): Project {
  return {
    id: "test-proj",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          { id: "hero-1", type: "hero", order: 1, visible: true, props: { headline: "Original Headline", subheadline: "Sub", primaryCta: { text: "Get Started", href: "#" } }, styles: {} },
          { id: "faq-1", type: "faq", order: 2, visible: true, props: { title: "FAQ", items: [{ question: "Q", answer: "A" }] }, styles: {} },
          { id: "cta-1", type: "cta", order: 3, visible: true, props: { headline: "CTA", ctaText: "Go", ctaHref: "#" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function baseOp(id: string): Partial<AiEditOperation> {
  return { id, label: "Change", explanation: "Test change.", risk: "low" };
}

function makePlan(revision = 1, operations?: AiEditOperation[]): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "test-proj",
    baseRevision: revision,
    scope: { type: "page", pageId: "page-1" },
    instruction: "Test",
    summary: "Test plan.",
    operations: operations ?? [
      {
        ...baseOp("op-1"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "hero-1",
        sectionType: "hero",
        nextProps: { headline: "AI Headline", subheadline: "Sub", primaryCta: { text: "Get Started", href: "#" } },
      } as AiEditOperation,
    ],
    warnings: [],
    createdAt: "2026-01-02T00:00:00.000Z",
    provider: "rule-based",
  };
}

function hydrate(project: Project, revision = 1) {
  useEditorStore.getState().hydrateProject(project, revision);
}

function heroHeadline(): string {
  return useEditorStore
    .getState()
    .project.pages[0].sections.find((s) => s.id === "hero-1")!.props.headline as string;
}

beforeEach(() => {
  useEditorStore.setState({
    project: makeProject(),
    selectedSectionId: null,
    selectedPageId: "page-1",
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: {
      past: [],
      present: makeProject(),
      future: [],
    },
    _editingSession: null,
    revision: 1,
    isDirty: false,
    activeProjectId: "test-proj",
    saveStatus: "saved",
  });
});

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

describe("applyAiEditPlan — application", () => {
  it("applies a full plan as one atomic change", () => {
    hydrate(makeProject(), 1);
    const result = useEditorStore.getState().applyAiEditPlan(makePlan(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(heroHeadline()).toBe("AI Headline");
  });

  it("applies a selected subset preserving plan order", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "hero-1",
        sectionType: "hero",
        nextProps: { headline: "One", subheadline: "Sub", primaryCta: { text: "Get Started", href: "#" } },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "faq-1",
        visible: false,
      } as AiEditOperation,
    ]);
    const result = useEditorStore.getState().applyAiEditPlan(plan, ["op-2"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(1);
    expect(heroHeadline()).toBe("Original Headline");
    const faq = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "faq-1")!;
    expect(faq.visible).toBe(false);
  });

  it("creates exactly one history entry for a multi-operation plan", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "hero-1",
        sectionType: "hero",
        nextProps: { headline: "One", subheadline: "Sub", primaryCta: { text: "Get Started", href: "#" } },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "faq-1",
        visible: false,
      } as AiEditOperation,
      {
        ...baseOp("op-3"),
        type: "move-section",
        pageId: "page-1",
        sectionId: "cta-1",
        targetIndex: 0,
      } as AiEditOperation,
    ]);
    const result = useEditorStore.getState().applyAiEditPlan(plan);
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(1);
  });

  it("one Undo restores the complete pre-plan project and one Redo reapplies", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "hero-1",
        sectionType: "hero",
        nextProps: { headline: "Changed", subheadline: "Sub", primaryCta: { text: "Get Started", href: "#" } },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "faq-1",
        visible: false,
      } as AiEditOperation,
    ]);
    useEditorStore.getState().applyAiEditPlan(plan);

    useEditorStore.getState().undo();
    expect(heroHeadline()).toBe("Original Headline");
    const faq = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "faq-1")!;
    expect(faq.visible).toBe(true);

    useEditorStore.getState().redo();
    expect(heroHeadline()).toBe("Changed");
    expect(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "faq-1")!.visible,
    ).toBe(false);
  });

  it("rejects stale plans (revision changed since creation)", () => {
    hydrate(makeProject(), 2);
    const result = useEditorStore.getState().applyAiEditPlan(makePlan(1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_STALE");
    expect(heroHeadline()).toBe("Original Headline");
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("rejects plans for a different project", () => {
    hydrate(makeProject(), 1);
    const otherPlan = { ...makePlan(1), projectId: "other-project" };
    const mismatch = useEditorStore.getState().applyAiEditPlan(otherPlan);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe("PLAN_PROJECT_MISMATCH");
  });

  it("no-op selection applies nothing and creates no history", () => {
    hydrate(makeProject(), 1);
    const result = useEditorStore.getState().applyAiEditPlan(makePlan(1), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(0);
    expect(heroHeadline()).toBe("Original Headline");
  });

  it("rejects selected operations that break dependency closure", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "insert-section",
        pageId: "page-1",
        sectionType: "faq",
        section: { id: "new-faq", type: "faq", order: 1, visible: true, props: { title: "FAQ", items: [{ question: "Q", answer: "A" }] }, styles: {} },
        position: { type: "end" },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "new-faq",
        sectionType: "faq",
        nextProps: { title: "FAQ v2", items: [{ question: "Q", answer: "A" }] },
        dependsOn: ["op-1"],
      } as AiEditOperation,
    ]);
    const result = useEditorStore.getState().applyAiEditPlan(plan, ["op-2"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_DEPENDENCY_INVALID");
  });

  it("requires destructive confirmation for high-risk operations", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        risk: "high",
        type: "delete-section",
        pageId: "page-1",
        sectionId: "faq-1",
      } as AiEditOperation,
    ]);
    const denied = useEditorStore.getState().applyAiEditPlan(plan);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe("PLAN_DESTRUCTIVE_CONFIRMATION_REQUIRED");
    }
    expect(heroHeadline()).toBe("Original Headline");

    const allowed = useEditorStore.getState().applyAiEditPlan(plan, undefined, {
      allowDestructive: true,
    });
    expect(allowed.ok).toBe(true);
  });

  it("failed application leaves the project untouched", () => {
    hydrate(makeProject(), 1);
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "faq-1",
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        risk: "high",
        type: "delete-section",
        pageId: "page-1",
        sectionId: "hero-1",
      } as AiEditOperation,
    ]);
    // Without destructive confirmation the whole plan is rejected atomically.
    const result = useEditorStore.getState().applyAiEditPlan(plan);
    expect(result.ok).toBe(false);
    const sections = useEditorStore.getState().project.pages[0].sections;
    expect(sections.some((s) => s.id === "faq-1")).toBe(true);
    expect(sections.some((s) => s.id === "hero-1")).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Revision / dirty / selection
// ---------------------------------------------------------------------------

describe("applyAiEditPlan — revision, dirty, selection", () => {
  it("commits the result as a single project reference change", () => {
    hydrate(makeProject(), 5);
    let projectChanges = 0;
    let previous = useEditorStore.getState().project;
    const unsub = useEditorStore.subscribe((s) => {
      if (s.project !== previous) {
        projectChanges += 1;
        previous = s.project;
      }
    });
    const plan = makePlan(5, [
      {
        ...baseOp("op-1"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "hero-1",
        sectionType: "hero",
        nextProps: { headline: "One", subheadline: "Sub", primaryCta: { text: "Get Started", href: "#" } },
      } as AiEditOperation,
      {
        ...baseOp("op-2"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "faq-1",
        visible: false,
      } as AiEditOperation,
      {
        ...baseOp("op-3"),
        type: "move-section",
        pageId: "page-1",
        sectionId: "cta-1",
        targetIndex: 0,
      } as AiEditOperation,
    ]);
    const result = useEditorStore.getState().applyAiEditPlan(plan);
    unsub();
    expect(result.ok).toBe(true);
    // The controller's store subscription reacts to exactly one reference
    // change → one revision increment, one dirty mark, one autosave schedule.
    expect(projectChanges).toBe(1);
  });

  it("keeps section selection when the section still exists", () => {
    hydrate(makeProject(), 1);
    useEditorStore.getState().selectSection("hero-1");
    useEditorStore.getState().applyAiEditPlan(makePlan(1));
    expect(useEditorStore.getState().selectedSectionId).toBe("hero-1");
  });

  it("clears section selection when the selected section is deleted", () => {
    hydrate(makeProject(), 1);
    useEditorStore.getState().selectSection("faq-1");
    const plan = makePlan(1, [
      {
        ...baseOp("op-1"),
        risk: "high",
        type: "delete-section",
        pageId: "page-1",
        sectionId: "faq-1",
      } as AiEditOperation,
    ]);
    useEditorStore.getState().applyAiEditPlan(plan, undefined, { allowDestructive: true });
    expect(useEditorStore.getState().selectedSectionId).toBeNull();
  });

  it("moves page selection when the selected page is deleted", () => {
    const project = makeProject();
    project.pages.push({
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [{ id: "a-1", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    hydrate(project, 1);
    useEditorStore.getState().selectPage("page-2");
    const plan: AiEditPlan = {
      ...makePlan(1),
      scope: { type: "project" },
      operations: [
        {
          ...baseOp("op-1"),
          risk: "high",
          type: "delete-page",
          pageId: "page-2",
        } as AiEditOperation,
      ],
    };
    useEditorStore.getState().applyAiEditPlan(plan, undefined, { allowDestructive: true });
    expect(useEditorStore.getState().selectedPageId).toBe("page-1");
  });
});
