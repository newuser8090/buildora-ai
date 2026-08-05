// ---------------------------------------------------------------------------
// Phase P3 — custom-block website export
//   - generator emits a native, safe React component
//   - no dangerouslySetInnerHTML / eval / raw imported source
//   - page generator imports CustomBlock and serializes the tree as props
//   - export pipeline includes the custom-block component
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { generateCustomBlockComponent } from "@/features/export/generators/section-generators/custom-block-generator";
import { getSectionGenerator, getSectionGeneratorTypes, generateAllSectionComponents } from "@/features/export/generators/section-generators";
import { generatePageFile } from "@/features/export/generators/page-generator";
import { generateExportProject } from "@/features/export/generators/project-generator";
import { computePageRoutes } from "@/features/routing/routes";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";

function makeTree(): BlockTree {
  return {
    rootIds: ["root"],
    nodes: {
      root: {
        id: "root",
        type: "container",
        parentId: null,
        children: ["head"],
        props: { name: "Pricing" },
        style: { padding: "1rem" },
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
      },
      head: {
        id: "head",
        type: "heading",
        parentId: "root",
        children: [],
        props: { text: "Simple pricing", level: 2 },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
      },
    },
  };
}

function makeProject(): Project {
  return {
    id: "proj-export",
    name: "Export",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s-custom",
            type: CUSTOM_BLOCK_SECTION_TYPE,
            order: 1,
            visible: true,
            props: {
              name: "Pricing",
              tree: makeTree(),
              sourceMetadata: {
                language: "html",
                importedAt: "2026-01-01T00:00:00.000Z",
                sourceHash: "abcd1234",
                converterVersion: 1,
                warningCount: 1,
              },
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("generateCustomBlockComponent", () => {
  it("emits a valid component file at the expected path", () => {
    const file = generateCustomBlockComponent();
    expect(file.path).toBe("components/sections/custom-block.tsx");
    expect(file.content).toContain("export function CustomBlock");
  });

  it("never emits raw HTML, eval, or script execution", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).not.toContain("dangerouslySetInnerHTML");
    expect(file.content).not.toContain("eval(");
    expect(file.content).not.toContain("new Function");
    expect(file.content).not.toContain("<script");
    expect(file.content).not.toContain("innerHTML");
  });

  it("enforces safe URL and CSS policies", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("isSafeLinkUrl");
    expect(file.content).toContain("isSafeImageUrl");
    expect(file.content).toContain("isSafeCssValue");
    expect(file.content).toContain("javascript:");
    expect(file.content).toContain("https://buildora.local");
  });

  it("renders every P2-produced block type without raw code", () => {
    const file = generateCustomBlockComponent();
    for (const type of ["heading", "paragraph", "button", "image", "video", "badge", "pricing-card", "review-card", "navbar", "footer", "menu", "form", "input"]) {
      expect(file.content).toContain(`case "${type}"`);
    }
  });

  it("includes valid React keys for lists", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toMatch(/key=\{child\.id\}/);
    expect(file.content).toMatch(/key=\{index\}/);
  });
});

describe("section generator registry", () => {
  it("registers the custom-block generator", () => {
    expect(getSectionGenerator("custom-block")).toBeDefined();
    expect(getSectionGeneratorTypes()).toContain("custom-block");
  });

  it("generates all registered components including custom-block", () => {
    const files = generateAllSectionComponents();
    expect(files.some((f) => f.path === "components/sections/custom-block.tsx")).toBe(true);
  });
});

describe("page generator integration", () => {
  it("imports CustomBlock and serializes the tree as a prop", () => {
    const project = makeProject();
    const routes = computePageRoutes(project.pages);
    const file = generatePageFile(project, project.pages[0], routes);
    expect(file.content).toContain('import { CustomBlock } from "@/components/sections/custom-block";');
    expect(file.content).toContain("<CustomBlock");
    expect(file.content).toContain('key="s-custom"');
    // The editable tree is serialized as props — never raw source.
    expect(file.content).toContain("tree=");
    expect(file.content).toContain("Simple pricing");
    // No source code strings leaked (the pasted source is never stored).
    expect(file.content).not.toContain("<div class=");
    expect(file.content).not.toContain("onClick=");
  });

  it("excludes invisible custom-block sections", () => {
    const project = makeProject();
    project.pages[0].sections[0].visible = false;
    const routes = computePageRoutes(project.pages);
    const file = generatePageFile(project, project.pages[0], routes);
    expect(file.content).not.toContain("<CustomBlock");
  });
});

describe("export pipeline", () => {
  it("includes the custom-block component in the generated site", () => {
    const { folderName, files } = generateExportProject(makeProject());
    expect(folderName).toBeTruthy();
    const paths = files.map((f) => f.path);
    expect(paths).toContain("components/sections/custom-block.tsx");
    const component = files.find((f) => f.path === "components/sections/custom-block.tsx");
    expect(component?.content).toContain("export function CustomBlock");
    const page = files.find((f) => f.path === "app/page.tsx");
    expect(page?.content).toContain("<CustomBlock");
  });
});
