import { describe, expect, it } from "vitest";
import type { BlockTree } from "@/features/blocks/types";
import type { Project } from "@/types/project";
import { stripCustomCodeFromProject, stripCustomCodeFromTree } from "../strip-custom-code";

function customCode() {
  return { enabled: true, html: "<div>hello</div>", css: ".x{color:red}", js: "console.log('x')" };
}

function makeTree(): BlockTree {
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
      } as BlockTree["nodes"][string],
    },
  };
}

describe("stripCustomCodeFromTree", () => {
  it("removes customCode without mutating the source", () => {
    const tree = makeTree();
    const result = stripCustomCodeFromTree(tree);

    expect(result.nodes.root.customCode).toBeUndefined();
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

    expect(storedTree.nodes.root.customCode).toBeUndefined();
    expect((project.pages[0].sections[0].props as { tree: BlockTree }).tree.nodes.root.customCode).toEqual(customCode());
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
});
