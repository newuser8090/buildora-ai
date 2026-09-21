// ---------------------------------------------------------------------------
// Canvas selection tests (Phase P22-B)
// Covers: single selection, deselection, nested selection (deepest hit wins),
// hidden/locked guards, selection set ops, purge-on-disappear, top-level
// resolution, and multi-selection invariants.
//
// Phase P27 Slice 1: marquee rect-intersection hit-testing (rectIntersects,
// marqueeRect, marqueeHitTest) — D1 with OQ-1 resolved to the INTERSECTION
// model, section-scoped hits, and topLevelSelection dedup.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { createElement, insertElement } from "@/features/elements/engine/element-operations";
import type { ElementNode, ElementTree } from "@/features/elements/types";
import {
  addToSelection,
  hitTestElement,
  isManipulable,
  isPointerSelectable,
  marqueeHitTest,
  marqueeRect,
  purgeSelection,
  rectIntersects,
  removeFromSelection,
  selectOnly,
  singleNestedSelectionId,
  splitManipulable,
  toggleSelection,
  topLevelSelection,
} from "../engine/selection";
import type { ElementRect } from "../engine/geometry";

function node(type: string, id: string, overrides: Partial<ElementNode> = {}): ElementNode {
  return {
    id,
    type: type as never,
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function treeWith(parent: ElementNode, children: ElementNode[] = []): ElementTree {
  const nodes: Record<string, ElementNode> = { [parent.id]: { ...parent, children: children.map((c) => c.id) } };
  for (const child of children) {
    nodes[child.id] = { ...child, parentId: parent.id };
  }
  return { rootIds: [parent.id], nodes };
}

const RECTS: Record<string, ElementRect> = {
  root: { x: 0, y: 0, width: 500, height: 300 },
  card: { x: 20, y: 30, width: 200, height: 120 },
  btn: { x: 40, y: 50, width: 80, height: 30 },
};

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

describe("hit testing", () => {
  // root → card → btn (deepest hit wins)
  const cardWithBtn: ElementTree = {
    rootIds: ["root"],
    nodes: {
      root: node("section", "root", { children: ["card"] }),
      card: node("card", "card", { parentId: "root", children: ["btn"] }),
      btn: node("button", "btn", { parentId: "card" }),
    },
  };

  it("selects the deepest element under the pointer (nested selection)", () => {
    expect(hitTestElement(cardWithBtn, { x: 50, y: 60 }, (id) => RECTS[id])).toBe("btn");
    expect(hitTestElement(cardWithBtn, { x: 150, y: 80 }, (id) => RECTS[id])).toBe("card");
    expect(hitTestElement(cardWithBtn, { x: 400, y: 200 }, (id) => RECTS[id])).toBe("root");
  });

  it("returns null on empty canvas (deselection)", () => {
    expect(hitTestElement(cardWithBtn, { x: 0, y: 0 }, () => undefined)).toBeNull();
    expect(hitTestElement({ rootIds: [], nodes: {} }, { x: 1, y: 1 }, () => RECTS.root)).toBeNull();
  });

  it("never selects a hidden or invisible element", () => {
    const hidden: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: node("section", "root", { children: ["card"] }),
        card: node("card", "card", { parentId: "root", hidden: true }),
      },
    };
    expect(hitTestElement(hidden, { x: 100, y: 100 }, (id) => RECTS[id])).toBe("root");
  });

  it("locked elements are selectable but not manipulable", () => {
    const locked: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: node("section", "root", { children: ["card"] }),
        card: node("card", "card", { parentId: "root", locked: true }),
      },
    };
    expect(hitTestElement(locked, { x: 100, y: 100 }, (id) => RECTS[id])).toBe("card");
    expect(isPointerSelectable(node("card", "x"))).toBe(true);
    expect(isManipulable(node("card", "x", { locked: true }))).toBe(false);
  });
});

describe("selection set operations", () => {
  it("single-select replaces the set", () => {
    const state = selectOnly(["a", "b"]);
    expect(state.ids).toEqual(["a", "b"]);
    expect(state.multi).toBe(false);
  });

  it("modifier-click toggles an id in and out", () => {
    const added = toggleSelection(selectOnly(["a"]), "b");
    expect(added.ids).toEqual(["a", "b"]);
    const removed = toggleSelection(added, "a");
    expect(removed.ids).toEqual(["b"]);
  });

  it("add/remove are idempotent and order-preserving", () => {
    let state = addToSelection(selectOnly(["b"]), "a");
    state = addToSelection(state, "a");
    expect(state.ids).toEqual(["b", "a"]);
    state = removeFromSelection(state, "b");
    expect(state.ids).toEqual(["a"]);
  });
});

