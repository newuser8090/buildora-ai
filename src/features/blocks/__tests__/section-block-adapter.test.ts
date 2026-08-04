// ---------------------------------------------------------------------------
// Section ↔ Block adapter tests (Phase O spec: TESTS → adapters)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { BaseSection } from "@/types/section";
import {
  sectionToBlockTree,
  blockTreeToSection,
  bindingOf,
  isBoundBlock,
  deleteGroupFromProps,
  duplicateGroupInProps,
  buildPageForest,
  extractSectionTree,
  replaceSectionTree,
  propsFingerprint,
  validatePropsChange,
  blockDisplayLabel,
} from "../adapters/section-block-adapter";
import { createBlock, insertBlock } from "../engine/block-operations";
import { allNodes, getNode } from "../engine/tree-traversal";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../registry/block-registry";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

function heroSection(overrides: Partial<BaseSection> = {}): BaseSection {
  return {
    id: "s-hero",
    type: "hero",
    order: 1,
    visible: true,
    props: {
      headline: "Build anything",
      subheadline: "A friendly subheadline.",
      primaryCta: { text: "Get started", href: "/start" },
      secondaryCta: { text: "Learn more", href: "/learn" },
    },
    styles: { paddingTop: "2rem" },
    ...overrides,
  };
}

function featuresSection(): BaseSection {
  return {
    id: "s-features",
    type: "features",
    order: 1,
    visible: true,
    props: {
      title: "What we offer",
      features: [
        { title: "Fast", description: "Very fast.", icon: "Zap" },
        { title: "Safe", description: "Very safe.", icon: "Lock" },
      ],
    },
    styles: {},
  };
}

describe("sectionToBlockTree", () => {
  it("creates a root container bound to the section", () => {
    const tree = sectionToBlockTree(heroSection());
    expect(tree.rootIds).toEqual(["s-hero"]);
    const root = tree.nodes["s-hero"];
    expect(root.type).toBe("container");
    expect(root.props._sectionType).toBe("hero");
    expect(root.props._sectionId).toBe("s-hero");
  });

  it("creates one bound child per safe text field", () => {
    const tree = sectionToBlockTree(heroSection());
    const children = allNodes(tree).filter((n) => n.id !== "s-hero");
    expect(children.length).toBe(4); // headline, subheadline, primary, secondary
    for (const child of children) {
      expect(isBoundBlock(child)).toBe(true);
    }
  });

  it("does not expose hrefs, prices, assets or ids as text props", () => {
    const tree = sectionToBlockTree(heroSection());
    for (const node of allNodes(tree)) {
      const props = JSON.stringify(node.props);
      expect(props).not.toContain('"/start"');
      expect(props).not.toContain('"/learn"');
      expect(props).not.toContain("_sectionProps");
    }
  });

  it("is deterministic across calls (structure, not generated ids)", () => {
    const signature = (tree: ReturnType<typeof sectionToBlockTree>) =>
      JSON.stringify(
        allNodes(tree).map((n) => ({
          type: n.type,
          bind: n.props._bindPath,
          text: n.props.text,
          parent: n.parentId === null ? null : n.type,
        })),
      );
    expect(signature(sectionToBlockTree(heroSection()))).toBe(
      signature(sectionToBlockTree(heroSection())),
    );
  });

  it("handles malformed props safely (missing arrays, wrong types)", () => {
    const weird = heroSection({
      props: { headline: "Only a headline", features: "not-an-array" } as never,
    });
    const tree = sectionToBlockTree(weird);
    expect(tree.nodes["s-hero"]).toBeDefined();
    // No crash; binding for missing subheadline is skipped.
  });
});

describe("blockTreeToSection", () => {
  it("round-trips unchanged values as a no-op", () => {
    const section = heroSection();
    const tree = sectionToBlockTree(section);
    const result = blockTreeToSection(tree, section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appliedFields).toBe(0);
  });

  it("folds a bound text edit back into section props", () => {
    const section = heroSection();
    const tree = sectionToBlockTree(section);
    const headlineNode = allNodes(tree).find((n) => n.props._bindLabel === "Main headline")!;
    // Direct edit: apply the value change through the tree structure.
    const node = getNode(tree, headlineNode.id)!;
    const edited = {
      ...tree,
      nodes: {
        ...tree.nodes,
        [headlineNode.id]: {
          ...node,
          props: { ...node.props, text: "Edited headline" },
        },
      },
    };
    const result = blockTreeToSection(edited, section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.appliedFields).toBe(1);
    expect(result.value.section.props.headline).toBe("Edited headline");
    // Unrelated props and links preserved.
    expect(result.value.section.props.subheadline).toBe("A friendly subheadline.");
    expect((result.value.section.props.primaryCta as { href: string }).href).toBe("/start");
  });

  it("ignores unbound blocks with a warning", () => {
    const section = heroSection();
    const tree = sectionToBlockTree(section);
    const badge = createBlock("badge", { id: "badge-1", props: { text: "New" } });
    const withBadge = insertBlock(tree, "s-hero", badge);
    if (!withBadge.ok) return;
    const result = blockTreeToSection(withBadge.value, section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.length).toBeGreaterThan(0);
    expect(result.value.section.props.headline).toBe("Build anything");
  });

  it("rejects a tree rooted at a different section", () => {
    const section = heroSection();
    const other = heroSection({ id: "s-other" });
    const tree = sectionToBlockTree(other);
    const result = blockTreeToSection(tree, section);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BLOCK_NOT_FOUND");
  });

  it("rejects non-string bound values", () => {
    const section = heroSection();
    const tree = sectionToBlockTree(section);
    const headline = allNodes(tree).find((n) => n.props._bindLabel === "Main headline")!;
    const node = getNode(tree, headline.id)!;
    const edited = {
      ...tree,
      nodes: {
        ...tree.nodes,
        [headline.id]: { ...node, props: { ...node.props, text: 42 } },
      },
    };
    const result = blockTreeToSection(edited, section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.length).toBeGreaterThan(0);
    expect(result.value.section.props.headline).toBe("Build anything");
  });

  it("caps oversized bound text", () => {
    const section = heroSection();
    const tree = sectionToBlockTree(section);
    const headline = allNodes(tree).find((n) => n.props._bindLabel === "Main headline")!;
    const node = getNode(tree, headline.id)!;
    const edited = {
      ...tree,
      nodes: {
        ...tree.nodes,
        [headline.id]: { ...node, props: { ...node.props, text: "x".repeat(5000) } },
      },
    };
    const result = blockTreeToSection(edited, section);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.length).toBeGreaterThan(0);
    expect(result.value.section.props.headline).toBe("Build anything");
  });

  it("does not mutate the original section", () => {
    const section = heroSection();
    const tree = sectionToBlockTree(section);
    const snapshot = JSON.stringify(section);
    blockTreeToSection(tree, section);
    expect(JSON.stringify(section)).toBe(snapshot);
  });
});

