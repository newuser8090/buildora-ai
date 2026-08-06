// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — service layer tests
//
//   - prepareTreeForStorage: deep-clones, strips internal marker props,
//     validates, never mutates the input
//   - preview metadata + category + tags derivation
//   - saveTreeAsMyBlock with duplicate-safe names
//   - saveSectionAsMyBlock from a persistent custom-block section
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  prepareTreeForStorage,
  stripInternalProps,
  cloneTreeDeep,
  computePreviewMetadata,
  deriveCategory,
  deriveTags,
  suggestNameFromTree,
  saveTreeAsMyBlock,
  saveSectionAsMyBlock,
} from "../services/my-blocks-service";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import { InMemoryMyBlocksAdapter, makeNode, makeTree } from "./helpers";

describe("prepareTreeForStorage", () => {
  it("strips internal _-prefixed marker props", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId].props._binding = "section-123";
    tree.nodes[rootId].props._sectionMarker = true;

    const result = prepareTreeForStorage(tree);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const storedRoot = result.value.nodes[rootId];
      expect(storedRoot.props._binding).toBeUndefined();
      expect(storedRoot.props._sectionMarker).toBeUndefined();
      expect(storedRoot.props.name).toBe("Pricing section");
    }
  });

  it("never mutates the input tree", () => {
    const tree = makeTree();
    const before = JSON.stringify(tree);
    const result = prepareTreeForStorage(tree);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("returns a deep-cloned tree (no shared references)", () => {
    const tree = makeTree();
    const result = prepareTreeForStorage(tree);
    if (!result.ok) throw new Error("prepare failed");
    result.value.nodes[tree.rootIds[0]].props.name = "Mutated";
    expect(tree.nodes[tree.rootIds[0]].props.name).toBe("Pricing section");
  });

  it("rejects an empty tree", () => {
    const result = prepareTreeForStorage({ rootIds: [], nodes: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RECORD");
  });

  it("rejects a tree with an unknown block type", () => {
    const tree = makeTree();
    tree.nodes[tree.rootIds[0]] = makeNode(tree.rootIds[0], { type: "mystery" as never });
    const result = prepareTreeForStorage(tree);
    expect(result.ok).toBe(false);
  });
});

describe("stripInternalProps / cloneTreeDeep", () => {
  it("cloneTreeDeep produces an independent copy", () => {
    const tree = makeTree();
    const copy = cloneTreeDeep(tree);
    copy.nodes[tree.rootIds[0]].props.name = "changed";
    expect(tree.nodes[tree.rootIds[0]].props.name).toBe("Pricing section");
    expect(copy.rootIds).toEqual(tree.rootIds);
  });

  it("stripInternalProps only removes _-prefixed props", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId].props._marker = 1;
    tree.nodes[rootId].props.name = "keep";
    const stripped = stripInternalProps(tree);
    expect(stripped.nodes[rootId].props._marker).toBeUndefined();
    expect(stripped.nodes[rootId].props.name).toBe("keep");
  });
});

describe("metadata derivation", () => {
  it("computePreviewMetadata counts nodes and detects media/interactive", () => {
    const tree = makeTree();
    const meta = computePreviewMetadata(tree);
    expect(meta.blockCount).toBe(3);
    expect(meta.containsMedia).toBe(false);
    expect(meta.containsInteractive).toBe(false);

    const rootId = tree.rootIds[0];
    tree.nodes[rootId].children.push("img-1", "form-1");
    tree.nodes["img-1"] = makeNode("img-1", { parentId: rootId, type: "image" });
    tree.nodes["form-1"] = makeNode("form-1", { parentId: rootId, type: "form" });
    const rich = computePreviewMetadata(tree);
    expect(rich.containsMedia).toBe(true);
    expect(rich.containsInteractive).toBe(true);
    expect(rich.rootType).toBe("container");
  });

  it("deriveCategory picks the semantic root kind", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId].type = "navbar";
    expect(deriveCategory(tree)).toBe("navigation");
  });

  it("deriveCategory defers generic container roots to their content", () => {
    // An imported section is always rooted at a generic container — its
    // category must come from the content, not default to "layout".
    const rootId = "root-clean";
    const tree = {
      rootIds: [rootId],
      nodes: {
        [rootId]: makeNode(rootId, { children: ["b1", "b2"] }),
        b1: makeNode("b1", { parentId: rootId, type: "button" }),
        b2: makeNode("b2", { parentId: rootId, type: "button" }),
      },
    };
    expect(deriveCategory(tree)).toBe("buttons");
  });

  it("deriveCategory returns complete-section for large mixed designs", () => {
    const rootId = "root-mixed";
    const types = ["heading", "button", "image", "paragraph", "form", "card"] as const;
    const nodes: Record<string, ReturnType<typeof makeNode>> = {
      [rootId]: makeNode(rootId, { children: [] }),
    };
    types.forEach((type, i) => {
      const id = `mixed-${i}`;
      nodes[id] = makeNode(id, { parentId: rootId, type });
      nodes[rootId].children.push(id);
    });
    expect(deriveCategory({ rootIds: [rootId], nodes })).toBe("complete-section");
  });

  it("deriveTags produces a compact deduped list", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId].children = [];
    ["heading", "button", "image", "image", "pricing-card"].forEach((type, i) => {
      const id = `tag-${i}`;
      tree.nodes[id] = makeNode(id, { parentId: rootId, type: type as never });
      tree.nodes[rootId].children.push(id);
    });
    const tags = deriveTags(tree);
    expect(tags).toContain("heading");
    expect(tags).toContain("button");
    expect(tags).toContain("image");
    expect(tags).toContain("pricing");
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("suggestNameFromTree uses the root name or a fallback", () => {
    expect(suggestNameFromTree(makeTree())).toBe("Pricing section");
    const tree = makeTree();
    delete tree.nodes[tree.rootIds[0]].props.name;
    expect(suggestNameFromTree(tree)).toBe("Saved block");
    expect(suggestNameFromTree({ rootIds: [], nodes: {} })).toBe("Saved block");
  });
});