describe("selection validity against the tree", () => {
  // root → card → btn
  const withBtn: ElementTree = {
    rootIds: ["root"],
    nodes: {
      root: node("section", "root", { children: ["card"] }),
      card: node("card", "card", { parentId: "root", children: ["btn"] }),
      btn: node("button", "btn", { parentId: "card" }),
    },
  };

  it("purges ids that no longer exist (self-cleaning)", () => {
    expect(purgeSelection(treeWith(node("section", "root"), [node("card", "card")]), ["card", "gone"])).toEqual(["card"]);
  });

  it("resolves multi-selection to the top level (no ancestor+descendant ops)", () => {
    expect(topLevelSelection(withBtn, ["card", "btn"])).toEqual(["card"]);
    expect(topLevelSelection(withBtn, ["btn"])).toEqual(["btn"]);
    expect(topLevelSelection(withBtn, ["root", "btn"])).toEqual(["root"]);
    expect(topLevelSelection(withBtn, ["btn", "card"])).toEqual(["card"]);
  });

  it("splitManipulable separates locked ids", () => {
    const lockedTree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: node("section", "root", { children: ["card", "locked"] }),
        card: node("card", "card", { parentId: "root" }),
        locked: node("card", "locked", { parentId: "root", locked: true }),
      },
    };
    const { manipulable, locked } = splitManipulable(lockedTree, ["card", "locked"]);
    expect(manipulable).toEqual(["card"]);
    expect(locked).toEqual(["locked"]);
  });

  it("operations keep the tree valid after engine usage", () => {
    // Smoke: a selection-driven op (insert) keeps parent/child integrity.
    const section = createElement("section", { id: "root" });
    const card = createElement("card", { id: "card" });
    const r1 = insertElement(treeWith(section), "root", card);
    if (!r1.ok) return;
    expect(r1.value.nodes.card.parentId).toBe("root");
  });
});

// ---------------------------------------------------------------------------
// singleNestedSelectionId (Phase P24-C, D2/D3)
//
// The inspector routing/targeting rule: only a single NESTED element id of the
// section's own tree resolves; everything else falls through to null so the
// caller keeps its previous behaviour.
// ---------------------------------------------------------------------------