describe("array-group operations", () => {
  it("deletes an array item via deleteGroupFromProps", () => {
    const section = featuresSection();
    const result = deleteGroupFromProps(section.props, ["features", 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const features = result.value.features as Array<{ title: string }>;
    expect(features).toHaveLength(1);
    expect(features[0].title).toBe("Safe");
    const validated = validatePropsChange(section, result.value);
    expect(validated.ok).toBe(true);
  });

  it("duplicates an array item after the original", () => {
    const section = featuresSection();
    const result = duplicateGroupInProps(section.props, ["features", 0]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const features = result.value.features as Array<{ title: string }>;
    expect(features).toHaveLength(3);
    expect(features[1].title).toBe("Fast");
    const validated = validatePropsChange(section, result.value);
    expect(validated.ok).toBe(true);
  });

  it("rejects invalid group paths", () => {
    const section = featuresSection();
    expect(deleteGroupFromProps(section.props, ["features", 99]).ok).toBe(false);
    expect(duplicateGroupInProps(section.props, ["missing", 0]).ok).toBe(false);
  });

  it("validatePropsChange fails on schema-breaking props", () => {
    const section = featuresSection();
    const bad = { ...section.props, features: "not-an-array" };
    const result = validatePropsChange(section, bad);
    expect(result.ok).toBe(false);
  });
});

describe("forest helpers", () => {
  it("buildPageForest creates one root per section", () => {
    const forest = buildPageForest([heroSection(), featuresSection()]);
    expect(forest.rootIds).toEqual(["s-hero", "s-features"]);
    expect(Object.keys(forest.nodes).length).toBeGreaterThan(2);
  });

  it("extractSectionTree pulls out one section subtree", () => {
    const forest = buildPageForest([heroSection(), featuresSection()]);
    const subtree = extractSectionTree(forest, "s-features");
    expect(subtree.rootIds).toEqual(["s-features"]);
    expect(getNode(subtree, "s-hero")).toBeUndefined();
    // All non-root nodes point back to the features root.
    for (const node of allNodes(subtree)) {
      expect(node.id === "s-features" || node.parentId !== null).toBe(true);
    }
  });

  it("replaceSectionTree swaps a section subtree preserving root order", () => {
    const forest = buildPageForest([heroSection(), featuresSection()]);
    const edited = extractSectionTree(forest, "s-hero");
    const root = getNode(edited, "s-hero")!;
    const withBadge = insertBlock(edited, root.id, createBlock("badge", { id: "new-badge" }));
    if (!withBadge.ok) return;
    const next = replaceSectionTree(forest, withBadge.value);
    expect(next.rootIds).toEqual(["s-hero", "s-features"]);
    expect(getNode(next, "new-badge")).toBeDefined();
  });

  it("propsFingerprint changes when props change", () => {
    const a = propsFingerprint(heroSection());
    const b = propsFingerprint(heroSection({ props: { ...heroSection().props, headline: "New" } }));
    expect(a).not.toBe(b);
  });

  it("blockDisplayLabel prefers bind label then name then type", () => {
    expect(blockDisplayLabel(createBlock("heading"))).toBe("heading");
    const bound = createBlock("heading", { props: { _bindLabel: "Main headline", text: "x" } });
    expect(blockDisplayLabel(bound)).toBe("Main headline");
  });

  it("bindingOf reads bind metadata from props", () => {
    const tree = sectionToBlockTree(heroSection());
    const headline = allNodes(tree).find((n) => n.props._bindLabel === "Main headline")!;
    const binding = bindingOf(getNode(tree, headline.id)!);
    expect(binding?.sectionPath).toEqual(["headline"]);
    expect(binding?.valueKey).toBe("text");
  });
});
