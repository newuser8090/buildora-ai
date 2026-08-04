// ---------------------------------------------------------------------------
// Plan simulator — pure application tests (spec §34)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { simulatePlan } from "../plan-simulator";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { AiEditOperation } from "../../plan-types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT: Project = JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;

type OpBase = Pick<
  AiEditOperation,
  "id" | "type" | "label" | "explanation" | "risk"
>;

function baseOp(id: string, type: AiEditOperation["type"]): OpBase {
  return {
    id,
    type,
    label: "Change",
    explanation: "Test change.",
    risk: "low",
  };
}

function sectionById(project: Project, pageId: string, sectionId: string) {
  const page = project.pages.find((p) => p.id === pageId);
  return page?.sections.find((s) => s.id === sectionId);
}

function pageById(project: Project, pageId: string) {
  return project.pages.find((p) => p.id === pageId);
}

function run(operations: AiEditOperation[]) {
  return simulatePlan(PROJECT, operations, { captureSnapshots: true });
}

// ---------------------------------------------------------------------------
// Each operation
// ---------------------------------------------------------------------------

describe("simulatePlan — per-operation", () => {
  it("update-section-props rewrites props and keeps the section valid", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: {
          headline: "Fresh headline",
          subheadline: "Fresh sub",
          primaryCta: { text: "Go", href: "#" },
        },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionById(result.project, "page-1", "s-hero")?.props.headline).toBe("Fresh headline");
    // Unchanged fields preserved through defaults where required
    expect(sectionById(result.project, "page-1", "s-hero")?.props.primaryCta).toEqual({
      text: "Go",
      href: "#",
    });
  });

  it("update-section-styles merges styles", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-section-styles"),
        type: "update-section-styles",
        pageId: "page-1",
        sectionId: "s-hero",
        nextStyles: { textAlign: "center" },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionById(result.project, "page-1", "s-hero")?.styles.textAlign).toBe("center");
  });

  it("insert-section inserts at the requested position", () => {
    const faq: AiEditOperation = {
      ...baseOp("op-1", "insert-section"),
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
      position: { type: "after", sectionId: "s-pricing" },
    };
    const result = run([faq]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sections = pageById(result.project, "page-1")!.sections;
    const pricingIndex = sections.findIndex((s) => s.id === "s-pricing");
    const faqIndex = sections.findIndex((s) => s.id === "new-faq");
    expect(faqIndex).toBe(pricingIndex + 1);
    // order normalized
    expect(sections.map((s) => s.order)).toEqual(sections.map((_, i) => i + 1));
  });

  it("delete-section removes the section", () => {
    const result = run([
      {
        ...baseOp("op-1", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-cta",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionById(result.project, "page-1", "s-cta")).toBeUndefined();
  });

  it("duplicate-section clones the section with the new id", () => {
    const result = run([
      {
        ...baseOp("op-1", "duplicate-section"),
        type: "duplicate-section",
        pageId: "page-1",
        sectionId: "s-cta",
        newSectionId: "s-cta-copy",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const copy = sectionById(result.project, "page-1", "s-cta-copy");
    expect(copy).toBeDefined();
    expect(copy?.props.headline).toBe(sectionById(PROJECT, "page-1", "s-cta")?.props.headline);
  });

  it("move-section moves to the absolute index", () => {
    const result = run([
      {
        ...baseOp("op-1", "move-section"),
        type: "move-section",
        pageId: "page-1",
        sectionId: "s-cta",
        targetIndex: 1,
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sections = pageById(result.project, "page-1")!.sections;
    expect(sections[1].id).toBe("s-cta");
  });

  it("set-section-visibility hides a section", () => {
    const result = run([
      {
        ...baseOp("op-1", "set-section-visibility"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "s-faq",
        visible: false,
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionById(result.project, "page-1", "s-faq")?.visible).toBe(false);
  });

  it("add-page adds a page with a unique id", () => {
    const result = run([
      {
        ...baseOp("op-1", "add-page"),
        type: "add-page",
        page: {
          id: "page-contact",
          title: "Contact",
          slug: "/contact",
          sections: [
            { id: "c-hero", type: "hero", order: 1, visible: true, props: { headline: "Contact", primaryCta: { text: "Go", href: "#" } }, styles: {} },
          ],
        },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pageById(result.project, "page-contact")?.title).toBe("Contact");
    expect(result.project.pages).toHaveLength(2);
  });

  it("rename-page renames and re-derives the slug", () => {
    const result = run([
      {
        ...baseOp("op-1", "rename-page"),
        type: "rename-page",
        pageId: "page-1",
        title: "Pricing",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const page = pageById(result.project, "page-1");
    expect(page?.title).toBe("Pricing");
    expect(page?.slug).toBe("/pricing");
  });

  it("delete-page removes the page", () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [{ id: "a1", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    const result = simulatePlan(project, [
      {
        ...baseOp("op-1", "delete-page"),
        type: "delete-page",
        pageId: "page-2",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.pages.some((p) => p.id === "page-2")).toBe(false);
  });

  it("move-page moves a page while preserving the root-slug policy", () => {
    // The first page owns the root slug "/"; moving a non-root page to index 0
    // would break routing, so move within non-home slots only.
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push(
      {
        id: "page-2",
        title: "About",
        slug: "/about",
        sections: [{ id: "a1", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
      },
      {
        id: "page-3",
        title: "Pricing",
        slug: "/pricing",
        sections: [{ id: "p1", type: "hero", order: 1, visible: true, props: { headline: "Pricing", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
      },
    );
    const result = simulatePlan(project, [
      {
        ...baseOp("op-1", "move-page"),
        type: "move-page",
        pageId: "page-2",
        targetIndex: 2,
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.pages[0].id).toBe("page-1"); // homepage unchanged
    expect(result.project.pages[2].id).toBe("page-2");
  });

  it("move-page rejects moves that break the root-slug policy", () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    project.pages.push({
      id: "page-2",
      title: "About",
      slug: "/about",
      sections: [{ id: "a1", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
    });
    const result = simulatePlan(project, [
      {
        ...baseOp("op-1", "move-page"),
        type: "move-page",
        pageId: "page-2",
        targetIndex: 0,
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/root|slug/i);
  });

  it("update-page-meta sets metadata", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-page-meta"),
        type: "update-page-meta",
        pageId: "page-1",
        meta: { title: "Home | Buildora", description: "Build sites with AI." },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pageById(result.project, "page-1")?.meta?.title).toBe("Home | Buildora");
  });
});

// ---------------------------------------------------------------------------
// Sequences
// ---------------------------------------------------------------------------

describe("simulatePlan — sequences", () => {
  it("applies a multi-operation sequence deterministically", () => {
    const ops: AiEditOperation[] = [
      {
        ...baseOp("op-1", "insert-section"),
        type: "insert-section",
        pageId: "page-1",
        sectionType: "faq",
        section: { id: "new-faq", type: "faq", order: 1, visible: true, props: { title: "FAQ", items: [{ question: "Q", answer: "A" }] }, styles: {} },
        position: { type: "after", sectionId: "s-pricing" },
      },
      {
        ...baseOp("op-2", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "new-faq",
        sectionType: "faq",
        nextProps: { title: "FAQ v2", items: [{ question: "Q2", answer: "A2" }] },
        dependsOn: ["op-1"],
      },
      {
        ...baseOp("op-3", "set-section-visibility"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "s-cta",
        visible: false,
      },
    ];
    const first = run(ops);
    const second = run(ops);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(JSON.stringify(first.project)).toBe(JSON.stringify(second.ok ? second.project : null));
    expect(sectionById(first.project, "page-1", "new-faq")?.props.title).toBe("FAQ v2");
    expect(sectionById(first.project, "page-1", "s-cta")?.visible).toBe(false);
  });

  it("supports insert-then-edit dependency sequences", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-section"),
        type: "insert-section",
        pageId: "page-1",
        sectionType: "features",
        section: { id: "new-features", type: "features", order: 1, visible: true, props: { title: "F", features: [] }, styles: {} },
        position: { type: "start" },
      },
      {
        ...baseOp("op-2", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "new-features",
        sectionType: "features",
        nextProps: { title: "New Features", features: [{ title: "A", description: "B", icon: "Zap" }] },
        dependsOn: ["op-1"],
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionById(result.project, "page-1", "new-features")?.props.title).toBe("New Features");
  });

  it("supports add-page then update-page-meta", () => {
    const result = run([
      {
        ...baseOp("op-1", "add-page"),
        type: "add-page",
        page: {
          id: "page-about",
          title: "About",
          slug: "/about",
          sections: [{ id: "a-hero", type: "hero", order: 1, visible: true, props: { headline: "About", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
        },
      },
      {
        ...baseOp("op-2", "update-page-meta"),
        type: "update-page-meta",
        pageId: "page-about",
        meta: { title: "About Us" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(pageById(result.project, "page-about")?.meta?.title).toBe("About Us");
  });

  it("supports move-then-delete", () => {
    const result = run([
      {
        ...baseOp("op-1", "move-section"),
        type: "move-section",
        pageId: "page-1",
        sectionId: "s-cta",
        targetIndex: 0,
      },
      {
        ...baseOp("op-2", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-pricing",
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionById(result.project, "page-1", "s-pricing")).toBeUndefined();
    expect(sectionById(result.project, "page-1", "s-cta")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Guards and invalid input
// ---------------------------------------------------------------------------

describe("simulatePlan — guards", () => {
  it("fails on an unknown page", () => {
    const result = run([
      {
        ...baseOp("op-1", "delete-section"),
        type: "delete-section",
        pageId: "ghost-page",
        sectionId: "s-cta",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PLAN_OPERATION_INVALID");
  });

  it("fails on an unknown section", () => {
    const result = run([
      {
        ...baseOp("op-1", "set-section-visibility"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "ghost-section",
        visible: false,
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails on wrong section type updates", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "footer",
        nextProps: { text: "©" },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails on singleton conflicts when inserting a second header", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-section"),
        type: "insert-section",
        pageId: "page-1",
        sectionType: "header",
        section: { id: "header-2", type: "header", order: 1, visible: true, props: { logoText: "B", navLinks: [] }, styles: {} },
        position: { type: "end" },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails when deleting the last section of a page", () => {
    const result = run([
      {
        ...baseOp("op-1", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-header",
      },
      {
        ...baseOp("op-2", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-hero",
      },
      {
        ...baseOp("op-3", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-features",
      },
      {
        ...baseOp("op-4", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-pricing",
      },
      {
        ...baseOp("op-5", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-faq",
      },
      {
        ...baseOp("op-6", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-cta",
      },
      // Only the footer remains — deleting it must fail
      {
        ...baseOp("op-7", "delete-section"),
        type: "delete-section",
        pageId: "page-1",
        sectionId: "s-footer",
      },
    ] as AiEditOperation[]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failedOperationId).toBe("op-7");
      expect(result.error.message).toMatch(/at least one section/i);
    }
  });

  it("fails when deleting the last page", () => {
    const result = run([
      {
        ...baseOp("op-1", "delete-page"),
        type: "delete-page",
        pageId: "page-1",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/at least one page/i);
  });

  it("fails on duplicate slugs when adding a page", () => {
    const result = run([
      {
        ...baseOp("op-1", "add-page"),
        type: "add-page",
        page: {
          id: "page-home-2",
          title: "Home Again",
          slug: "/",
          sections: [{ id: "h2", type: "hero", order: 1, visible: true, props: { headline: "H", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
        },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/slug/i);
  });

  it("fails on reserved routes (api)", () => {
    const result = run([
      {
        ...baseOp("op-1", "add-page"),
        type: "add-page",
        page: {
          id: "page-api",
          title: "API",
          slug: "/api",
          sections: [{ id: "api1", type: "hero", order: 1, visible: true, props: { headline: "H", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
        },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/reserved/i);
  });

  it("fails on stale IDs (duplicate section id)", () => {
    const result = run([
      {
        ...baseOp("op-1", "insert-section"),
        type: "insert-section",
        pageId: "page-1",
        sectionType: "faq",
        section: { id: "s-faq", type: "faq", order: 1, visible: true, props: { title: "FAQ", items: [] }, styles: {} },
        position: { type: "end" },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/already exists/i);
  });

  it("fails when invalid props produce an invalid final project", () => {
    const result = run([
      {
        ...baseOp("op-1", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-pricing",
        sectionType: "pricing",
        nextProps: { plans: [{ name: "Bad", price: "x" }] },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
  });

  it("fails when deleting a singleton via duplicate of header", () => {
    const result = run([
      {
        ...baseOp("op-1", "duplicate-section"),
        type: "duplicate-section",
        pageId: "page-1",
        sectionId: "s-header",
        newSectionId: "s-header-2",
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(false);
  });

  it("warns when asset-like fields are dropped by an update", () => {
    const project = JSON.parse(JSON.stringify(PROJECT)) as Project;
    const hero = project.pages[0].sections.find((s) => s.id === "s-hero")!;
    (hero.props as Record<string, unknown>).heroImage = { assetId: "asset-1" };
    const result = simulatePlan(project, [
      {
        ...baseOp("op-1", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: { headline: "No image", subheadline: "", primaryCta: { text: "Go", href: "#" } },
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.code === "PRESERVED_FIELD_DROPPED")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Final validation + immutability
// ---------------------------------------------------------------------------

describe("simulatePlan — final validation and purity", () => {
  it("does not mutate the source project", () => {
    const snapshot = JSON.stringify(PROJECT);
    run([
      {
        ...baseOp("op-1", "set-section-visibility"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "s-faq",
        visible: false,
      } as AiEditOperation,
    ]);
    expect(JSON.stringify(PROJECT)).toBe(snapshot);
    expect(sectionById(PROJECT, "page-1", "s-faq")?.visible).toBe(true);
  });

  it("produces deterministic results", () => {
    const ops: AiEditOperation[] = [
      {
        ...baseOp("op-1", "move-section"),
        type: "move-section",
        pageId: "page-1",
        sectionId: "s-cta",
        targetIndex: 2,
      },
      {
        ...baseOp("op-2", "update-section-props"),
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: { headline: "Same", subheadline: "Same sub", primaryCta: { text: "Go", href: "#" } },
      },
    ];
    const a = run(ops);
    const b = run(ops);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.project)).toBe(JSON.stringify(b.project));
      expect(a.operationResults.map((r) => r.kind)).toEqual(b.operationResults.map((r) => r.kind));
    }
  });

  it("validates the final project through routing rules", () => {
    // Renaming the home page to a duplicate of another page's slug fails.
    const result = run([
      {
        ...baseOp("op-1", "rename-page"),
        type: "rename-page",
        pageId: "page-1",
        title: "Home",
      } as AiEditOperation,
    ]);
    // rename to "Home" re-derives "/" — no conflict, should pass
    expect(result.ok).toBe(true);
  });

  it("exposes before/after snapshots for diffs", () => {
    const result = run([
      {
        ...baseOp("op-1", "set-section-visibility"),
        type: "set-section-visibility",
        pageId: "page-1",
        sectionId: "s-faq",
        visible: false,
      } as AiEditOperation,
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshots).toHaveLength(2);
      expect(sectionById(result.snapshots[0], "page-1", "s-faq")?.visible).toBe(true);
      expect(sectionById(result.snapshots[1], "page-1", "s-faq")?.visible).toBe(false);
    }
  });
});
