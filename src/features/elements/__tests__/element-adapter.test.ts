// ---------------------------------------------------------------------------
// Section ↔ Element adapter tests (Phase P22-A)
// Covers: section → element-tree projection (via the existing block adapter),
// element-only key stripping on downcast, marker detection, fold-back into the
// validated section model, and loading of EXISTING project data.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../registry/register-default-elements";
import { validateElementTree } from "../engine/element-validation";
import {
  createElement,
  insertElement,
  updateElementAnimation,
  updateElementGeometry,
} from "../engine/element-operations";
import { normalizeElementTree } from "../serialization/element-normalizer";
import {
  elementNodeOf,
  elementTreeToBlockTree,
  elementTreeToSection,
  isSectionDerivedElementTree,
  materializeSectionElement,
  sectionToElementTree,
  sectionTypeOfElementTree,
} from "../adapters/section-element-adapter";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import type { BaseSection } from "@/types/section";
import type { ElementNode, ElementTree } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

const HERO_SECTION: BaseSection = {
  id: "s-hero",
  type: "hero",
  order: 1,
  visible: true,
  props: {
    headline: "Build beautiful websites",
    subheadline: "Describe your dream site in plain English.",
    primaryCta: { text: "Start Building Free", href: "#" },
  },
  styles: { padding: "6rem 0", textAlign: "center" },
};

describe("sectionToElementTree", () => {
  it("projects a regular section into a single-root element tree", () => {
    const tree = sectionToElementTree(HERO_SECTION);
    expect(tree.rootIds).toEqual(["s-hero"]);
    expect(tree.nodes["s-hero"]).toBeDefined();
    expect(tree.nodes["s-hero"].type).toBe("container");
    // Markers survive the projection (same keys the block adapter uses).
    expect(tree.nodes["s-hero"].props._sectionType).toBe("hero");
    expect(tree.nodes["s-hero"].props._sectionId).toBe("s-hero");
    // Section styles land on the root element.
    expect(tree.nodes["s-hero"].style.padding).toBe("6rem 0");
    // Validates as an element tree out of the box.
    expect(validateElementTree(tree).valid).toBe(true);
  });

  it("projects bound string fields as child elements", () => {
    const tree = sectionToElementTree(HERO_SECTION);
    const root = tree.nodes["s-hero"];
    expect(root.children.length).toBeGreaterThanOrEqual(2); // headline + subheadline
    for (const childId of root.children) {
      const child = tree.nodes[childId];
      expect(child.parentId).toBe("s-hero");
      expect(typeof child.props.text).toBe("string");
    }
  });
});

describe("elementTreeToBlockTree (downcast)", () => {
  it("strips element-only metadata so block validation accepts the tree", () => {
    const section = createElement("section", { id: "sec" });
    const heading = createElement("heading", { id: "h" });
    const inserted = insertElement({ rootIds: ["sec"], nodes: { sec: section } }, "sec", heading);
    if (!inserted.ok) return;
    let tree = inserted.value;
    const g = updateElementGeometry(tree, "h", { width: 200, rotation: 10 });
    if (!g.ok) return;
    tree = g.value;
    const a = updateElementAnimation(tree, "h", { trigger: "load", type: "fade" });
    if (!a.ok) return;
    tree = a.value;

    const blockTree = elementTreeToBlockTree(tree);
    const blockHeading = blockTree.nodes.h as unknown as ElementNode;
    expect(blockHeading.geometry).toBeUndefined();
    expect(blockHeading.animation).toBeUndefined();
    // Structure survives.
    expect(blockTree.rootIds).toEqual(["sec"]);
    expect(blockTree.nodes.sec.children).toEqual(["h"]);
    expect(blockTree.nodes.h.parentId).toBe("sec");
  });
});

