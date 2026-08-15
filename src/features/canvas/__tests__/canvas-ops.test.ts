// ---------------------------------------------------------------------------
// Canvas ops tests (Phase P22-B)
// Covers: alignment (all 6 modes), distribution, layer ordering (scoped per
// parent), duplicate/delete, clipboard (new ids, no shared references,
// internal-key stripping, offset), and keyboard shortcut mapping.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { createElement, updateElementGeometry } from "@/features/elements/engine/element-operations";
import type { ElementNode, ElementTree } from "@/features/elements/types";
import { alignRect, alignRects, buildAlignOps, buildDistributeOps, distributeRects } from "../engine/align";
import { applyLayerAction, buildLayerOps } from "../engine/layering";
import { applyPasteOps, buildPasteOps, copySelection, parseClipboard, serializeClipboard } from "../engine/clipboard";
import { applyElementOpBatch } from "../engine/batch";
import { matchCanvasShortcut } from "../engine/shortcuts";
import { validateElementTree } from "@/features/elements/engine/element-validation";

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

function rects(): Record<string, { x: number; y: number; width: number; height: number }> {
  return {
    a: { x: 0, y: 0, width: 100, height: 50 },
    b: { x: 200, y: 100, width: 100, height: 50 },
    c: { x: 400, y: 200, width: 100, height: 50 },
  };
}

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

describe("alignment", () => {
  const rs = [rects().a, rects().b, rects().c];

  it("aligns left / center-h / right", () => {
    const left = alignRects(rs, "left");
    expect(left.map((r) => r.x)).toEqual([0, 0, 0]);
    const center = alignRects(rs, "center-h");
    expect(center[0].x).toBeCloseTo(200);
    expect(center[1].x).toBeCloseTo(200);
    expect(center[2].x).toBeCloseTo(200);
    const right = alignRects(rs, "right");
    expect(right.map((r) => r.x)).toEqual([400, 400, 400]);
  });

  it("aligns top / middle-v / bottom", () => {
    const top = alignRects(rs, "top");
    expect(top.map((r) => r.y)).toEqual([0, 0, 0]);
    const middle = alignRects(rs, "middle-v");
    expect(middle.map((r) => r.y)).toEqual([100, 100, 100]);
    const bottom = alignRects(rs, "bottom");
    expect(bottom.map((r) => r.y)).toEqual([200, 200, 200]);
  });

  it("single-element alignment keeps the element in place (bounds = the element)", () => {
    const single = alignRects([rs[0]], "left");
    expect(single[0]).toEqual(rs[0]);
  });

  it("alignRect computes absolute alignment within bounds", () => {
    const bounds = { x: 0, y: 0, width: 500, height: 250 };
    const aligned = alignRect(rs[0], "right", bounds);
    expect(aligned.x).toBe(400);
  });

  it("builds real geometry ops that participate in the tree", () => {
    const section = createElement("section", { id: "root" });
    const tree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: { ...section, children: ["a", "b", "c"] },
        a: { ...node("card", "a"), parentId: "root" },
        b: { ...node("card", "b"), parentId: "root" },
        c: { ...node("card", "c"), parentId: "root" },
      },
    };
    const ops = buildAlignOps(tree, ["a", "b", "c"], rects(), "left");
    expect(ops.length).toBeGreaterThan(0);
    const result = applyElementOpBatch(tree, ops);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.tree) return;
    expect(result.tree.nodes.a.geometry?.x).toBe(0);
    expect(validateElementTree(result.tree).valid).toBe(true);
  });
});

describe("distribution", () => {
  it("spaces elements evenly, keeping first and last in place", () => {
    const rs = [
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 0, width: 100, height: 50 }, // will be moved
      { x: 400, y: 0, width: 100, height: 50 },
    ];
    const distributed = distributeRects(rs, "horizontal");
    expect(distributed[0].x).toBe(0);
    expect(distributed[2].x).toBe(400);
    expect(distributed[1].x).toBe(200); // evenly spaced
  });

  it("returns rects unchanged with fewer than 3 elements", () => {
    const rs = [rects().a, rects().b];
    expect(distributeRects(rs, "horizontal")).toBe(rs);
  });

  it("buildDistributeOps produces vertical ops", () => {
    const tree = { rootIds: ["root"], nodes: { root: { ...node("section", "root"), children: ["a", "b", "c"] }, a: { ...node("card", "a"), parentId: "root" }, b: { ...node("card", "b"), parentId: "root" }, c: { ...node("card", "c"), parentId: "root" } } } as unknown as ElementTree;
    const ops = buildDistributeOps(tree, ["a", "b", "c"], {
      a: { x: 0, y: 0, width: 100, height: 50 },
      b: { x: 0, y: 0, width: 100, height: 50 },
      c: { x: 0, y: 300, width: 100, height: 50 },
    }, "vertical");
    expect(ops.length).toBeGreaterThan(0);
    const result = applyElementOpBatch(tree, ops);
    expect(result.ok).toBe(true);
  });
});

