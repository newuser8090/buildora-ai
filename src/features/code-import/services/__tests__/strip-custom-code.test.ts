import { describe, expect, it } from "vitest";
import type { BlockTree } from "@/features/blocks/types";
import type { StoredCustomBlockNode } from "@/features/code-import/schemas/custom-block-schema";
import type { Project } from "@/types/project";
import { stripCustomCodeFromProject, stripCustomCodeFromTree } from "../strip-custom-code";

function customCode() {
  return { enabled: true, html: "<div>hello</div>", css: ".x{color:red}", js: "console.log('x')" };
}

/**
 * A custom-block tree whose nodes may carry schema-level customCode (P23-C).
 * CustomCodeTree is structurally assignable to BlockTree because
 * StoredCustomBlockNode extends BlockNode, so the fixtures still feed the
 * strip helpers directly while exposing the customCode field for assertions.
 */
type CustomCodeTree = {
  rootIds: string[];
  nodes: Record<string, StoredCustomBlockNode>;
};

function makeTree(): CustomCodeTree {
  const root = "root";
  return {
    rootIds: [root],
    nodes: {
      [root]: {
        id: root,
        type: "heading",
        parentId: null,
        children: [],
        props: { text: "Hello" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        customCode: customCode(),
      },
    },
  };
}

describe("stripCustomCodeFromTree", () => {
  it("removes customCode without mutating the source", () => {
    const tree = makeTree();
    const result = stripCustomCodeFromTree(tree);

    // The sanitized tree is a plain BlockTree by design — customCode is gone —
    // so the optional runtime key is asserted through a narrow cast.
    expect((result.nodes.root as { customCode?: unknown }).customCode).toBeUndefined();
    expect(result.nodes.root.props).toEqual(tree.nodes.root.props);
    expect(tree.nodes.root.customCode).toEqual(customCode());
  });

  it("preserves unrelated node data", () => {
    const result = stripCustomCodeFromTree(makeTree());
    expect(result.rootIds).toEqual(["root"]);
    expect(result.nodes.root.type).toBe("heading");
    expect(result.nodes.root.props.text).toBe("Hello");
  });
});

describe("stripCustomCodeFromProject", () => {
  it("strips customCode only from custom-block sections", () => {
    const tree = makeTree();
    const project = {
      pages: [{
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [{
          id: "section-1",
          type: "custom-block",
          order: 1,
          visible: true,
          props: { name: "Custom", tree },
          styles: {},
        }],
      }],
    } as unknown as Project;

    const result = stripCustomCodeFromProject(project);
    const storedTree = (result.pages[0].sections[0].props as { tree: BlockTree }).tree;

    // Sanitized tree is a plain BlockTree (customCode stripped) — narrow cast
    // reads the optional runtime key. The ORIGINAL project still carries the
    // typed customCode on its custom-block tree, so it is asserted directly.
    expect((storedTree.nodes.root as { customCode?: unknown }).customCode).toBeUndefined();
    expect((project.pages[0].sections[0].props as { tree: CustomCodeTree }).tree.nodes.root.customCode).toEqual(customCode());
  });

  it("does not touch non-custom-block sections", () => {
    const project = {
      pages: [{
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [{
          id: "section-1",
          type: "hero",
          order: 1,
          visible: true,
          props: { customCode: customCode() },
          styles: {},
        }],
      }],
    } as unknown as Project;

    const result = stripCustomCodeFromProject(project);
    expect((result.pages[0].sections[0].props as Record<string, unknown>).customCode).toEqual(customCode());
  });

  it("strips customCode from durable section trees on ANY section type (P24-B)", () => {
    const durableTree = {
      rootIds: ["root"],
      nodes: {
        root: {
          id: "root",
          type: "container",
          parentId: null,
          children: ["b1"],
          props: { _sectionType: "hero", _sectionId: "section-1" },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
          customCode: customCode(),
        },
        b1: {
          id: "b1",
          type: "heading",
          parentId: "root",
          children: [],
          props: { text: "Hello" },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
          customCode: customCode(),
        },
      },
    };
    const project = {
      pages: [{
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [{
          id: "section-1",
          type: "hero",
          order: 1,
          visible: true,
          props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } },
          styles: {},
          tree: durableTree,
        }],
      }],
    } as unknown as Project;

    const result = stripCustomCodeFromProject(project);
    const section = result.pages[0].sections[0] as {
      tree?: { nodes?: Record<string, { customCode?: unknown; props?: unknown }> };
    };
    expect(section.tree).toBeDefined();
    expect(section.tree?.nodes?.root.customCode).toBeUndefined();
    expect(section.tree?.nodes?.b1.customCode).toBeUndefined();
    // The rest of the durable tree survives.
    expect(section.tree?.nodes?.b1.props).toEqual({ text: "Hello" });
    // The original project is untouched.
    const original = (project.pages[0].sections[0] as { tree?: typeof durableTree }).tree;
    expect(original?.nodes.root.customCode).toEqual(customCode());
  });
});
