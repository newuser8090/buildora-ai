import { describe, expect, it } from "vitest";
import type { Project } from "@/types/project";
import { buildShareProjection } from "../projection/sanitize-share-projection";

function makeProject(): Project {
  return {
    id: "project-1",
    name: "Custom Code Site",
    theme: {} as Project["theme"],
    assets: [],
    pages: [{
      id: "page-1",
      title: "Home",
      slug: "/",
      sections: [{
        id: "custom-section",
        type: "custom-block",
        order: 1,
        visible: true,
        props: {
          name: "Custom",
          tree: {
            rootIds: ["heading-1"],
            nodes: {
              "heading-1": {
                id: "heading-1",
                type: "heading",
                parentId: null,
                children: [],
                props: { text: "Hello" },
                style: {},
                responsive: {},
                visible: true,
                locked: false,
                hidden: false,
                customCode: {
                  enabled: true,
                  html: "<script>window.ran=true</script>",
                  css: ".x{color:red}",
                  js: "window.ran=true",
                },
              },
            },
          },
        },
        styles: {},
      }],
    }],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as Project;
}

describe("P23-E share projection", () => {
  it("strips customCode before the public projection is validated/stored", () => {
    const project = makeProject();
    const result = buildShareProjection(project);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const section = result.projection.pages[0].sections[0];
    const tree = (section.props as { tree: { nodes: Record<string, Record<string, unknown>> } }).tree;
    expect(tree.nodes["heading-1"].customCode).toBeUndefined();
    expect(JSON.stringify(result.projection)).not.toContain("window.ran");

    const originalNode = (project.pages[0].sections[0].props as { tree: { nodes: Record<string, Record<string, unknown>> } }).tree.nodes["heading-1"];
    expect(originalNode.customCode).toBeDefined();
  });
});
