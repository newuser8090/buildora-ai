// ---------------------------------------------------------------------------
// Element model tests (Phase P22-A)
// Covers: ElementNode creation, default values, nested children, parent/child
// integrity, and existing BlockNode compatibility.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { createBlock, insertBlock as insertBlockBlock } from "@/features/blocks/engine/block-operations";
import type { BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import {
  createElement,
  createElementId,
  insertElement,
  updateElementGeometry,
} from "../engine/element-operations";
import { serializeElementTree } from "../serialization/element-serializer";
import { validateElementTree } from "../engine/element-validation";
import { registerDefaultElements } from "../registry/register-default-elements";
import { elementRegistry } from "../registry/element-registry";
import { materializeSectionElement } from "../adapters/section-element-adapter";
import type { BaseSection } from "@/types/section";
import type { ElementNode, ElementTree, SectionElement } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

function treeWith(root: ElementNode): ElementTree {
  return { rootIds: [root.id], nodes: { [root.id]: root } };
}

describe("createElement", () => {
  it("applies registry defaults for block-backed types", () => {
    const heading = createElement("heading");
    expect(heading.type).toBe("heading");
    expect(heading.props.text).toBe("Your heading");
    expect(heading.props.level).toBe(2);
    expect(heading.parentId).toBeNull();
    expect(heading.children).toEqual([]);
    expect(heading.visible).toBe(true);
    expect(heading.locked).toBe(false);
    expect(heading.hidden).toBe(false);
    expect(heading.geometry).toBeUndefined();
  });

  it("applies registry defaults for element-only types", () => {
    const text = createElement("text");
    expect(text.type).toBe("text");
    expect(text.props.text).toBe("Add your text here");
    expect(text.props.format).toBe("paragraph");
    const section = createElement("section");
    expect(section.type).toBe("section");
    expect(elementRegistry.get("section")?.canHaveChildren).toBe(true);
  });

  it("returns fresh references per call (never shared defaults)", () => {
    const a = createElement("button");
    const b = createElement("button");
    a.props.text = "changed";
    expect(b.props.text).toBe("Get Started");
    a.style.padding = "0";
    expect(b.style.padding).toBe("0.75rem 1.5rem");
  });

  it("merges explicit options over defaults", () => {
    const node = createElement("heading", {
      id: "custom-id",
      props: { text: "Hello" },
      style: { color: "red" },
    });
    expect(node.id).toBe("custom-id");
    expect(node.props.text).toBe("Hello");
    expect(node.props.level).toBe(2); // default preserved
    expect(node.style.color).toBe("red");
  });

  it("createElementId produces unique ids", () => {
    const ids = new Set([
      createElementId("heading"),
      createElementId("heading"),
      createElementId("section"),
    ]);
    expect(ids.size).toBe(3);
  });

  it("default props always satisfy the registry's typed props schema", () => {
    // Invariant: createElement() must never produce an element whose own
    // defaults fail validation (otherwise insert/update would reject it).
    for (const definition of elementRegistry.list()) {
      const node = createElement(definition.type);
      const validation = elementRegistry.get(definition.type)?.validateProps?.(node.props);
      if (validation) {
        expect(validation.ok, `${definition.type} defaults must validate`).toBe(true);
      }
    }
  });
});

describe("nested children + integrity", () => {
  it("inserts children under a section root with parentId back-references", () => {
    const section = createElement("section");
    const heading = createElement("heading", { id: "h1" });
    const text = createElement("text", { id: "t1" });
    const t1 = insertElement(treeWith(section), section.id, heading);
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    const t2 = insertElement(t1.value, section.id, text);
    expect(t2.ok).toBe(true);
    if (!t2.ok) return;

    expect(t2.value.nodes[section.id].children).toEqual(["h1", "t1"]);
    expect(t2.value.nodes.h1.parentId).toBe(section.id);
    expect(validateElementTree(t2.value).valid).toBe(true);
  });

  it("validateElementTree reports broken parent/child references", () => {
    const broken: ElementTree = {
      rootIds: ["a"],
      nodes: {
        a: { id: "a", type: "container", parentId: null, children: ["b"], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
        b: { id: "b", type: "heading", parentId: "MISSING", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
      },
    };
    const result = validateElementTree(broken);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("does not point back"))).toBe(true);
  });

  it("validateElementTree reports cycles", () => {
    const cyclic: ElementTree = {
      rootIds: ["a"],
      nodes: {
        a: { id: "a", type: "container", parentId: null, children: ["b"], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
        b: { id: "b", type: "container", parentId: "a", children: ["a"], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
      },
    };
    const result = validateElementTree(cyclic);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.toLowerCase().includes("cycle"))).toBe(true);
  });

  it("validateElementTree reports unknown element types", () => {
    const unknown = {
      rootIds: ["a"],
      nodes: {
        a: { id: "a", type: "definitely-not-a-type", parentId: null, children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
      },
    } as unknown as ElementTree;
    const result = validateElementTree(unknown);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("unknown type"))).toBe(true);
  });
});

describe("BlockNode compatibility", () => {
  it("a block-created node is structurally a valid element node", () => {
    const block = createBlock("heading", { id: "bh" });
    const node = block as unknown as ElementNode;
    expect(node.type).toBe("heading");
    expect(node.geometry).toBeUndefined(); // optional field — absent is fine
    // The block tree passes element validation.
    expect(validateElementTree(treeWith(node)).valid).toBe(true);
  });

  it("element ops accept legacy block trees", () => {
    const root = createBlock("container", { id: "root" });
    const heading = createBlock("heading", { id: "h" });
    const t1 = insertBlockBlock(
      treeWith(root as unknown as ElementNode) as unknown as BlockTree,
      root.id,
      heading,
    );
    expect(t1.ok).toBe(true);
    if (!t1.ok) return;
    const tree = t1.value as unknown as ElementTree;

    // Metadata ops work on block-created nodes without changing structure.
    const result = updateElementGeometry(tree, "h", { width: 320, height: 80 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h.geometry).toEqual({ mode: "flow", width: 320, height: 80 });
    expect(validateElementTree(result.value).valid).toBe(true);
  });

  it("existing BlockNode data serializes as an element tree", () => {
    const root = createBlock("container", { id: "root" });
    const json = serializeElementTree(treeWith(root as unknown as ElementNode));
    expect(typeof json).toBe("string");
    expect(JSON.parse(json).nodes.root.id).toBe("root");
  });
});

describe("SectionElement (future durable shape)", () => {
  it("materializeSectionElement is additive and preserves props/styles", () => {
    const section: BaseSection = {
      id: "s1",
      type: "hero",
      order: 1,
      visible: true,
      props: { headline: "Hello" },
      styles: { padding: "2rem" },
    };
    const tree = createElement("section") as unknown as ElementTree;
    const materialized: SectionElement = materializeSectionElement(section, tree);
    expect(materialized.id).toBe("s1");
    expect(materialized.type).toBe("hero");
    expect(materialized.props.headline).toBe("Hello");
    expect(materialized.styles.padding).toBe("2rem");
    expect(materialized.tree).toBe(tree);
    // BaseSection compatibility: the materialized shape still has all section fields.
    expect(materialized.order).toBe(1);
    expect(materialized.visible).toBe(true);
  });
});
