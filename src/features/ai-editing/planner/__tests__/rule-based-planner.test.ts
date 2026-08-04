// ---------------------------------------------------------------------------
// Rule-based planner — deterministic fallback tests (spec §32)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { RuleBasedPlanner, type PlanIdFactory } from "../rule-based-planner";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { simulatePlan } from "../../services/plan-simulator";
import type { AiEditPlannerInput } from "../../plan-types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT: Project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;

let opCounter = 0;

function deterministicIdFactory(): PlanIdFactory {
  return {
    planId: () => "plan-test-1",
    pageId: () => `page-new-${(opCounter += 1)}`,
    sectionId: (type) => `sec-${type}-${(opCounter += 1)}`,
    operationId: (index) => `op-${index}`,
  };
}

function planner() {
  opCounter = 0;
  return new RuleBasedPlanner({ idFactory: deterministicIdFactory() });
}

function input(
  instruction: string,
  overrides?: Partial<AiEditPlannerInput>,
): AiEditPlannerInput {
  return {
    instruction,
    scope: { type: "page", pageId: "page-1" },
    project: PROJECT,
    baseRevision: 3,
    ...overrides,
  };
}

function operationsOf(plan: Extract<Awaited<ReturnType<RuleBasedPlanner["createPlan"]>>, { ok: true }>) {
  return plan.plan.operations;
}

beforeEach(() => {
  opCounter = 0;
});

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