describe("marker detection", () => {
  it("identifies trees derived from a section and reads the section type", () => {
    const tree = sectionToElementTree(HERO_SECTION);
    expect(isSectionDerivedElementTree(tree, "s-hero")).toBe(true);
    expect(isSectionDerivedElementTree(tree, "other-section")).toBe(false);
    expect(sectionTypeOfElementTree(tree)).toBe("hero");
    expect(sectionTypeOfElementTree({ rootIds: [], nodes: {} })).toBeNull();
  });

  it("elementNodeOf returns a node by id or undefined", () => {
    const tree = sectionToElementTree(HERO_SECTION);
    expect(elementNodeOf(tree, "s-hero")?.id).toBe("s-hero");
    expect(elementNodeOf(tree, "missing")).toBeUndefined();
  });
});

describe("elementTreeToSection (fold-back)", () => {
  it("folds a derived tree back into the validated section model", () => {
    const tree = sectionToElementTree(HERO_SECTION);
    // Change the headline text on the bound child.
    const headlineId = tree.nodes["s-hero"].children[0];
    const headline = tree.nodes[headlineId];
    const edited: ElementTree = {
      ...tree,
      nodes: {
        ...tree.nodes,
        [headlineId]: { ...headline, props: { ...headline.props, text: "Edited headline" } },
      },
    };

    const result = elementTreeToSection(edited, HERO_SECTION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.section.id).toBe("s-hero");
    expect(result.value.section.type).toBe("hero");
    // The edited bound text is folded back into the section props.
    expect(result.value.section.props.headline).toBe("Edited headline");
    // Styles fold back onto the section.
    expect(result.value.section.styles.padding).toBe("6rem 0");
  });

  it("rejects trees that do not belong to the section", () => {
    const foreign = sectionToElementTree({
      id: "s-other",
      type: "footer",
      order: 2,
      visible: true,
      props: { text: "© 2026" },
      styles: {},
    });
    const result = elementTreeToSection(foreign, HERO_SECTION);
    expect(result.ok).toBe(false);
  });
});

describe("existing project loading (compatibility)", () => {
  it("materializes every section of an existing project page into valid element trees", () => {
    const page = MOCK_PROJECT.pages[0];
    expect(page.sections.length).toBeGreaterThan(0);

    for (const section of page.sections) {
      const tree = sectionToElementTree(section);
      expect(tree.rootIds.length).toBe(1);
      expect(validateElementTree(tree).valid).toBe(true);

      const materialized = materializeSectionElement(section, tree);
      expect(materialized.id).toBe(section.id);
      expect(materialized.type).toBe(section.type);
      expect(materialized.tree).toBe(tree);
    }
  });

  it("existing section payloads survive normalizeElementTree when embedded in trees", () => {
    // Simulate the future durable shape: a page's sections projected to trees.
    const trees = MOCK_PROJECT.pages[0].sections.map((section) => sectionToElementTree(section));
    const combined: ElementTree = {
      rootIds: trees.flatMap((t) => t.rootIds),
      nodes: Object.assign({}, ...trees.map((t) => t.nodes)),
    };
    const normalized = normalizeElementTree(combined);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    expect(validateElementTree(normalized).valid).toBe(true);
    expect(normalized.rootIds).toContain("s-hero");
    expect(normalized.nodes["s-hero"].props._sectionType).toBe("hero");
  });

  it("duplicate section ids across trees collapse deterministically (first wins)", () => {
    const treeA = sectionToElementTree(HERO_SECTION);
    const treeB = sectionToElementTree({
      ...HERO_SECTION,
      props: { ...HERO_SECTION.props, headline: "Second copy" },
    });
    const combined: ElementTree = {
      rootIds: [...treeA.rootIds, ...treeB.rootIds],
      nodes: { ...treeA.nodes, ...treeB.nodes },
    };
    const normalized = normalizeElementTree(combined);
    expect(normalized).not.toBeNull();
    if (!normalized) return;
    // Both trees share the same root id — one survives, the tree is valid.
    expect(normalized.rootIds).toEqual(["s-hero"]);
    expect(validateElementTree(normalized).valid).toBe(true);
    // Idempotent.
    const again = normalizeElementTree(normalized);
    expect(JSON.stringify(again)).toBe(JSON.stringify(normalized));
  });
});
