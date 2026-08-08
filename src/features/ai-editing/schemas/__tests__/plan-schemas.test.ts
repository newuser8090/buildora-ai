// ---------------------------------------------------------------------------
// Plan schemas — validation tests (spec §33)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  AiEditOperationSchema,
  AiEditPlanSchema,
  AiEditScopeSchema,
  PLAN_LIMITS,
  scanPayloadForSecurityIssues,
} from "../plan-schemas";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { AiEditOperation, AiEditPlan } from "../../plan-types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function op(overrides: Partial<AiEditOperation> & { type: AiEditOperation["type"] }): AiEditOperation {
  return {
    id: "op-1",
    label: "Change",
    explanation: "A test operation.",
    risk: "low",
    ...overrides,
  } as AiEditOperation;
}

function validPlan(operations: AiEditOperation[] = [op({ type: "set-section-visibility", pageId: "page-1", sectionId: "s-faq", visible: false })]): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "proj-1",
    baseRevision: 3,
    scope: { type: "page", pageId: "page-1" },
    instruction: "Hide the FAQ",
    summary: "One change.",
    operations,
    warnings: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    provider: "rule-based",
  };
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe("AiEditScopeSchema", () => {
  it("accepts section, page and project scopes", () => {
    expect(AiEditScopeSchema.safeParse({ type: "section", pageId: "p", sectionId: "s" }).success).toBe(true);
    expect(AiEditScopeSchema.safeParse({ type: "page", pageId: "p" }).success).toBe(true);
    expect(AiEditScopeSchema.safeParse({ type: "project" }).success).toBe(true);
  });

  it("rejects missing identifiers and unknown scope types", () => {
    expect(AiEditScopeSchema.safeParse({ type: "section", pageId: "p" }).success).toBe(false);
    expect(AiEditScopeSchema.safeParse({ type: "page" }).success).toBe(false);
    expect(AiEditScopeSchema.safeParse({ type: "unknown" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Every operation validates
// ---------------------------------------------------------------------------

describe("AiEditOperationSchema — valid operations", () => {
  const cases: Array<[string, AiEditOperation]> = [
    [
      "update-section-props",
      op({
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: { headline: "New", subheadline: "Sub", primaryCta: { text: "Go", href: "#" } },
      }),
    ],
    [
      "update-section-styles",
      op({ type: "update-section-styles", pageId: "page-1", sectionId: "s-hero", nextStyles: { textAlign: "center" } }),
    ],
    [
      "insert-section",
      op({
        type: "insert-section",
        pageId: "page-1",
        sectionType: "faq",
        section: {
          id: "new-faq",
          type: "faq",
          order: 1,
          visible: true,
          props: { title: "FAQ", items: [{ question: "Q?", answer: "A." }] },
          styles: {},
        },
        position: { type: "after", sectionId: "s-pricing" },
      }),
    ],
    [
      "delete-section",
      op({ type: "delete-section", pageId: "page-1", sectionId: "s-cta" }),
    ],
    [
      "duplicate-section",
      op({ type: "duplicate-section", pageId: "page-1", sectionId: "s-cta", newSectionId: "s-cta-2" }),
    ],
    [
      "move-section",
      op({ type: "move-section", pageId: "page-1", sectionId: "s-cta", targetIndex: 2 }),
    ],
    [
      "set-section-visibility",
      op({ type: "set-section-visibility", pageId: "page-1", sectionId: "s-faq", visible: false }),
    ],
    [
      "add-page",
      op({
        type: "add-page",
        page: {
          id: "page-2",
          title: "Contact",
          slug: "/contact",
          sections: [
            {
              id: "c-hero",
              type: "hero",
              order: 1,
              visible: true,
              props: { headline: "Contact", primaryCta: { text: "Go", href: "#" } },
              styles: {},
            },
          ],
        },
      }),
    ],
    [
      "rename-page",
      op({ type: "rename-page", pageId: "page-1", title: "Plans" }),
    ],
    [
      "delete-page",
      op({ type: "delete-page", pageId: "page-1" }),
    ],
    [
      "move-page",
      op({ type: "move-page", pageId: "page-1", targetIndex: 1 }),
    ],
    [
      "update-page-meta",
      op({ type: "update-page-meta", pageId: "page-1", meta: { title: "Home | Buildora" } }),
    ],
  ];

  it.each(cases)("accepts a valid %s operation", (_name, operation) => {
    const result = AiEditOperationSchema.safeParse(operation);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Malformed / rejected operations
// ---------------------------------------------------------------------------

describe("AiEditOperationSchema — rejection", () => {
  it("rejects unknown operation types", () => {
    const bad = op({ type: "delete-section", pageId: "p", sectionId: "s" });
    const result = AiEditOperationSchema.safeParse({ ...bad, type: "hack-the-plan" });
    expect(result.success).toBe(false);
  });

  it("rejects missing identifiers", () => {
    const result = AiEditOperationSchema.safeParse(
      op({ type: "delete-section", pageId: "", sectionId: "" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unsupported section types", () => {
    const result = AiEditOperationSchema.safeParse(
      op({ type: "update-section-props", pageId: "p", sectionId: "s", sectionType: "video-timeline", nextProps: {} }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid section props (bad pricing plan)", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "update-section-props",
        pageId: "p",
        sectionId: "s",
        sectionType: "pricing",
        nextProps: { plans: [{ name: "No price" }] },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects malformed links in props", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "update-section-props",
        pageId: "p",
        sectionId: "s",
        sectionType: "hero",
        nextProps: { primaryCta: { text: "", href: 42 } },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an inserted section whose type mismatches sectionType", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "insert-section",
        pageId: "p",
        sectionType: "faq",
        section: { id: "x", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        position: { type: "end" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid page titles on rename", () => {
    const result = AiEditOperationSchema.safeParse(
      op({ type: "rename-page", pageId: "p", title: "   " }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid slugs on add-page", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "add-page",
        page: {
          id: "page-2",
          title: "Contact",
          slug: "not-a-slug",
          sections: [
            { id: "c1", type: "hero", order: 1, visible: true, props: { headline: "H" }, styles: {} },
          ],
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid indexes", () => {
    const result = AiEditOperationSchema.safeParse(
      op({ type: "move-section", pageId: "p", sectionId: "s", targetIndex: -1 }),
    );
    expect(result.success).toBe(false);
  });

  it("strips unknown fields", () => {
    const result = AiEditOperationSchema.safeParse({
      ...op({ type: "delete-section", pageId: "p", sectionId: "s" }),
      evil: "drop-me",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).evil).toBeUndefined();
    }
  });

  it("rejects dangerously long labels and explanations", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "delete-section",
        pageId: "p",
        sectionId: "s",
        label: "x".repeat(PLAN_LIMITS.maxLabelLength + 1),
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plan-level validation
// ---------------------------------------------------------------------------

describe("AiEditPlanSchema", () => {
  it("accepts a valid plan", () => {
    const result = AiEditPlanSchema.safeParse(validPlan());
    expect(result.success).toBe(true);
  });

  it("rejects excessive operations", () => {
    const operations = Array.from({ length: PLAN_LIMITS.maxOperations + 1 }, (_, i) =>
      op({ id: `op-${i}`, type: "set-section-visibility", pageId: "page-1", sectionId: "s-faq", visible: false }),
    );
    const result = AiEditPlanSchema.safeParse(validPlan(operations));
    expect(result.success).toBe(false);
  });

  it("rejects excessive instruction length", () => {
    const result = AiEditPlanSchema.safeParse(
      validPlan([],),
    );
    // instruction over the limit
    const longPlan = {
      ...validPlan(),
      instruction: "x".repeat(PLAN_LIMITS.maxInstructionLength + 1),
    };
    expect(AiEditPlanSchema.safeParse(longPlan).success).toBe(false);
    expect(result.success).toBe(true);
  });

  it("rejects more inserted pages than the cap", () => {
    const operations = Array.from({ length: PLAN_LIMITS.maxInsertedPages + 1 }, (_, i) =>
      op({
        id: `op-${i}`,
        type: "add-page",
        page: {
          id: `page-${i}`,
          title: `Page ${i}`,
          slug: `/page-${i}`,
          sections: [
            { id: `h-${i}`, type: "hero", order: 1, visible: true, props: { headline: "H" }, styles: {} },
          ],
        },
      }),
    );
    const result = AiEditPlanSchema.safeParse(validPlan(operations));
    expect(result.success).toBe(false);
  });

  it("rejects more inserted sections than the cap", () => {
    const operations = Array.from({ length: PLAN_LIMITS.maxInsertedSections + 1 }, (_, i) =>
      op({
        id: `op-${i}`,
        type: "insert-section",
        pageId: "page-1",
        sectionType: "faq",
        section: {
          id: `f-${i}`,
          type: "faq",
          order: 1,
          visible: true,
          props: { title: "FAQ", items: [{ question: "Q", answer: "A" }] },
          styles: {},
        },
        position: { type: "end" },
      }),
    );
    const result = AiEditPlanSchema.safeParse(validPlan(operations));
    expect(result.success).toBe(false);
  });

  it("rejects unknown dependencies", () => {
    const base = validPlan();
    const update = op({
      id: "op-2",
      type: "update-section-props",
      pageId: "page-1",
      sectionId: "new-1",
      sectionType: "faq",
      nextProps: { title: "FAQ", items: [] },
      dependsOn: ["ghost-op"],
    });
    const result = AiEditPlanSchema.safeParse(
      validPlan([...base.operations, update]),
    );
    expect(result.success).toBe(false);
  });

  it("rejects dependency cycles and forward references", () => {
    const a = op({ id: "op-a", type: "set-section-visibility", pageId: "p", sectionId: "s", visible: false });
    const b = op({ id: "op-b", type: "set-section-visibility", pageId: "p", sectionId: "s", visible: true, dependsOn: ["op-a"] });
    // forward reference: op-c depends on op-a but appears first
    const c = op({ id: "op-c", type: "set-section-visibility", pageId: "p", sectionId: "s", visible: true, dependsOn: ["op-a"] });
    const result = AiEditPlanSchema.safeParse(validPlan([c, a, b]));
    expect(result.success).toBe(false);
  });

  it("accepts a valid dependency chain in order", () => {
    const insert = op({
      id: "op-1",
      type: "insert-section",
      pageId: "page-1",
      sectionType: "faq",
      section: {
        id: "new-faq",
        type: "faq",
        order: 1,
        visible: true,
        props: { title: "FAQ", items: [{ question: "Q", answer: "A" }] },
        styles: {},
      },
      position: { type: "end" },
    });
    const update = op({
      id: "op-2",
      type: "update-section-props",
      pageId: "page-1",
      sectionId: "new-faq",
      sectionType: "faq",
      nextProps: { title: "FAQ v2", items: [{ question: "Q", answer: "A" }] },
      dependsOn: ["op-1"],
    });
    const result = AiEditPlanSchema.safeParse(validPlan([insert, update]));
    expect(result.success).toBe(true);
  });

  it("preserves Unicode in instruction and props", () => {
    const plan = validPlan([
      op({
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: { headline: "Здравствуйте — 你好 👋", subheadline: "Grüße", primaryCta: { text: "Go", href: "#" } },
      }),
    ]);
    plan.instruction = "Make the headline more international — 国际化";
    const result = AiEditPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.instruction).toContain("国际化");
      const update = result.data.operations[0];
      expect((update as { nextProps: Record<string, unknown> }).nextProps.headline).toBe("Здравствуйте — 你好 👋");
    }
  });

  it("rejects dangerous prototype-pollution keys in props (Phase P10)", () => {
    // "__proto__" must be a real OWN enumerable key — object-literal syntax
    // would set the prototype instead, so use defineProperty.
    const nextProps: Record<string, unknown> = {
      headline: "Safe",
      subheadline: "Safe sub",
      primaryCta: { text: "Go", href: "#" },
      constructor: "bad",
    };
    Object.defineProperty(nextProps, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const plan = validPlan([
      op({
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps,
      }),
    ]);

    // Raw boundary (Phase P10): the scan catches an own "__proto__" key that
    // zod's record normalization would otherwise rebuild away. This is the
    // layer the providers scan before any parsing.
    const rawIssues = scanPayloadForSecurityIssues(plan);
    const rawMessages = rawIssues.map((i) => i.message).join("; ");
    expect(rawMessages).toContain("__proto__");
    expect(rawMessages).toContain("constructor");

    // Schema boundary: "constructor" survives zod parsing as an own key and
    // is rejected outright (never silently stripped).
    const result = AiEditPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join("; ")).toContain(
        "constructor",
      );
    }
  });

  it("rejects javascript: URLs in href-bearing props (Phase P10)", () => {
    const plan = validPlan([
      op({
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: {
          headline: "Safe",
          subheadline: "Safe sub",
          primaryCta: { text: "Go", href: "javascript:alert(1)" },
        },
      }),
    ]);
    const result = AiEditPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join("; ")).toContain("Unsafe URL");
    }
  });

  it("rejects data:text/html values in props (Phase P10)", () => {
    const plan = validPlan([
      op({
        type: "update-section-props",
        pageId: "page-1",
        sectionId: "s-hero",
        sectionType: "hero",
        nextProps: {
          headline: "Safe",
          subheadline: "data:text/html,<script>alert(1)</script>",
          primaryCta: { text: "Go", href: "#" },
        },
      }),
    ]);
    const result = AiEditPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No mutation
// ---------------------------------------------------------------------------

describe("plan schema — immutability", () => {
  it("does not mutate the input project", () => {
    const snapshot = JSON.stringify(MOCK_PROJECT);
    const plan = validPlan();
    AiEditPlanSchema.safeParse(plan);
    expect(JSON.stringify(MOCK_PROJECT)).toBe(snapshot);
  });
});
