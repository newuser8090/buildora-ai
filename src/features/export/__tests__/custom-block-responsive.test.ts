// ---------------------------------------------------------------------------
// Export parity — custom-block viewport overrides (Phase P22-F)
//
// The exported site must render the same viewport overrides the canvas shows:
//   1. the generated custom-block component folds viewport.tablet/mobile at
//      the same thresholds as the editor (blockStyle takes node.viewport);
//   2. the page generator serializes the FULL tree (including viewport data)
//      into the emitted JSX props.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { generateCustomBlockComponent } from "../generators/section-generators/custom-block-generator";
import { generatePageFile } from "../generators/page-generator";
import { computePageRoutes } from "@/features/routing/routes";

describe("generateCustomBlockComponent — viewport parity", () => {
  it("emits viewport-aware blockStyle + viewport thresholds", () => {
    const file = generateCustomBlockComponent();
    const code = file.content;
    expect(code).toContain("viewport?: { tablet?: Record<string, unknown>; mobile?: Record<string, unknown> }");
    expect(code).toContain("TABLET_MAX_WIDTH = 1024");
    expect(code).toContain("MOBILE_MAX_WIDTH = 768");
    expect(code).toContain("viewportOverrides");
    // blockStyle must merge the viewport overrides after the min-width tokens.
    expect(code).toContain("viewport: { tablet?: Record<string, unknown>; mobile?: Record<string, unknown> } | undefined");
    expect(code).toContain("Object.assign(merged, viewportOverrides(viewport, width));");
    expect(code).toContain("blockStyle(node.style, node.responsive, node.viewport, width)");
  });
});

describe("generatePageFile — tree data reaches the emitted component", () => {
  it("serializes node viewport overrides into the custom-block props", () => {
    const project: Project = {
      ...MOCK_PROJECT,
      pages: [
        {
          id: "home",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: "cb-1",
              type: "custom-block",
              order: 1,
              visible: true,
              props: {
                name: "Design",
                tree: {
                  rootIds: ["cb-1"],
                  nodes: {
                    "cb-1": {
                      id: "cb-1",
                      type: "container",
                      parentId: null,
                      children: ["g1"],
                      props: {},
                      style: {},
                      responsive: {},
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                    g1: {
                      id: "g1",
                      type: "grid",
                      parentId: "cb-1",
                      children: [],
                      props: { columns: 4 },
                      style: { display: "grid", gap: "1rem" },
                      responsive: {},
                      viewport: { mobile: { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } },
                      visible: true,
                      locked: false,
                      hidden: false,
                    },
                  },
                },
              },
              styles: {},
            },
          ],
        },
      ],
    };
    const routes = computePageRoutes(project.pages);
    const file = generatePageFile(project, project.pages[0], routes);
    expect(file.content).toContain("<CustomBlock key=\"cb-1\"");
    // The tree (with the mobile viewport override) is serialized verbatim.
    expect(file.content).toContain('"gridTemplateColumns":"repeat(1, minmax(0, 1fr))"');
    expect(file.content).toContain('"viewport":');
  });
});
