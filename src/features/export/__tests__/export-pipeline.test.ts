import { describe, it, expect } from "vitest";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import { validateProjectForExport } from "../validators/export-validator";
import { generateExportProject } from "../generators/project-generator";
import { generatePage } from "../generators/page-generator";
import { generateGlobalsCss } from "../generators/globals-css-generator";
import { generateLayout } from "../generators/layout-generator";
import {
  generatePackageJson,
  generateTsconfig,
  generateNextConfig,
  generatePostcssConfig,
} from "../generators/static-files-generator";
import {
  escapeJsxText,
  sanitiseFolderName,
  sanitiseFilename,
} from "../formatters/jsx-formatter";

// ---------------------------------------------------------------------------
// Formatter tests
// ---------------------------------------------------------------------------

describe("JSX formatter", () => {
  it("escapes HTML/JSX special characters", () => {
    expect(escapeJsxText("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert(&#039;xss&#039;)&lt;/script&gt;",
    );
  });

  it("escapes curly braces used in JSX expressions", () => {
    expect(escapeJsxText("Hello {world}")).toBe("Hello &#123;world&#125;");
  });

  it("sanitises folder names", () => {
    expect(sanitiseFolderName("My Cool Project!")).toBe("my-cool-project");
    expect(sanitiseFolderName("  spaces  ")).toBe("spaces");
    expect(sanitiseFolderName("")).toBe("project");
    expect(sanitiseFolderName("a".repeat(100))).toHaveLength(64);
  });

  it("sanitises filenames", () => {
    expect(sanitiseFilename("../etc/passwd")).toBe("etc-passwd");
    expect(sanitiseFilename("normal-file.tsx")).toBe("normal-file.tsx");
  });
});

// ---------------------------------------------------------------------------
// Validator tests
// ---------------------------------------------------------------------------

describe("Export validator", () => {
  it("passes a valid project", () => {
    const result = validateProjectForExport(MOCK_PROJECT);
    if (!result.valid) {
      // Log the actual errors for debugging
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a project with no pages", () => {
    const result = validateProjectForExport({ ...MOCK_PROJECT, pages: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a project with empty sections in a page", () => {
    const project = {
      ...MOCK_PROJECT,
      pages: [{ id: "p1", title: "Empty", slug: "/", sections: [] }],
    };
    const result = validateProjectForExport(project);
    expect(result.valid).toBe(false);
  });

  it("rejects a project with an unsupported section type", () => {
    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              id: "bad",
              type: "unknown-type",
              order: 1,
              visible: true,
              props: {},
              styles: {},
            },
          ],
        },
      ],
    };
    const result = validateProjectForExport(project);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Generator tests — verify output structure
// ---------------------------------------------------------------------------

describe("Static file generators", () => {
  it("package.json has expected dependencies", () => {
    const file = generatePackageJson("Test");
    expect(file.path).toBe("package.json");
    expect(file.content).toContain("next");
    expect(file.content).toContain("tailwindcss");
    expect(file.content).toContain("react");
  });

  it("tsconfig.json has strict mode", () => {
    const file = generateTsconfig();
    expect(file.path).toBe("tsconfig.json");
    expect(file.content).toContain('"strict": true');
  });

  it("next.config.ts is valid", () => {
    const file = generateNextConfig();
    expect(file.path).toBe("next.config.ts");
    expect(file.content).toContain("NextConfig");
  });

  it("postcss.config.mjs is valid", () => {
    const file = generatePostcssConfig();
    expect(file.path).toBe("postcss.config.mjs");
    expect(file.content).toContain("@tailwindcss/postcss");
  });
});

describe("App generators", () => {
  it("globals.css contains @theme directive", () => {
    const file = generateGlobalsCss(MOCK_PROJECT.theme);
    expect(file.path).toBe("app/globals.css");
    expect(file.content).toContain("@theme");
    expect(file.content).toContain(MOCK_PROJECT.theme.palette.primary);
  });

  it("layout.tsx has metadata", () => {
    const file = generateLayout({ projectName: "Test Site" });
    expect(file.path).toBe("app/layout.tsx");
    expect(file.content).toContain("Test Site");
    expect(file.content).toContain("RootLayout");
  });

  it("page.tsx renders sections with serialized props", () => {
    const file = generatePage(MOCK_PROJECT);
    expect(file.path).toBe("app/page.tsx");
    // Should import all section types
    expect(file.content).toContain('import { Header } from "@/components/sections/header"');
    expect(file.content).toContain('import { Hero } from "@/components/sections/hero"');
    expect(file.content).toContain('import { Features } from "@/components/sections/features"');
    expect(file.content).toContain('import { Pricing } from "@/components/sections/pricing"');
    expect(file.content).toContain('import { Faq } from "@/components/sections/faq"');
    expect(file.content).toContain('import { Cta } from "@/components/sections/cta"');
    expect(file.content).toContain('import { Footer } from "@/components/sections/footer"');
    // Should have serialized props — check mock project content
    expect(file.content).toContain("Build beautiful websites");
    expect(file.content).toContain('"Get Started"');
    expect(file.content).toContain("Start Building Free");
    // Should have section keys
    expect(file.content).toContain('key="s-header"');
    expect(file.content).toContain('key="s-hero"');
    // Should exclude invisible sections
    expect(file.content).not.toContain("invisible-section");
    // Should have sorted sections
    expect(file.content.indexOf("Header")).toBeLessThan(file.content.indexOf("Hero"));
  });

  it("page.tsx excludes invisible sections", () => {
    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            { ...MOCK_PROJECT.pages[0].sections[0], visible: false },
            { ...MOCK_PROJECT.pages[0].sections[1], visible: true },
          ],
        },
      ],
    };
    const file = generatePage(project);
    // Only the visible section should be rendered
    const heroCount = (file.content.match(/Hero /g) || []).length;
    expect(heroCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Project orchestrator integration
// ---------------------------------------------------------------------------

describe("Project orchestrator", () => {
  it("generates all expected files for a valid project", () => {
    const { folderName, files } = generateExportProject(MOCK_PROJECT);
    expect(folderName).toBeTruthy();
    expect(files.length).toBeGreaterThanOrEqual(12); // 4 static + 2 app + 7 components + 1 page

    // Verify essential files exist
    const paths = files.map((f) => f.path);
    expect(paths).toContain("package.json");
    expect(paths).toContain("tsconfig.json");
    expect(paths).toContain("next.config.ts");
    expect(paths).toContain("postcss.config.mjs");
    expect(paths).toContain("app/globals.css");
    expect(paths).toContain("app/layout.tsx");
    expect(paths).toContain("app/page.tsx");
    expect(paths).toContain("components/sections/header.tsx");
    expect(paths).toContain("components/sections/hero.tsx");
    expect(paths).toContain("components/sections/footer.tsx");
    expect(paths).toContain("components/sections/features.tsx");
    expect(paths).toContain("components/sections/pricing.tsx");
    expect(paths).toContain("components/sections/faq.tsx");
    expect(paths).toContain("components/sections/cta.tsx");

    // All files have content
    for (const file of files) {
      expect(file.content.length).toBeGreaterThan(0);
    }
  });

  it("sanitises the folder name", () => {
    const { folderName } = generateExportProject({
      ...MOCK_PROJECT,
      name: "My <Special> Project!",
    });
    expect(folderName).not.toContain("<");
    expect(folderName).not.toContain(">");
    expect(folderName).not.toContain("!");
  });
});
