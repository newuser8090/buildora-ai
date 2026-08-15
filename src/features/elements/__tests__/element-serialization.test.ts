// ---------------------------------------------------------------------------
// Element serialization / normalization tests (Phase P22-A)
// Covers: serialize/deserialize round-trip, deterministic repair (unknown
// types dropped, cycles broken, orphans pruned, duplicates collapsed, bounds
// clamped), dangerous-key/value sanitization, structured errors, and
// idempotence.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  cloneElementTree,
  deserializeElementTree,
  serializeElementNode,
  serializeElementTree,
} from "../serialization/element-serializer";
import { normalizeElementNode, normalizeElementTree } from "../serialization/element-normalizer";
import { validateElementTree } from "../engine/element-validation";
import { createElement } from "../engine/element-operations";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../registry/register-default-elements";
import type { ElementNode, ElementTree } from "../types";

function validTree(): ElementTree {
  const section = createElement("section", { id: "sec" });
  const heading = createElement("heading", { id: "h", props: { text: "Hello" } });
  const text = createElement("text", { id: "t", props: { text: "Body copy" } });
  return {
    rootIds: ["sec"],
    nodes: {
      [section.id]: { ...section, children: ["h", "t"] },
      [heading.id]: { ...heading, parentId: "sec" },
      [text.id]: { ...text, parentId: "sec" },
    },
  };
}

describe("serializeElementTree / deserializeElementTree", () => {
  it("round-trips a tree without loss", () => {
    const tree = validTree();
    const result = deserializeElementTree(serializeElementTree(tree));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(tree);
    expect(validateElementTree(result.value).valid).toBe(true);
  });

  it("serializes a single node to JSON", () => {
    const node = createElement("button", { id: "b" });
    expect(JSON.parse(serializeElementNode(node)).id).toBe("b");
  });

  it("returns a structured error for invalid JSON", () => {
    const result = deserializeElementTree("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_SERIALIZATION_FAILED");
  });

  it("cloneElementTree deep-clones (no shared references)", () => {
    const tree = validTree();
    const cloned = cloneElementTree(tree);
    expect(cloned).toEqual(tree);
    cloned.nodes.h.props.text = "changed";
    expect(tree.nodes.h.props.text).toBe("Hello");
  });
});

describe("normalizeElementTree repair policy", () => {
  it("drops nodes with unknown element types", () => {
    const tree = validTree();
    tree.nodes.gadget = {
      id: "gadget",
      type: "warp-drive",
      parentId: "sec",
      children: [],
      props: {},
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    } as unknown as ElementNode;
    tree.nodes.sec.children = ["h", "t", "gadget"];

    const normalized = normalizeElementTree(tree);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    expect(normalized.nodes.gadget).toBeUndefined();
    expect(normalized.nodes.sec.children).toEqual(["h", "t"]);
  });

  it("breaks cycles and prunes orphans deterministically", () => {
    const a = createElement("section", { id: "a" });
    const b = createElement("container", { id: "b" });
    const tree: ElementTree = {
      rootIds: ["a"],
      nodes: {
        a: { ...a, children: ["b"] },
        b: { ...b, parentId: "a", children: ["a"] }, // cycle back to a
        orphan: { id: "orphan", type: "heading", parentId: null, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false } as ElementNode,
      },
    };
    const normalized = normalizeElementTree(tree);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    // The orphan is never referenced from a root — it is pruned.
    expect(normalized.nodes.orphan).toBeUndefined();
    // The back-edge (b → a) is dropped so the tree stays acyclic and valid.
    expect(normalized.nodes.b.children).toEqual([]);
    expect(validateElementTree(normalized).valid).toBe(true);
  });

  it("clamps children count and text length (schema-level bounds)", () => {
    const node = createElement("list", { id: "l" });
    const tree: ElementTree = { rootIds: ["l"], nodes: { l: node } };
    const many = Array.from({ length: 100 }, (_, i) => `c${i}`);
    tree.nodes.l.children = many;
    tree.nodes.l.props.text = "x".repeat(5000);

    const normalized = normalizeElementTree(tree);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    expect(normalized.nodes.l.children.length).toBeLessThanOrEqual(32);
    expect((normalized.nodes.l.props.text as string).length).toBeLessThanOrEqual(4000);
  });

  it("drops dangerous keys and unsafe values at any depth", () => {
    const raw = JSON.parse(
      '{"rootIds":["sec"],"nodes":{"sec":{"id":"sec","type":"section","parentId":null,"children":[],"props":{"__proto__":{"polluted":true}},"style":{"background":"expression(alert(1))"},"responsive":{},"visible":true,"locked":false,"hidden":false}}}',
    );
    const normalized = normalizeElementTree(raw);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    expect(Object.keys(normalized.nodes.sec.props)).not.toContain("__proto__");
    expect(normalized.nodes.sec.style.background).toBeUndefined();
  });

  it("repairs dangling parents and duplicate children", () => {
    const tree = validTree();
    tree.nodes.h.parentId = "gone";
    tree.nodes.sec.children = ["h", "h", "t"];

    const normalized = normalizeElementTree(tree);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    // The true parent (the node that actually lists h) wins over the dangling ref.
    expect(normalized.nodes.h.parentId).toBe("sec");
    expect(normalized.nodes.sec.children).toEqual(["h", "t"]);
    expect(validateElementTree(normalized).valid).toBe(true);
  });

  it("scrubs unsafe values from element metadata but keeps the node", () => {
    const tree = validTree();
    tree.nodes.h.animation = { trigger: "load", type: "fade", easing: "javascript:alert(1)" } as never;
    const normalized = normalizeElementTree(tree);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    // The dangerous easing value is dropped; the rest of the node survives.
    expect(normalized.nodes.h.animation?.easing).toBeUndefined();
    expect(normalized.nodes.h.props.text).toBe("Hello");
  });

  it("is idempotent", () => {
    const tree = validTree();
    const once = normalizeElementTree(tree);
    const twice = normalizeElementTree(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("returns null when nothing usable survives", () => {
    expect(normalizeElementTree(null)).toBeNull();
    expect(normalizeElementTree({ rootIds: ["a"], nodes: {} })).toBeNull();
    expect(normalizeElementTree({ rootIds: ["a"], nodes: { a: { type: "nope" } } })).toBeNull();
  });
});

describe("normalizeElementNode", () => {
  it("repairs and validates a single node", () => {
    const raw = {
      id: "n",
      type: "heading",
      parentId: null,
      children: [],
      props: { text: "Hello", unsafe: "javascript:evil()" },
      style: { color: "red" },
    };
    const node = normalizeElementNode(raw);
    expect(node).not.toBeNull();
    if (!node) return;
    expect(node.props.text).toBe("Hello");
    expect(node.props.unsafe).toBeUndefined();
    expect(node.style.color).toBe("red");
    expect(node.visible).toBe(true);
  });

  it("returns null for missing ids / unknown types", () => {
    expect(normalizeElementNode({ type: "heading" })).toBeNull();
    expect(normalizeElementNode({ id: "x", type: "mystery" })).toBeNull();
  });
});

// Ensure registries are ready for the fixtures used above.
beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});