describe("layer ordering (scoped per parent)", () => {
  const order = ["a", "b", "c", "d"];

  it("brings one element forward / backward", () => {
    expect(applyLayerAction(order, ["b"], "forward")).toEqual(["a", "c", "b", "d"]);
    expect(applyLayerAction(order, ["c"], "backward")).toEqual(["a", "c", "b", "d"]);
  });

  it("brings to front / back", () => {
    expect(applyLayerAction(order, ["a"], "front")).toEqual(["b", "c", "d", "a"]);
    expect(applyLayerAction(order, ["d"], "back")).toEqual(["d", "a", "b", "c"]);
  });

  it("preserves relative order of multi-selected ids", () => {
    expect(applyLayerAction(order, ["a", "c"], "front")).toEqual(["b", "d", "a", "c"]);
    expect(applyLayerAction(order, ["b", "d"], "back")).toEqual(["b", "d", "a", "c"]);
  });

  it("is a no-op at the boundaries", () => {
    expect(applyLayerAction(order, ["a"], "backward")).toEqual(order);
    expect(applyLayerAction(order, ["d"], "forward")).toEqual(order);
    expect(applyLayerAction(order, ["a"], "back")).toEqual(order);
    expect(applyLayerAction(order, ["d"], "front")).toEqual(order);
  });

  it("buildLayerOps emits scoped move ops that keep the tree valid", () => {
    const section = createElement("section", { id: "root" });
    const tree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: { ...section, children: ["a", "b", "c", "d"] },
        a: { ...node("card", "a"), parentId: "root" },
        b: { ...node("card", "b"), parentId: "root" },
        c: { ...node("card", "c"), parentId: "root" },
        d: { ...node("card", "d"), parentId: "root" },
      },
    };
    const ops = buildLayerOps(tree, ["a", "c"], "front");
    expect(ops.length).toBeGreaterThan(0);
    const result = applyElementOpBatch(tree, ops);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.tree) return;
    expect(result.tree.nodes.root.children).toEqual(["b", "d", "a", "c"]);
    expect(validateElementTree(result.tree).valid).toBe(true);
  });
});

describe("clipboard", () => {
  function treeWithCard(): { tree: ElementTree; cardId: string } {
    const section = createElement("section", { id: "root" });
    const card = createElement("card", { id: "card", props: { title: "T" } });
    const inner = createElement("heading", { id: "inner", props: { text: "Hi" } });
    let tree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: { ...section, children: ["card"] },
        card: { ...card, parentId: "root" },
        inner: { ...inner, parentId: "card" },
      },
    };
    tree = {
      ...tree,
      nodes: { ...tree.nodes, card: { ...tree.nodes.card, children: ["inner"] } },
    };
    return { tree, cardId: "card" };
  }

  it("copies top-level subtrees with descendants and strips internal keys", () => {
    const { tree, cardId } = treeWithCard();
    const treeWithInternal = {
      ...tree,
      nodes: {
        ...tree.nodes,
        card: { ...tree.nodes.card, props: { ...tree.nodes.card.props, _bindPath: ["x"], title: "T" } },
      },
    };
    const payload = copySelection(treeWithInternal, [cardId]);
    expect(payload.elements.some((n) => n.id === "inner")).toBe(true);
    const cardClone = payload.elements.find((n) => n.id === cardId)!;
    expect(cardClone.props._bindPath).toBeUndefined();
    expect(cardClone.props.title).toBe("T");
  });

  it("serializes and parses round-trip; rejects malformed payloads", () => {
    const { tree, cardId } = treeWithCard();
    const payload = copySelection(tree, [cardId]);
    const parsed = parseClipboard(serializeClipboard(payload));
    expect(parsed).not.toBeNull();
    expect(parsed!.elements.length).toBe(2);
    expect(parseClipboard("{not json")).toBeNull();
    expect(parseClipboard(JSON.stringify({ version: 99, elements: [] }))).toBeNull();
    expect(parseClipboard(JSON.stringify({ version: 1, elements: [{ type: "mystery" }] }))).toBeNull();
  });

  it("paste assigns fresh ids, offsets geometry, and never shares references", () => {
    const { tree, cardId } = treeWithCard();
    const withGeom = updateElementGeometry(tree, cardId, { x: 10, y: 20, width: 100 });
    if (!withGeom.ok) return;
    const payload = copySelection(withGeom.value, [cardId]);
    const ops = buildPasteOps(withGeom.value, "root", payload);
    const result = applyPasteOps(withGeom.value, ops);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.tree) return;
    const insertedId = result.inserted![0];
    expect(insertedId).not.toBe(cardId);
    expect(validateElementTree(result.tree).valid).toBe(true);
    // Fresh ids for descendants too.
    const pastedCard = result.tree.nodes[insertedId];
    const pastedInnerId = pastedCard?.children[0];
    expect(pastedInnerId).not.toBe("inner");
    expect(result.tree.nodes[pastedInnerId!].parentId).toBe(insertedId);
    // Geometry offset applied.
    expect(pastedCard?.geometry?.x).toBe(10 + 24);
    expect(pastedCard?.geometry?.y).toBe(20 + 24);
    // No shared references with the original.
    pastedCard!.props = { ...pastedCard!.props, title: "MUTATED" };
    expect(result.tree.nodes[cardId].props.title).toBe("T");
  });

  it("paste honors ancestor/descendant relationships after id remap", () => {
    const { tree, cardId } = treeWithCard();
    const payload = copySelection(tree, [cardId]);
    const ops = buildPasteOps(tree, "root", payload);
    const result = applyPasteOps(tree, ops);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.tree) return;
    const root = result.tree.nodes.root;
    expect(root.children).toContain(cardId);
    expect(root.children.filter((c) => c !== cardId)).toHaveLength(1);
  });
});

