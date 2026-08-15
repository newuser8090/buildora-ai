// ---------------------------------------------------------------------------
// Element operations tests (Phase P22-A)
// All operations must be immutable, validated, and never throw. Metadata ops
// (geometry, viewport, animation, interaction, binding) are included. The
// output must stay compatible with the existing collab projection pipeline.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { normalizeBlockTree } from "@/features/collaboration/crdt/tree-normalizer";
import {
  applyElementOperation,
  createElement,
  deleteElement,
  duplicateElement,
  insertElement,
  moveElement,
  renameElement,
  setElementHidden,
  setElementLocked,
  setElementVisible,
  updateElementAnimation,
  updateElementBinding,
  updateElementGeometry,
  updateElementInteraction,
  updateElementProps,
  updateElementResponsive,
  updateElementStyle,
  updateElementViewport,
} from "../engine/element-operations";
import { validateElementTree } from "../engine/element-validation";
import { registerDefaultElements } from "../registry/register-default-elements";
import { serializeElementTree } from "../serialization/element-serializer";
import type { ElementNode, ElementTree } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

function treeWith(root: ElementNode): ElementTree {
  return { rootIds: [root.id], nodes: { [root.id]: root } };
}

function sectionWithRoot(): ElementTree {
  return treeWith(createElement("section", { id: "sec" }));
}

