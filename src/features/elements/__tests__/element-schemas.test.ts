// ---------------------------------------------------------------------------
// Element schema tests (Phase P22-A)
// Covers: element type validation, style validation, responsive override
// validation, navigation target validation, interaction schema validation,
// and the security boundary (dangerous keys, unsafe values, bounds).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  ELEMENT_MAX_NODES,
  ElementAnimationSchema,
  ElementBindingSchema,
  ElementCustomCodeSchema,
  ElementGeometrySchema,
  ElementInteractionSchema,
  ElementNodeSchema,
  ElementStyleTokensSchema,
  ElementTreeSchema,
  ElementViewportStylesSchema,
  NavTargetSchema,
  findDangerousElementKeys,
  isSafeElementCssValue,
  validateElementTreeStructure,
} from "../schemas/element-schemas";
import type { ElementTree } from "../types";

function baseNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "n1",
    type: "heading",
    parentId: null,
    children: [],
    props: { text: "Hello" },
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("ElementNodeSchema", () => {
  it("accepts a valid node and applies defaults", () => {
    const result = ElementNodeSchema.safeParse(baseNode());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.visible).toBe(true);
  });

  it("rejects unknown element types", () => {
    const result = ElementNodeSchema.safeParse(baseNode({ type: "mystery" }));
    expect(result.success).toBe(false);
  });

  it("accepts element-only types", () => {
    expect(ElementNodeSchema.safeParse(baseNode({ type: "section" })).success).toBe(true);
    expect(ElementNodeSchema.safeParse(baseNode({ type: "text" })).success).toBe(true);
    expect(ElementNodeSchema.safeParse(baseNode({ type: "carousel" })).success).toBe(true);
  });

  it("rejects prototype-pollution keys in props (via JSON round trip)", () => {
    const node = JSON.parse(
      '{"id":"n1","type":"heading","parentId":null,"children":[],"props":{"__proto__":{"polluted":true}},"style":{},"responsive":{},"visible":true,"locked":false,"hidden":false}',
    );
    const result = ElementNodeSchema.safeParse(node);
    expect(result.success).toBe(false);
  });

  it("rejects unsafe CSS values in style", () => {
    const result = ElementNodeSchema.safeParse(
      baseNode({ style: { backgroundImage: "url(javascript:alert(1))" } }),
    );
    expect(result.success).toBe(false);
    expect(isSafeElementCssValue("url(javascript:alert(1))")).toBe(false);
    expect(isSafeElementCssValue("red")).toBe(true);
  });

  it("rejects oversized text props", () => {
    const result = ElementNodeSchema.safeParse(
      baseNode({ props: { text: "x".repeat(4001) } }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts a valid geometry and rejects malformed geometry", () => {
    expect(
      ElementNodeSchema.safeParse(
        baseNode({ geometry: { mode: "absolute", x: 10, y: 20, width: 300, rotation: 45, zIndex: 2 } }),
      ).success,
    ).toBe(true);
    expect(
      ElementNodeSchema.safeParse(baseNode({ geometry: { mode: "absolute", width: "wide" } })).success,
    ).toBe(false);
    expect(
      ElementGeometrySchema.safeParse({ mode: "absolute", rotation: 5000 }).success,
    ).toBe(false);
  });

  it("accepts valid viewport overrides and rejects unknown keys", () => {
    expect(
      ElementNodeSchema.safeParse(
        baseNode({ viewport: { tablet: { fontSize: "18px" }, mobile: { fontSize: "14px" } } }),
      ).success,
    ).toBe(true);
    expect(
      ElementViewportStylesSchema.safeParse({ desktop: { fontSize: "20px" } }).success,
    ).toBe(false);
  });

  it("rejects invalid animation data", () => {
    expect(
      ElementAnimationSchema.safeParse({ trigger: "load", type: "fade", durationMs: 300 }).success,
    ).toBe(true);
    expect(
      ElementAnimationSchema.safeParse({ trigger: "while-editing", type: "fade" }).success,
    ).toBe(false);
    expect(
      ElementAnimationSchema.safeParse({ trigger: "load", type: "fade", easing: "url(javascript:)" }).success,
    ).toBe(false);
  });
});

describe("NavTargetSchema", () => {
  it("accepts every target kind", () => {
    expect(NavTargetSchema.safeParse({ kind: "page", pageId: "p1" }).success).toBe(true);
    expect(NavTargetSchema.safeParse({ kind: "section", sectionId: "s1" }).success).toBe(true);
    expect(NavTargetSchema.safeParse({ kind: "section", pageId: "p1", sectionId: "s1" }).success).toBe(true);
    expect(NavTargetSchema.safeParse({ kind: "external", url: "https://example.com" }).success).toBe(true);
    expect(NavTargetSchema.safeParse({ kind: "email", to: "a@b.co" }).success).toBe(true);
    expect(NavTargetSchema.safeParse({ kind: "phone", number: "+1 555" }).success).toBe(true);
    expect(NavTargetSchema.safeParse({ kind: "back" }).success).toBe(true);
  });

  it("rejects unsafe external URLs", () => {
    expect(NavTargetSchema.safeParse({ kind: "external", url: "javascript:alert(1)" }).success).toBe(false);
    expect(NavTargetSchema.safeParse({ kind: "external", url: "data:text/html,<script>" }).success).toBe(false);
  });

  it("rejects unknown kinds and missing required fields", () => {
    expect(NavTargetSchema.safeParse({ kind: "popup" }).success).toBe(false);
    expect(NavTargetSchema.safeParse({ kind: "page" }).success).toBe(false);
  });
});

describe("ElementInteractionSchema", () => {
  it("accepts valid click/hover/scroll data", () => {
    expect(
      ElementInteractionSchema.safeParse({
        click: { kind: "navigate", target: { kind: "page", pageId: "p1" } },
        hover: { scale: 1.05, shadow: "md" },
        scroll: { kind: "sticky", offset: 0 },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed actions and unknown effect kinds", () => {
    expect(
      ElementInteractionSchema.safeParse({ click: { kind: "navigate" } }).success,
    ).toBe(false);
    expect(
      ElementInteractionSchema.safeParse({ click: { kind: "teleport" } }).success,
    ).toBe(false);
    expect(
      ElementInteractionSchema.safeParse({ scroll: { kind: "fly" } }).success,
    ).toBe(false);
  });

  it("rejects navigation inside an action with an unsafe URL", () => {
    expect(
      ElementInteractionSchema.safeParse({
        click: { kind: "navigate", target: { kind: "external", url: "javascript:evil()" } },
      }).success,
    ).toBe(false);
  });
});

describe("binding / custom code", () => {
  it("validates binding sources and rejects unknown sources", () => {
    expect(ElementBindingSchema.safeParse({ source: "collection", collectionId: "products", path: "price" }).success).toBe(true);
    expect(ElementBindingSchema.safeParse({ source: "mysql" }).success).toBe(false);
  });

  it("treats custom code as bounded data only", () => {
    expect(ElementCustomCodeSchema.safeParse({ css: "p { color: red; }", js: "console.log(1)" }).success).toBe(true);
    expect(ElementCustomCodeSchema.safeParse({ js: "x".repeat(20_001) }).success).toBe(false);
  });
});

describe("ElementTreeSchema / structural validation", () => {
  function tree(nodes: Record<string, unknown>, rootIds: string[]): ElementTree {
    return {
      rootIds,
      nodes: Object.fromEntries(
        Object.entries(nodes).map(([id, node]) => [
          id,
          { id, type: "container", parentId: null, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false, ...(node as Record<string, unknown>) },
        ]),
      ),
    } as unknown as ElementTree;
  }

  it("accepts a valid multi-root tree", () => {
    const t = tree({ a: { type: "section" }, b: { type: "footer" } }, ["a", "b"]);
    expect(ElementTreeSchema.safeParse(t).success).toBe(true);
  });

  it("rejects orphaned nodes", () => {
    const t = tree({ a: { type: "section" }, b: { type: "heading" } }, ["a"]);
    const structural = validateElementTreeStructure(t);
    expect(structural.valid).toBe(false);
    expect(structural.problems.some((p) => p.message.includes("orphaned"))).toBe(true);
  });

  it("rejects cycles", () => {
    const t: ElementTree = {
      rootIds: ["a"],
      nodes: {
        a: { id: "a", type: "container", parentId: null, children: ["b"], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
        b: { id: "b", type: "container", parentId: "a", children: ["a"], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
      },
    };
    expect(validateElementTreeStructure(t).valid).toBe(false);
  });

  it("enforces the node cap", () => {
    const nodes: Record<string, unknown> = {};
    for (let i = 0; i < ELEMENT_MAX_NODES + 5; i += 1) {
      nodes[`n${i}`] = { type: "container" };
    }
    const structural = validateElementTreeStructure({ rootIds: Object.keys(nodes), nodes });
    expect(structural.problems.some((p) => p.message.includes("at most"))).toBe(true);
  });

  it("rejects root nodes that have a parent", () => {
    const t = tree({ a: { parentId: "x" } }, ["a"]);
    const structural = validateElementTreeStructure(t);
    expect(structural.valid).toBe(false);
  });
});

describe("dangerous-key scanner", () => {
  it("finds dangerous keys at any depth", () => {
    const problems = findDangerousElementKeys({ a: { b: { constructor: {} } } });
    expect(problems.length).toBeGreaterThan(0);
    expect(findDangerousElementKeys({ a: 1, b: "safe" })).toEqual([]);
  });

  it("flags prototype keys even when JSON-built", () => {
    const payload = JSON.parse('{"__proto__": {"x": 1}, "ok": true}');
    expect(findDangerousElementKeys(payload).length).toBeGreaterThan(0);
  });

  it("style tokens schema rejects unsafe and accepts safe", () => {
    expect(ElementStyleTokensSchema.safeParse({ color: "red", fontSize: "1rem" }).success).toBe(true);
    expect(ElementStyleTokensSchema.safeParse({ background: "expression(alert(1))" }).success).toBe(false);
  });
});
