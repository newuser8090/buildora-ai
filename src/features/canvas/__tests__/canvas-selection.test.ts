// ---------------------------------------------------------------------------
// Canvas selection tests (Phase P22-B)
// Covers: single selection, deselection, nested selection (deepest hit wins),
// hidden/locked guards, selection set ops, purge-on-disappear, top-level
// resolution, and multi-selection invariants.
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
  purgeSelection,
  removeFromSelection,
  selectOnly,
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