describe("singleNestedSelectionId — inspector element target", () => {
  const tree: ElementTree = {
    rootIds: ["root"],
    nodes: {
      root: node("container", "root", { children: ["text", "cta"] }),
      text: node("heading", "text", { parentId: "root" }),
      cta: node("button", "cta", { parentId: "root" }),
    },
  };

  it("resolves a single nested element", () => {
    expect(singleNestedSelectionId(tree, ["text"])).toBe("text");
  });

  it("treats the section root as the section-level selection, not an element", () => {
    expect(singleNestedSelectionId(tree, ["root"])).toBeNull();
  });

  it("resolves nothing for an empty selection", () => {
    expect(singleNestedSelectionId(tree, [])).toBeNull();
  });

  it("resolves nothing for a multi-selection (ambiguous)", () => {
    expect(singleNestedSelectionId(tree, ["text", "cta"])).toBeNull();
  });

  it("resolves nothing for a stale id from another section's tree", () => {
    expect(singleNestedSelectionId(tree, ["not-in-this-tree"])).toBeNull();
  });

  it("resolves nothing for an empty-string id", () => {
    expect(singleNestedSelectionId(tree, [""])).toBeNull();
  });

  it("resolves nothing for an empty tree", () => {
    expect(singleNestedSelectionId({ rootIds: [], nodes: {} }, ["text"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Marquee hit-testing (Phase P27 Slice 1)
//
// D1 with OQ-1 resolved to the INTERSECTION model: an element overlapping the
// marquee rect at all is selected. Hits are tree-validated, section-scoped
// (root ids can never enter), deterministic in tree order, and resolved to the
// top level of the set so a nested child is never redundantly selected
// alongside its container.
// ---------------------------------------------------------------------------

describe("rectIntersects — OQ-1 intersection model", () => {
  const rect = (x: number, y: number, w: number, h: number): ElementRect => ({ x, y, width: w, height: h });

  it("detects overlap on any partial overlap", () => {
    const a = rect(0, 0, 100, 100);
    expect(rectIntersects(a, rect(50, 50, 100, 100))).toBe(true);
    expect(rectIntersects(a, rect(-50, -50, 100, 100))).toBe(true);
    expect(rectIntersects(a, rect(90, 90, 20, 20))).toBe(true);
    expect(rectIntersects(a, rect(-10, 40, 20, 20))).toBe(true);
  });

  it("never selects on edge-touch only (strict edges)", () => {
    const a = rect(0, 0, 100, 100);
    expect(rectIntersects(a, rect(100, 0, 50, 50))).toBe(false);
    expect(rectIntersects(a, rect(0, 100, 50, 50))).toBe(false);
    expect(rectIntersects(a, rect(-50, 0, 50, 50))).toBe(false);
    expect(rectIntersects(a, rect(0, -50, 50, 50))).toBe(false);
  });

  it("returns false for disjoint rects", () => {
    const a = rect(0, 0, 100, 100);
    expect(rectIntersects(a, rect(200, 200, 10, 10))).toBe(false);
    expect(rectIntersects(a, rect(-100, -100, 10, 10))).toBe(false);
  });

  it("zero-area rects intersect only when strictly inside (pure geometry)", () => {
    const a = rect(0, 0, 100, 100);
    // A zero-width line strictly inside `a` overlaps it under the pure
    // inequality math — the MARQUEE-level guard (marqueeHitTest's zero-area
    // early return) is what makes a click-without-drag select nothing.
    expect(rectIntersects(a, rect(50, 50, 0, 10))).toBe(true);
    expect(rectIntersects(a, rect(50, 50, 10, 0))).toBe(true);
    // Zero-area rects on the boundary or outside never intersect.
    expect(rectIntersects(a, rect(100, 50, 0, 10))).toBe(false);
    expect(rectIntersects(a, rect(200, 200, 0, 0))).toBe(false);
  });
});

describe("marqueeRect — normalization to positive width/height", () => {
  it("normalizes any drag direction to a positive rect", () => {
    expect(marqueeRect({ x: 10, y: 10 }, { x: 60, y: 40 })).toEqual({ x: 10, y: 10, width: 50, height: 30 });
    expect(marqueeRect({ x: 60, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 50, height: 30 });
    expect(marqueeRect({ x: 60, y: 10 }, { x: 10, y: 40 })).toEqual({ x: 10, y: 10, width: 50, height: 30 });
    expect(marqueeRect({ x: 10, y: 40 }, { x: 60, y: 10 })).toEqual({ x: 10, y: 10, width: 50, height: 30 });
  });

  it("yields a zero rect for a click without drag", () => {
    expect(marqueeRect({ x: 7, y: 9 }, { x: 7, y: 9 })).toEqual({ x: 7, y: 9, width: 0, height: 0 });
  });
});

describe("marqueeHitTest (P27 Slice 1)", () => {
  // root(container) → card → btn, plus a sibling heading
  const tree: ElementTree = {
    rootIds: ["root"],
    nodes: {
      root: node("container", "root", { children: ["card", "heading"] }),
      card: node("card", "card", { parentId: "root", children: ["btn"] }),
      btn: node("button", "btn", { parentId: "card" }),
      heading: node("heading", "heading", { parentId: "root" }),
    },
  };

  const RECTS: Record<string, ElementRect> = {
    root: { x: 0, y: 0, width: 500, height: 300 },
    card: { x: 20, y: 30, width: 200, height: 120 },
    btn: { x: 40, y: 50, width: 80, height: 30 },
    heading: { x: 240, y: 40, width: 120, height: 40 },
  };

  it("selects a single element fully inside the marquee", () => {
    const marquee = marqueeRect({ x: 230, y: 30 }, { x: 380, y: 90 });
    expect(marqueeHitTest(tree, marquee, RECTS)).toEqual(["heading"]);
  });

  it("selects elements PARTIALLY overlapped (OQ-1 intersection, not containment)", () => {
    // Marquee clips the card's left edge only.
    const clipLeft = marqueeRect({ x: -20, y: 20 }, { x: 30, y: 200 });
    expect(marqueeHitTest(tree, clipLeft, RECTS)).toEqual(["card"]);
    // Marquee clips the heading's right edge only.
    const clipRight = marqueeRect({ x: 350, y: 30 }, { x: 380, y: 90 });
    expect(marqueeHitTest(tree, clipRight, RECTS)).toEqual(["heading"]);
  });

  it("selects multiple elements and returns them in deterministic tree order", () => {
    // Covers card (+ its nested btn) and heading.
    const marquee = marqueeRect({ x: 10, y: 20 }, { x: 400, y: 200 });
    expect(marqueeHitTest(tree, marquee, RECTS)).toEqual(["card", "btn", "heading"]);
  });

  it("never selects the section root even when the marquee covers the whole section", () => {
    const marquee = marqueeRect({ x: -10, y: -10 }, { x: 510, y: 310 });
    expect(marqueeHitTest(tree, marquee, RECTS)).toEqual(["card", "btn", "heading"]);
  });

  it("selects nothing outside the marquee (empty set on a miss)", () => {
    const marquee = marqueeRect({ x: 400, y: 200 }, { x: 480, y: 280 });
    expect(marqueeHitTest(tree, marquee, RECTS)).toEqual([]);
  });

  it("skips hidden and invisible elements", () => {
    const hiddenTree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: node("container", "root", { children: ["card", "ghost"] }),
        card: node("card", "card", { parentId: "root" }),
        ghost: node("heading", "ghost", { parentId: "root", hidden: true }),
      },
    };
    const marquee = marqueeRect({ x: 0, y: 0 }, { x: 500, y: 300 });
    expect(marqueeHitTest(hiddenTree, marquee, RECTS)).toEqual(["card"]);
  });

  it("selects locked elements (selectable per P22-B) — manipulation excludes them later", () => {
    const lockedTree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: node("container", "root", { children: ["frozen"] }),
        frozen: node("card", "frozen", { parentId: "root", locked: true }),
      },
    };
    const lockedRects: Record<string, ElementRect> = {
      ...RECTS,
      frozen: { x: 100, y: 100, width: 60, height: 30 },
    };
    const marquee = marqueeRect({ x: 0, y: 0 }, { x: 500, y: 300 });
    expect(marqueeHitTest(lockedTree, marquee, lockedRects)).toEqual(["frozen"]);
  });

  it("ignores rects keyed by ids that are not in this tree (no cross-section leaks)", () => {
    const foreignRects: Record<string, ElementRect> = {
      ...RECTS,
      "other-section-element": { x: 0, y: 0, width: 500, height: 300 },
    };
    const marquee = marqueeRect({ x: -10, y: -10 }, { x: 510, y: 310 });
    expect(marqueeHitTest(tree, marquee, foreignRects)).toEqual(["card", "btn", "heading"]);
  });

  it("ignores candidates without a measured rect (measurement gaps fail closed)", () => {
    expect(marqueeHitTest(tree, marqueeRect({ x: -10, y: -10 }, { x: 510, y: 310 }), {})).toEqual([]);
  });
});

describe("marquee → topLevelSelection dedup (P27 Slice 1 contract)", () => {
  const tree: ElementTree = {
    rootIds: ["root"],
    nodes: {
      root: node("container", "root", { children: ["card"] }),
      card: node("card", "card", { parentId: "root", children: ["btn"] }),
      btn: node("button", "btn", { parentId: "card" }),
    },
  };

  const RECTS: Record<string, ElementRect> = {
    root: { x: 0, y: 0, width: 500, height: 300 },
    card: { x: 20, y: 30, width: 200, height: 120 },
    btn: { x: 40, y: 50, width: 80, height: 30 },
  };

  it("a marquee covering a container and its child dedups to the container", () => {
    const hits = marqueeHitTest(tree, marqueeRect({ x: 0, y: 0 }, { x: 500, y: 300 }), RECTS);
    expect(hits).toEqual(["card", "btn"]);
    expect(topLevelSelection(tree, hits)).toEqual(["card"]);
  });

  it("a marquee over the child alone keeps the child ONLY when the child overflows its container", () => {
    // With the intersection model + container rects enclosing their children,
    // a marquee over a child normally co-hits the container (the previous test
    // pins that). The child resolves alone only when it OVERFLOWS the
    // container's rect (legitimate in DOM), so the marquee can miss the
    // container while clipping the child.
    const overflowing: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: node("container", "root", { children: ["card"] }),
        card: node("card", "card", { parentId: "root", children: ["btn"] }),
        btn: node("button", "btn", { parentId: "card" }),
      },
    };
    const overflowRects: Record<string, ElementRect> = {
      root: { x: 0, y: 0, width: 500, height: 300 },
      card: { x: 20, y: 30, width: 200, height: 120 },
      btn: { x: 240, y: 160, width: 80, height: 30 }, // outside card's rect
    };
    const hits = marqueeHitTest(overflowing, marqueeRect({ x: 230, y: 150 }, { x: 330, y: 200 }), overflowRects);
    expect(hits).toEqual(["btn"]);
    expect(topLevelSelection(tree, hits)).toEqual(["btn"]);
  });
});