describe("rule-based planner — structural commands", () => {
  it("adds a section after another", async () => {
    const result = await planner().createPlan(
      input("Add a testimonials section below pricing"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ops = operationsOf(result);
    expect(ops).toHaveLength(1);
    const insert = ops[0] as { type: string; sectionType: string; position: { type: string; sectionId: string } };
    expect(insert.type).toBe("insert-section");
    // testimonials maps to features with a warning
    expect(insert.sectionType).toBe("features");
    expect(insert.position).toEqual({ type: "after", sectionId: "s-pricing" });
    expect(
      result.plan.warnings.some((w) => w.code === "UNSUPPORTED_SECTION_TYPE"),
    ).toBe(true);
  });

  it("moves the CTA above the FAQ", async () => {
    const result = await planner().createPlan(
      input("Move the CTA above the FAQ"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const move = operationsOf(result)[0] as {
      type: string;
      sectionId: string;
      targetIndex: number;
    };
    expect(move.type).toBe("move-section");
    expect(move.sectionId).toBe("s-cta");
    // FAQ is at index 4 (0-based) → CTA moves to 4
    expect(move.targetIndex).toBe(4);
  });

  it("deletes a unique section", async () => {
    const result = await planner().createPlan(input("Delete the FAQ section"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const del = operationsOf(result)[0] as { type: string; sectionId: string; risk: string };
    expect(del.type).toBe("delete-section");
    expect(del.sectionId).toBe("s-faq");
    expect(del.risk).toBe("high");
  });

  it("refuses ambiguous deletes with a warning", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages[0].sections.push({
      id: "s-faq-2",
      type: "faq",
      order: 8,
      visible: true,
      props: { title: "More FAQ", items: [] },
      styles: {},
    });
    const result = await planner().createPlan(
      input("Delete the FAQ section", { project }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PLAN_NO_CHANGES");
    }
    expect(
      result.warnings?.some((w) => w.includes("Multiple")),
    ).toBe(true);
  });

  it("deletes the second hero by ordinal", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages[0].sections.push({
      id: "s-hero-2",
      type: "hero",
      order: 8,
      visible: true,
      props: { headline: "Second hero", primaryCta: { text: "Go", href: "#" } },
      styles: {},
    });
    const result = await planner().createPlan(
      input("Delete the second hero section", { project }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const del = operationsOf(result)[0] as { type: string; sectionId: string };
    expect(del.type).toBe("delete-section");
    expect(del.sectionId).toBe("s-hero-2");
  });

  it("duplicates a section", async () => {
    const result = await planner().createPlan(
      input("Duplicate the CTA section"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dup = operationsOf(result)[0] as { type: string; sectionId: string; newSectionId: string };
    expect(dup.type).toBe("duplicate-section");
    expect(dup.sectionId).toBe("s-cta");
    expect(dup.newSectionId).toContain("sec-cta");
  });

  it("hides and shows sections", async () => {
    const hide = await planner().createPlan(input("Hide the pricing section"));
    expect(hide.ok).toBe(true);
    if (hide.ok) {
      const op1 = operationsOf(hide)[0] as { type: string; visible: boolean };
      expect(op1.type).toBe("set-section-visibility");
      expect(op1.visible).toBe(false);
    }

    // Showing an already-visible section is a no-op — hide it first so the
    // show command has a real change to plan.
    const hiddenProject = JSON.parse(JSON.stringify(PROJECT)) as Project;
    const pricing = hiddenProject.pages[0].sections.find((s) => s.id === "s-pricing")!;
    pricing.visible = false;

    const show = await planner().createPlan(
      input("Show the pricing section", { project: hiddenProject }),
    );
    expect(show.ok).toBe(true);
    if (show.ok) {
      const op2 = operationsOf(show)[0] as { type: string; visible: boolean };
      expect(op2.type).toBe("set-section-visibility");
      expect(op2.visible).toBe(true);
    }
  });

  it("adds a page with starter sections", async () => {
    const result = await planner().createPlan(
      input("Add a Contact page with a hero, features, FAQ, and CTA"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const add = operationsOf(result)[0] as { type: string; page: { title: string; slug: string; sections: unknown[] } };
    expect(add.type).toBe("add-page");
    expect(add.page.title).toBe("Contact");
    expect(add.page.slug).toBe("/contact");
    // hero + features + faq + cta = 4 sections (plus the default hero makes it unique)
    expect(add.page.sections.length).toBeGreaterThanOrEqual(4);
  });

  it("renames a page", async () => {
    // Build a multi-page project with a "Pricing" page to rename.
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "Pricing",
      slug: "/pricing",
      sections: [{ id: "p1", type: "hero", order: 1, visible: true, props: { headline: "Pricing", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    const multiResult = await planner().createPlan(
      input("Rename Pricing to Plans", { project }),
    );
    expect(multiResult.ok).toBe(true);
    if (!multiResult.ok) return;
    const rename = operationsOf(multiResult)[0] as { type: string; pageId: string; title: string };
    expect(rename.type).toBe("rename-page");
    expect(rename.pageId).toBe("page-2");
    expect(rename.title).toBe("Plans");

    // Renaming a page that doesn't exist yields a structured no-change error.
    const missing = await planner().createPlan(input("Rename Pricing to Plans"));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("PLAN_NO_CHANGES");
  });

  it("deletes a page", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [{ id: "a1", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    const result = await planner().createPlan(
      input("Delete the About page", { project }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const del = operationsOf(result)[0] as { type: string; pageId: string; risk: string };
    expect(del.type).toBe("delete-page");
    expect(del.pageId).toBe("page-2");
    expect(del.risk).toBe("high");
  });

  it("refuses to delete the last page", async () => {
    const result = await planner().createPlan(input("Delete the Home page"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.warnings?.some((w) => w.includes("at least one page"))).toBe(true);
    }
  });

  it("moves a page", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [{ id: "a1", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    const result = await planner().createPlan(
      input("Move the About page before the Home page", { project }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const move = operationsOf(result)[0] as { type: string; pageId: string; targetIndex: number };
    expect(move.type).toBe("move-page");
    expect(move.pageId).toBe("page-2");
    expect(move.targetIndex).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Copy rewrites
// ---------------------------------------------------------------------------

describe("rule-based planner — copy rewrites", () => {
  it("rewrites a page's visible copy (concise)", async () => {
    const result = await planner().createPlan(
      input("Make this page more concise"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ops = operationsOf(result);
    expect(ops.length).toBeGreaterThan(1);
    // one operation per section, all update-section-props
    for (const op of ops) {
      expect((op as { type: string }).type).toBe("update-section-props");
    }
    // hidden sections are skipped
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages[0].sections[1].visible = false; // hide hero
    const hiddenResult = await planner().createPlan(
      input("Make this page more concise", { project }),
    );
    expect(hiddenResult.ok).toBe(true);
    if (!hiddenResult.ok) return;
    const heroTouched = operationsOf(hiddenResult).some(
      (op) => (op as { sectionId?: string }).sectionId === "s-hero",
    );
    expect(heroTouched).toBe(false);
  });

  it("applies a project-wide tone rewrite", async () => {
    const result = await planner().createPlan(
      input("Rewrite all visible copy in a playful tone", {
        scope: { type: "project" },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ops = operationsOf(result);
    expect(ops.length).toBeGreaterThan(0);
    // project-wide rewrites are high risk
    expect((ops[0] as { risk: string }).risk).toBe("high");
  });

  it("improves the homepage", async () => {
    const result = await planner().createPlan(
      input("Make the homepage feel more premium"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(operationsOf(result).length).toBeGreaterThan(0);
  });

  it("improves specific pages with multi-page targeting", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [
        { id: "a1", type: "hero", order: 1, visible: true, props: { headline: "About us", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        { id: "a2", type: "footer", order: 2, visible: true, props: { text: "© About", links: [] }, styles: {} },
      ],
    });
    const result = await planner().createPlan(
      input("Improve the Home and About pages", { project }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pageIds = new Set(
      operationsOf(result).map((op) => (op as { pageId?: string }).pageId),
    );
    expect(pageIds.has("page-1")).toBe(true);
    expect(pageIds.has("page-2")).toBe(true);
  });

  it("preserves prices, plan names, and links during rewrites", async () => {
    const result = await planner().createPlan(
      input("Make this page more professional"),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sim = simulatePlan(PROJECT, operationsOf(result) as never);
    expect(sim.ok).toBe(true);
    if (!sim.ok) return;
    const pricing = sim.project.pages[0].sections.find((s) => s.id === "s-pricing")!;
    const plans = pricing.props.plans as Array<{ name: string; price: string }>;
    expect(plans[0].name).toBe("Free");
    expect(plans[0].price).toBe("$0");
    const header = sim.project.pages[0].sections.find((s) => s.id === "s-header")!;
    expect((header.props.navLinks as Array<{ href: string }>)[0].href).toBe("#features");
  });

  it("preserves AssetRefs during rewrites", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    const hero = project.pages[0].sections.find((s) => s.id === "s-hero")!;
    (hero.props as Record<string, unknown>).heroImage = { assetId: "asset-1" };
    const result = await planner().createPlan(
      input("Make this page more bold", { project }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sim = simulatePlan(project, operationsOf(result) as never);
    expect(sim.ok).toBe(true);
    if (!sim.ok) return;
    const simHero = sim.project.pages[0].sections.find((s) => s.id === "s-hero")!;
    expect((simHero.props as Record<string, unknown>).heroImage).toEqual({
      assetId: "asset-1",
    });
  });
});

// ---------------------------------------------------------------------------
// Determinism / injection / purity
// ---------------------------------------------------------------------------

describe("rule-based planner — determinism and purity", () => {
  it("produces deterministic output with an injected id factory", async () => {
    opCounter = 0;
    const a = await planner().createPlan(
      input("Add a Contact page and hide the FAQ"),
    );
    opCounter = 0;
    const b = await planner().createPlan(
      input("Add a Contact page and hide the FAQ"),
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    }
  });

  it("never mutates the input project", async () => {
    const snapshot = JSON.stringify(PROJECT);
    await planner().createPlan(input("Delete the FAQ and make the page concise"));
    expect(JSON.stringify(PROJECT)).toBe(snapshot);
  });

  it("returns a no-change error for unsupported instructions", async () => {
    const result = await planner().createPlan(
      input("Give me a video timeline section with autoplay"),
    );
    // Unsupported section type with no other command → no change error
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_NO_CHANGES");
  });

  it("combines multiple commands into one plan", async () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "Pricing",
      slug: "/pricing",
      sections: [{ id: "p1", type: "hero", order: 1, visible: true, props: { headline: "Pricing", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    const result = await planner().createPlan(
      input("Add a Contact page, rename Pricing to Plans, and hide FAQ on Home", { project }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const types = operationsOf(result).map((op) => (op as { type: string }).type);
    expect(types).toContain("add-page");
    expect(types).toContain("rename-page");
    expect(types).toContain("set-section-visibility");
  });
});