describe("saveTreeAsMyBlock", () => {
  it("saves a tree with duplicate-safe naming", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });

    const result = await saveTreeAsMyBlock(
      adapter,
      { tree: makeTree(), name: "Hero", category: "complete-section" },
      ["Hero"],
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Hero 2");
      expect(result.value.category).toBe("complete-section");
    }
  });

  it("derives name/category/tags when not provided", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const tree = makeTree(); // root name "Pricing section", content = heading + paragraph
    const result = await saveTreeAsMyBlock(adapter, { tree });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Pricing section");
      // The generic container root defers to its content — both content
      // nodes are text (heading + paragraph), so the derived category is
      // "text", never a default "layout".
      expect(result.value.category).toBe("text");
      expect(result.value.tags.length).toBeGreaterThan(0);
    }
  });

  it("sanitizes over-long names", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const result = await saveTreeAsMyBlock(adapter, {
      tree: makeTree(),
      name: "x".repeat(500),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name.length).toBe(80);
  });

  it("records source metadata when provided", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const result = await saveTreeAsMyBlock(adapter, {
      tree: makeTree(),
      sourceMetadata: { source: "imported", language: "html", originalWarningCount: 2 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceMetadata?.source).toBe("imported");
      expect(result.value.sourceMetadata?.language).toBe("html");
    }
  });

  it("never stores raw pasted source or executable markup", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    // Session/source markers that must be stripped before storage.
    tree.nodes[rootId].props._rawSource = '<section class="pricing"><script>alert(1)</script></section>';
    tree.nodes[rootId].props._executedSource = "alert('x')";
    const result = await saveTreeAsMyBlock(adapter, { tree });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storedJson = JSON.stringify(result.value);
    expect(storedJson).not.toContain("_rawSource");
    expect(storedJson).not.toContain("_executedSource");
    expect(storedJson).not.toContain("<script");
    expect(storedJson).not.toContain('<section class="pricing">');
  });
});

describe("saveSectionAsMyBlock", () => {
  it("saves a custom-block section through the tree adapter", async () => {
    // Build a persistent custom-block section first.
    const section = (() => {
      const tree = makeTree();
      const result = prepareTreeForStorage(tree);
      if (!result.ok) throw new Error("setup failed");
      return {
        id: "sec-imported",
        type: "custom-block" as const,
        order: 1,
        visible: true,
        props: { name: "Imported design", tree: result.value },
        styles: {},
      };
    })();

    const adapter = new InMemoryMyBlocksAdapter();
    const saved = await saveSectionAsMyBlock(adapter, section, {
      name: "My hero",
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.value.name).toBe("My hero");
      expect(saved.value.tree.rootIds.length).toBe(1);
      expect(saved.value.sourceMetadata?.source).toBe("created");
    }

    // The saved tree must be independent of the section's tree.
    if (saved.ok) {
      const fromSection = customBlockTreeFromSection(section);
      saved.value.tree.nodes[fromSection.rootIds[0]].props.name = "edited";
      const fromSection2 = customBlockTreeFromSection(section);
      expect(fromSection2.nodes[fromSection2.rootIds[0]].props.name).not.toBe("edited");
    }
  });

  it("rejects a section with no blocks", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const empty = {
      id: "sec-empty",
      type: "custom-block" as const,
      order: 1,
      visible: true,
      props: { name: "Empty", tree: { rootIds: [], nodes: {} } },
      styles: {},
    };
    const result = await saveSectionAsMyBlock(adapter, empty);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RECORD");
  });
});