describe("structural operations", () => {
  it("inserts into an element-only root (section)", () => {
    const result = insertElement(sectionWithRoot(), "sec", createElement("heading", { id: "h" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.sec.children).toEqual(["h"]);
    expect(result.value.nodes.h.parentId).toBe("sec");
    expect(validateElementTree(result.value).valid).toBe(true);
  });

  it("rejects nesting violations with element error codes", () => {
    const result = insertElement(treeWith(createElement("text", { id: "t" })), "t", createElement("heading"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_NESTING_RULE_VIOLATION");
  });

  it("insertElement enforces typed props schemas (defense-in-depth)", () => {
    const section = createElement("section", { id: "sec" });
    const invalidText = createElement("text", { id: "bad", props: { text: "" } });
    const result = insertElement(treeWith(section), "sec", invalidText);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_PROPS_INVALID");
  });

  it("updateElementResponsive enforces the breakpoint cap", () => {
    const root = createElement("heading", { id: "h" });
    let tree = treeWith(root);
    for (const bp of ["xs", "sm", "md", "lg", "xl"]) {
      const r = updateElementResponsive(tree, "h", bp, { fontSize: "16px" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      tree = r.value;
    }
    const sixth = updateElementResponsive(tree, "h", "2xl", { fontSize: "20px" });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.error.code).toBe("ELEMENT_VIEWPORT_INVALID");
  });

  it("rejects unknown parents and duplicate ids", () => {
    const result = insertElement(sectionWithRoot(), "missing", createElement("heading"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_TARGET_NOT_FOUND");

    const withChild = insertElement(sectionWithRoot(), "sec", createElement("heading", { id: "h" }));
    if (!withChild.ok) return;
    const dup = insertElement(withChild.value, "sec", createElement("heading", { id: "h" }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("ELEMENT_ID_CONFLICT");
  });

  it("deletes and prunes descendants", () => {
    let tree = sectionWithRoot();
    const r1 = insertElement(tree, "sec", createElement("card", { id: "card" }));
    if (!r1.ok) return;
    tree = r1.value;
    const r2 = insertElement(tree, "card", createElement("heading", { id: "h" }));
    if (!r2.ok) return;
    const result = deleteElement(r2.value, "card");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.card).toBeUndefined();
    expect(result.value.nodes.h).toBeUndefined();
  });

  it("duplicates subtrees with fresh ids and preserved metadata", () => {
    const section = createElement("section", { id: "sec" });
    const card = createElement("product-card", { id: "card", props: { name: "Widget", price: "$9" } });
    const r1 = insertElement(treeWith(section), "sec", card);
    if (!r1.ok) return;
    const r2 = updateElementGeometry(r1.value, "card", { width: 200 });
    if (!r2.ok) return;
    const result = duplicateElement(r2.value, "card");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { tree, newId } = result.value;
    expect(newId).not.toBe("card");
    expect(tree.nodes[newId].props.name).toBe("Widget");
    expect(tree.nodes[newId].geometry?.width).toBe(200);
    expect(validateElementTree(tree).valid).toBe(true);
  });

  it("moves elements between parents and rejects descendant moves", () => {
    const section = createElement("section", { id: "sec" });
    const a = createElement("container", { id: "a" });
    const b = createElement("container", { id: "b" });
    const heading = createElement("heading", { id: "h" });
    let tree = treeWith(section);
    for (const child of [a, b]) {
      const r = insertElement(tree, "sec", child);
      if (!r.ok) return;
      tree = r.value;
    }
    const r1 = insertElement(tree, "a", heading);
    if (!r1.ok) return;
    const moved = moveElement(r1.value, "h", "b", 0);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.nodes.a.children).toEqual([]);
    expect(moved.value.nodes.b.children).toEqual(["h"]);

    const cycle = moveElement(moved.value, "a", "h");
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.error.code).toBe("ELEMENT_NESTING_RULE_VIOLATION");
  });

  it("lock / hide / visible / rename / props / style behave immutably", () => {
    const root = createElement("heading", { id: "h" });
    const locked = setElementLocked(treeWith(root), "h", true);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    const edit = updateElementProps(locked.value, "h", { text: "nope" });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.code).toBe("ELEMENT_LOCKED");

    const hidden = setElementHidden(treeWith(root), "h", true);
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect(hidden.value.nodes.h.hidden).toBe(true);

    const visible = setElementVisible(treeWith(root), "h", false);
    expect(visible.ok).toBe(true);
    if (!visible.ok) return;
    expect(visible.value.nodes.h.visible).toBe(false);

    const renamed = renameElement(treeWith(root), "h", "  My Section  ");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.nodes.h.props.name).toBe("My Section");

    const styled = updateElementStyle(treeWith(root), "h", { color: "red" });
    expect(styled.ok).toBe(true);
    if (!styled.ok) return;
    expect(styled.value.nodes.h.style.color).toBe("red");
    expect(root.style.color).toBeUndefined(); // input untouched
  });

  it("updateElementProps enforces typed per-family props schemas", () => {
    const text = createElement("text", { id: "t" });
    const ok = updateElementProps(treeWith(text), "t", { text: "New copy" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.nodes.t.props.text).toBe("New copy");

    const bad = updateElementProps(treeWith(text), "t", { text: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ELEMENT_PROPS_INVALID");

    const list = createElement("list", { id: "l" });
    const tooMany = updateElementProps(treeWith(list), "l", {
      items: Array.from({ length: 70 }, (_, i) => `Item ${i}`),
    });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error.code).toBe("ELEMENT_PROPS_INVALID");
  });
});

describe("metadata operations", () => {
  function treeWithHeading(): { tree: ElementTree; id: string } {
    return { tree: treeWith(createElement("heading", { id: "h" })), id: "h" };
  }

  it("updateElementGeometry merges and preserves mode", () => {
    const { tree, id } = treeWithHeading();
    const r1 = updateElementGeometry(tree, id, { width: 320 });
    if (!r1.ok) return;
    expect(r1.value.nodes[id].geometry).toEqual({ mode: "flow", width: 320 });
    const r2 = updateElementGeometry(r1.value, id, { height: 80, rotation: 15 });
    if (!r2.ok) return;
    expect(r2.value.nodes[id].geometry).toEqual({ mode: "flow", width: 320, height: 80, rotation: 15 });
  });

  it("updateElementGeometry rejects malformed values", () => {
    const { tree, id } = treeWithHeading();
    const result = updateElementGeometry(tree, id, { width: Number.NaN });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_GEOMETRY_INVALID");
  });

  it("updateElementViewport writes base overrides into style and breakpoints into viewport", () => {
    const { tree, id } = treeWithHeading();
    const base = updateElementViewport(tree, id, "base", { fontSize: "24px" });
    if (!base.ok) return;
    expect(base.value.nodes[id].style.fontSize).toBe("24px");

    const tablet = updateElementViewport(base.value, id, "tablet", { fontSize: "18px" });
    if (!tablet.ok) return;
    expect(tablet.value.nodes[id].viewport?.tablet?.fontSize).toBe("18px");

    const mobile = updateElementViewport(tablet.value, id, "mobile", { fontSize: "14px" });
    if (!mobile.ok) return;
    expect(mobile.value.nodes[id].viewport?.tablet?.fontSize).toBe("18px");
    expect(mobile.value.nodes[id].viewport?.mobile?.fontSize).toBe("14px");
  });

  it("updateElementResponsive writes legacy block breakpoint tokens", () => {
    const { tree, id } = treeWithHeading();
    const result = updateElementResponsive(tree, id, "sm", { fontSize: "20px" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes[id].responsive.sm?.fontSize).toBe("20px");
  });

  it("updateElementAnimation validates and clears", () => {
    const { tree, id } = treeWithHeading();
    const ok = updateElementAnimation(tree, id, { trigger: "load", type: "fade", durationMs: 400 });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.nodes[id].animation?.type).toBe("fade");
    const bad = updateElementAnimation(tree, id, { trigger: "bogus" as never, type: "fade" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ELEMENT_ANIMATION_INVALID");
    const cleared = updateElementAnimation(ok.value, id, null);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.nodes[id].animation).toBeUndefined();
  });

  it("updateElementInteraction validates navigation targets", () => {
    const { tree, id } = treeWithHeading();
    const ok = updateElementInteraction(tree, id, {
      click: { kind: "navigate", target: { kind: "page", pageId: "p1" } },
      hover: { scale: 1.05 },
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.nodes[id].interaction?.click?.kind).toBe("navigate");
    const bad = updateElementInteraction(tree, id, {
      click: { kind: "navigate", target: { kind: "external", url: "javascript:bad()" } },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ELEMENT_INTERACTION_INVALID");
  });

  it("updateElementBinding validates sources", () => {
    const { tree, id } = treeWithHeading();
    const ok = updateElementBinding(tree, id, { source: "collection", collectionId: "products", path: "price" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.nodes[id].binding?.collectionId).toBe("products");
    const bad = updateElementBinding(tree, id, { source: "oracle" as never });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ELEMENT_BINDING_INVALID");
  });
});

describe("dispatcher + pipeline compatibility", () => {
  it("applyElementOperation routes every kind", () => {
    const tree = sectionWithRoot();
    const inserted = applyElementOperation(tree, {
      kind: "insert",
      parentId: "sec",
      element: createElement("heading", { id: "h" }),
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    const base = inserted.value as ElementTree;

    const ops: Array<[string, Parameters<typeof applyElementOperation>[1]]> = [
      ["rename", { kind: "rename", elementId: "h", label: "X" }],
      ["update-geometry", { kind: "update-geometry", elementId: "h", geometry: { width: 100 } }],
      ["update-style", { kind: "update-style", elementId: "h", style: { color: "blue" } }],
      ["lock", { kind: "lock", elementId: "h", locked: true }],
      ["hide", { kind: "hide", elementId: "h", hidden: true }],
      ["set-visible", { kind: "set-visible", elementId: "h", visible: true }],
      ["update-animation", { kind: "update-animation", elementId: "h", animation: { trigger: "hover", type: "scale" } }],
      ["update-binding", { kind: "update-binding", elementId: "h", binding: null }],
    ];
    for (const [label, op] of ops) {
      const result = applyElementOperation(base, op);
      expect(result.ok, `${label} should succeed`).toBe(true);
    }
    const dup = applyElementOperation(base, { kind: "duplicate", elementId: "h" });
    expect(dup.ok).toBe(true);
    const del = applyElementOperation(base, { kind: "delete", elementId: "h" });
    expect(del.ok).toBe(true);
    const missing = applyElementOperation(base, { kind: "delete", elementId: "nope" });
    expect(missing.ok).toBe(false);
  });

  it("ops output remains compatible with the existing collab projection pipeline", () => {
    // The collab bridge (normalizeBlockTree) accepts block-shaped trees.
    // A tree produced by element ops must still pass it (proving element ops
    // can flow through the existing commit/projection boundary).
    const section = createElement("section", { id: "sec" });
    const heading = createElement("heading", { id: "h" });
    let tree = treeWith(section);
    const r1 = insertElement(tree, "sec", heading);
    if (!r1.ok) return;
    tree = r1.value;
    const r2 = updateElementGeometry(tree, "h", { width: 120 });
    if (!r2.ok) return;
    tree = r2.value;
    const r3 = updateElementAnimation(tree, "h", { trigger: "load", type: "fade" });
    if (!r3.ok) return;
    tree = r3.value;

    // Serialization (element path) preserves metadata.
    const roundTrip = JSON.parse(serializeElementTree(tree)) as ElementTree;
    expect(roundTrip.nodes.h.geometry?.width).toBe(120);
    expect(roundTrip.nodes.h.animation?.type).toBe("fade");

    // Collab projection normalizes to the canonical block shape (still valid).
    const projected = normalizeBlockTree(tree);
    expect(projected).not.toBeNull();
    expect(projected?.nodes.h).toBeDefined();
    expect(validateElementTree(projected as ElementTree).valid).toBe(true);
  });

  it("operations never mutate the input tree", () => {
    const root = createElement("section", { id: "sec" });
    const snapshot = JSON.stringify(treeWith(root));
    insertElement(treeWith(root), "sec", createElement("heading"));
    expect(JSON.stringify(treeWith(root))).toBe(snapshot);
  });
});