describe("delete / duplicate via engine", () => {
  it("deleteElement removes descendants; duplicateElement remaps ids", () => {
    const section = createElement("section", { id: "root" });
    const card = createElement("card", { id: "card" });
    const tree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: { ...section, children: ["card"] },
        card: { ...card, parentId: "root" },
      },
    };
    const duplicated = applyElementOpBatch(tree, [{ kind: "duplicate", elementId: "card" }]);
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok || !duplicated.tree) return;
    const newId = duplicated.tree.nodes.root.children.find((c) => c !== "card")!;
    expect(duplicated.tree.nodes[newId].parentId).toBe("root");
    const deleted = applyElementOpBatch(duplicated.tree, [{ kind: "delete", elementId: "card" }]);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok || !deleted.tree) return;
    expect(deleted.tree.nodes.card).toBeUndefined();
    expect(deleted.tree.nodes.root.children).toEqual([newId]);
    expect(validateElementTree(deleted.tree).valid).toBe(true);
  });
});

describe("keyboard shortcuts", () => {
  function keyEvent(key: string, opts: { ctrl?: boolean; meta?: boolean; shift?: boolean; target?: EventTarget | null } = {}): KeyboardEvent {
    const target = opts.target ?? (typeof document !== "undefined" ? document.body : null);
    return {
      key,
      ctrlKey: opts.ctrl ?? false,
      metaKey: opts.meta ?? false,
      shiftKey: opts.shift ?? false,
      altKey: false,
      target,
      preventDefault: () => {},
    } as unknown as KeyboardEvent;
  }

  it("maps delete/backspace, modifiers, escape and arrows", () => {
    expect(matchCanvasShortcut(keyEvent("Delete"))).toBe("delete");
    expect(matchCanvasShortcut(keyEvent("Backspace"))).toBe("delete");
    expect(matchCanvasShortcut(keyEvent("d", { ctrl: true }))).toBe("duplicate");
    expect(matchCanvasShortcut(keyEvent("c", { meta: true }))).toBe("copy");
    expect(matchCanvasShortcut(keyEvent("v", { ctrl: true }))).toBe("paste");
    expect(matchCanvasShortcut(keyEvent("Escape"))).toBe("deselect");
    expect(matchCanvasShortcut(keyEvent("ArrowRight"))).toBe("nudge");
    expect(matchCanvasShortcut(keyEvent("ArrowRight", { shift: true }))).toBe("nudge-large");
  });

  it("never fires while typing inside inputs/contenteditable", () => {
    const input = { matches: () => true, closest: () => true } as unknown as HTMLElement;
    expect(matchCanvasShortcut(keyEvent("Delete", { target: input }))).toBeNull();
    expect(matchCanvasShortcut(keyEvent("d", { ctrl: true, target: input }))).toBeNull();
    expect(matchCanvasShortcut(keyEvent("ArrowDown", { target: input }))).toBeNull();
  });

  it("does not hijack Cmd+Backspace (OS-level) or unhandled modifiers", () => {
    expect(matchCanvasShortcut(keyEvent("Backspace", { meta: true }))).toBeNull();
    expect(matchCanvasShortcut(keyEvent("x", { ctrl: true }))).toBeNull();
    expect(matchCanvasShortcut(keyEvent("Escape", { ctrl: true }))).toBeNull();
  });
});
