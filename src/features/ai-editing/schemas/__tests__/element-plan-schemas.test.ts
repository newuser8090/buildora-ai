// ---------------------------------------------------------------------------
// Phase P22-H — element plan schemas
//   - element scope schema (custom-block element trees only)
//   - every element operation schema validates
//   - security rejection: unsafe URLs, prototype pollution, arbitrary subtrees
//   - registry/rendering gate on insert-element elementType
//   - plan-level caps still apply to element plans
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  AiEditOperationSchema,
  AiEditPlanSchema,
  AiEditScopeSchema,
  PLAN_LIMITS,
  scanPayloadForSecurityIssues,
} from "../plan-schemas";
import type { AiEditOperation, AiEditPlan } from "../../plan-types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";

// The insert-element gate checks the registry's registered RENDERABLE block
// types, which are derived lazily from the block registry.
if (!isDefaultBlocksRegistered()) registerDefaultBlocks();

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

function elementPlan(operations: AiEditOperation[] = []): AiEditPlan {
  return {
    version: 1,
    id: "plan-1",
    projectId: "proj-1",
    baseRevision: 3,
    scope: { type: "element", pageId: "page-1", sectionId: "s-custom", elementId: "root" },
    instruction: "Make the selected button bold",
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

describe("AiEditScopeSchema — element scope", () => {
  it("accepts an element scope with page/section/element ids", () => {
    const result = AiEditScopeSchema.safeParse({
      type: "element",
      pageId: "page-1",
      sectionId: "s-custom",
      elementId: "root",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an element scope missing any identifier", () => {
    expect(AiEditScopeSchema.safeParse({ type: "element", pageId: "p", sectionId: "s" }).success).toBe(false);
    expect(AiEditScopeSchema.safeParse({ type: "element", pageId: "p", elementId: "e" }).success).toBe(false);
    expect(AiEditScopeSchema.safeParse({ type: "element", elementId: "e" }).success).toBe(false);
  });

  it("keeps section/page/project scopes working unchanged", () => {
    expect(AiEditScopeSchema.safeParse({ type: "section", pageId: "p", sectionId: "s" }).success).toBe(true);
    expect(AiEditScopeSchema.safeParse({ type: "page", pageId: "p" }).success).toBe(true);
    expect(AiEditScopeSchema.safeParse({ type: "project" }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Every element operation validates
// ---------------------------------------------------------------------------

describe("AiEditOperationSchema — valid element operations", () => {
  const cases: Array<[string, AiEditOperation]> = [
    [
      "update-element-props",
      op({
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        props: { text: "Fresh headline" },
      }),
    ],
    [
      "update-element-style",
      op({
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700, fontSize: 32 },
      }),
    ],
    [
      "update-element-responsive",
      op({
        type: "update-element-responsive",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        breakpoint: "mobile",
        style: { fontSize: 18 },
      }),
    ],
    [
      "update-element-animation",
      op({
        type: "update-element-animation",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        animation: { trigger: "load", type: "fade", durationMs: 600, easing: "ease" },
      }),
    ],
    [
      "update-element-animation (null clears)",
      op({
        type: "update-element-animation",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        animation: null,
      }),
    ],
    [
      "update-element-interaction",
      op({
        type: "update-element-interaction",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        interaction: { click: { kind: "navigate", target: { kind: "page", pageId: "page-2" } } },
      }),
    ],
    [
      "update-element-interaction (null clears)",
      op({
        type: "update-element-interaction",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        interaction: null,
      }),
    ],
    [
      "insert-element (registered renderable type, no subtree)",
      op({
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        elementType: "button",
        props: { text: "Buy now" },
      }),
    ],
    [
      "insert-element with explicit parent + index",
      op({
        type: "insert-element",
        pageId: "page-1",
        sectionId: "s-custom",
        parentElementId: "root",
        elementType: "image",
        index: 0,
      }),
    ],
    [
      "delete-element",
      op({ type: "delete-element", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1", risk: "high" }),
    ],
    [
      "duplicate-element",
      op({ type: "duplicate-element", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1" }),
    ],
    [
      "set-element-visibility",
      op({ type: "set-element-visibility", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1", visible: false }),
    ],
  ];

  it.each(cases)("accepts a valid %s operation", (_name, operation) => {
    const result = AiEditOperationSchema.safeParse(operation);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rejection
// ---------------------------------------------------------------------------

describe("AiEditOperationSchema — element rejection", () => {
  it("rejects missing identifiers", () => {
    const result = AiEditOperationSchema.safeParse(
      op({ type: "delete-element", pageId: "", sectionId: "s", elementId: "e" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an unknown breakpoint", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "update-element-responsive",
        pageId: "p",
        sectionId: "s",
        elementId: "e",
        breakpoint: "desktop",
        style: {},
      } as unknown as AiEditOperation),
    );
    expect(result.success).toBe(false);
  });

  it("rejects unsafe style values", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "update-element-style",
        pageId: "p",
        sectionId: "s",
        elementId: "e",
        style: { backgroundImage: "url(javascript:alert(1))" },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects malformed animation objects", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "update-element-animation",
        pageId: "p",
        sectionId: "s",
        elementId: "e",
        animation: { trigger: "load", type: "warp-speed" },
      } as unknown as AiEditOperation),
    );
    expect(result.success).toBe(false);
  });

  it("rejects malformed interactions (javascript href)", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "update-element-interaction",
        pageId: "p",
        sectionId: "s",
        elementId: "e",
        interaction: { click: { kind: "navigate", target: { kind: "url", url: "javascript:alert(1)" } } },
      } as unknown as AiEditOperation),
    );
    expect(result.success).toBe(false);
  });

  it("rejects insert-element with a non-registered element type", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "insert-element",
        pageId: "p",
        sectionId: "s",
        elementType: "carousel",
      }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.message).join("; ")).toMatch(/registered renderable/i);
    }
  });

  it("rejects insert-element with an element-only type (text/logo/product-card)", () => {
    for (const elementType of ["text", "logo", "product-card", "price", "list"]) {
      const result = AiEditOperationSchema.safeParse(
        op({ type: "insert-element", pageId: "p", sectionId: "s", elementType }),
      );
      expect(result.success).toBe(false);
    }
  });

  it("rejects an insertion index without an explicit parent", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "insert-element",
        pageId: "p",
        sectionId: "s",
        elementType: "button",
        index: 0,
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects dangerously long element ids", () => {
    const result = AiEditOperationSchema.safeParse(
      op({
        type: "delete-element",
        pageId: "p",
        sectionId: "s",
        elementId: "x".repeat(PLAN_LIMITS.maxIdLength + 1),
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Plan-level + security
// ---------------------------------------------------------------------------

describe("element plan — plan-level validation and security", () => {
  it("accepts a valid element plan", () => {
    const plan = elementPlan([
      op({ type: "update-element-style", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1", style: { fontWeight: 700 } }),
    ]);
    const result = AiEditPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it("rejects excessive element operations (plan cap intact)", () => {
    const operations = Array.from({ length: PLAN_LIMITS.maxOperations + 1 }, (_, i) =>
      op({
        id: `op-${i}`,
        type: "update-element-style",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "heading-1",
        style: { fontWeight: 700 },
      }),
    );
    expect(AiEditPlanSchema.safeParse(elementPlan(operations)).success).toBe(false);
  });

  it("rejects javascript: URLs smuggled through element props (scan + schema)", () => {
    const plan = elementPlan([
      op({
        type: "update-element-props",
        pageId: "page-1",
        sectionId: "s-custom",
        elementId: "button-1",
        props: { href: "javascript:alert(1)" },
      }),
    ]);
    const rawIssues = scanPayloadForSecurityIssues(plan);
    expect(rawIssues.map((i) => i.message).join("; ")).toMatch(/javascript/i);
    const result = AiEditPlanSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects prototype-pollution keys in element props", () => {
    const props: Record<string, unknown> = { text: "Safe", constructor: "bad" };
    Object.defineProperty(props, "__proto__", {
      value: { polluted: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const plan = elementPlan([
      op({ type: "update-element-props", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1", props }),
    ]);
    const rawMessages = scanPayloadForSecurityIssues(plan).map((i) => i.message).join("; ");
    expect(rawMessages).toContain("__proto__");
    expect(AiEditPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("rejects element plans whose scope ids are empty", () => {
    const plan = elementPlan();
    plan.scope = { type: "element", pageId: "", sectionId: "s", elementId: "e" };
    expect(AiEditPlanSchema.safeParse(plan).success).toBe(false);
  });
});
