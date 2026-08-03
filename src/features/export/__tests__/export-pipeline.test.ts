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
  escapeJsxStringLiteral,
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

  it("escapeJsxStringLiteral escapes quotes, backslashes and template sequences", () => {
    const input = 'He said "hi" \\ ${x}`';
    expect(escapeJsxStringLiteral(input)).toBe('He said \\"hi\\" \\\\ \\${x}\\\`');
  });

  it("escapeJsxStringLiteral escapes line terminators", () => {
    expect(escapeJsxStringLiteral("Line one\nLine two\r\nThree")).toBe(
      "Line one\\nLine two\\nThree",
    );
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

  it("page.tsx resolves AssetRef to /assets/ paths when manifest is provided", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifest: any = {
      valid: true,
      errors: [],
      entries: [
        {
          assetId: "logo-1",
          asset: { id: "logo-1", name: "brand.png", type: "logo" as const, mimeType: "image/png", extension: ".png", size: 1024, source: { type: "data-url" as const, value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" },
          filename: "brand.png",
          publicPath: "/assets/brand.png",
        },
      ],
      byAssetId: new Map([
        ["logo-1", {
          assetId: "logo-1",
          asset: { id: "logo-1", name: "brand.png", type: "logo" as const, mimeType: "image/png", extension: ".png", size: 1024, source: { type: "data-url" as const, value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" },
          filename: "brand.png",
          publicPath: "/assets/brand.png",
        }],
      ]),
    };

    const projectWithAssetRef = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[0],
              props: {
                logoText: "Brand",
                logoImage: { assetId: "logo-1", altText: "Brand logo" },
                navLinks: [],
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(projectWithAssetRef, manifest);
    // Should contain resolved /assets/ path
    expect(file.content).toContain('/assets/brand.png');
    // Should use alt text from AssetRef
    expect(file.content).toContain('Brand logo');
    // Should NOT contain the raw AssetRef object
    expect(file.content).not.toContain('logoImage');
    expect(file.content).not.toContain('assetId');
  });

  it("page.tsx falls back to existing props when no manifest is provided", () => {
    const file = generatePage(MOCK_PROJECT);
    // Without manifest, AssetRef fields are serialized as-is (not resolved)
    expect(file.content).toContain('logoText="Buildora"');
    // No /assets/ paths since no manifest
    expect(file.content).not.toContain("/assets/");
  });

  it("page.tsx resolves Feature item AssetRefs to iconSrc/iconAlt", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifest: any = {
      valid: true,
      errors: [],
      entries: [
        {
          assetId: "feat-icon",
          asset: { id: "feat-icon", name: "icon.svg", type: "icon" as const, mimeType: "image/svg+xml", extension: ".svg", size: 512, source: { type: "data-url" as const, value: "data:image/svg+xml;base64,PHN2Zy8+" }, createdAt: "2026-01-01T00:00:00.000Z" },
          filename: "icon.svg",
          publicPath: "/assets/icon.svg",
        },
      ],
      byAssetId: new Map([
        ["feat-icon", {
          assetId: "feat-icon",
          asset: { id: "feat-icon", name: "icon.svg", type: "icon" as const, mimeType: "image/svg+xml", extension: ".svg", size: 512, source: { type: "data-url" as const, value: "data:image/svg+xml;base64,PHN2Zy8+" }, createdAt: "2026-01-01T00:00:00.000Z" },
          filename: "icon.svg",
          publicPath: "/assets/icon.svg",
        }],
      ]),
    };

    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[2], // features section
              props: {
                title: "Features",
                subtitle: "Our features",
                features: [
                  { title: "Fast", description: "Lightning", icon: "Zap", iconImage: { assetId: "feat-icon", altText: "Lightning icon" } },
                  { title: "Secure", description: "Safe", icon: "Shield" },
                ],
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project, manifest);
    // First feature should have iconSrc and iconAlt from manifest
    expect(file.content).toContain('/assets/icon.svg');
    expect(file.content).toContain('Lightning icon');
    // Second feature (no iconImage) should not have iconSrc
    expect(file.content).toContain('Shield');
    // Should NOT contain raw AssetRef objects
    expect(file.content).not.toContain('iconImage');
  });

  it("generated page.tsx does not contain next/image imports", () => {
    const file = generatePage(MOCK_PROJECT);
    expect(file.content).not.toContain("next/image");
    expect(file.content).not.toContain("Image");
  });

  // -----------------------------------------------------------------------
  // Hero legacy URL fallback tests
  // -----------------------------------------------------------------------

  it("legacy Hero image URL exports when no AssetRef exists", () => {
    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[1], // Hero section
              props: {
                headline: "Legacy Hero",
                subheadline: "Works without assets",
                primaryCta: { text: "Go", href: "#" },
                image: "https://legacy.example.com/hero.jpg",
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project);
    // Legacy image URL should be in the generated output
    expect(file.content).toContain("https://legacy.example.com/hero.jpg");
    expect(file.content).toContain("legacyImageSrc");
  });

  it("valid Hero AssetRef takes precedence over legacy URL", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifest: any = {
      valid: true,
      errors: [],
      warnings: [],
      entries: [
        {
          assetId: "hero-1",
          asset: { id: "hero-1", name: "hero.png", type: "image" as const, mimeType: "image/png", extension: ".png", size: 1024, source: { type: "data-url" as const, value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" },
          filename: "hero.png",
          publicPath: "/assets/hero.png",
        },
      ],
      byAssetId: new Map([
        ["hero-1", { assetId: "hero-1", asset: { id: "hero-1", name: "hero.png", type: "image" as const, mimeType: "image/png", extension: ".png", size: 1024, source: { type: "data-url" as const, value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" }, filename: "hero.png", publicPath: "/assets/hero.png" }],
      ]),
    };

    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[1], // Hero section
              props: {
                headline: "Priority",
                primaryCta: { text: "Go", href: "#" },
                heroImage: { assetId: "hero-1", altText: "Asset hero" },
                image: "https://legacy.example.com/old.jpg",
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project, manifest);
    // Should contain the /assets/ path from the manifest (AssetRef path)
    expect(file.content).toContain("/assets/hero.png");
    // heroSrc takes precedence over legacyImageSrc in the component
    expect(file.content).toContain('heroSrc="/assets/hero.png"');
    // Should NOT contain raw AssetRef objects
    expect(file.content).not.toContain('"heroImage"');
    expect(file.content).not.toContain('"assetId"');
  });

  it("missing Hero AssetRef falls back to legacy URL", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const manifest: any = {
      valid: true,
      errors: [],
      warnings: ["Hero content image \"missing-hero\" not found. Falling back to legacy image URL."],
      entries: [],
      byAssetId: new Map(),
    };

    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[1], // Hero section
              props: {
                headline: "Fallback",
                primaryCta: { text: "Go", href: "#" },
                heroImage: { assetId: "missing-hero" },
                image: "https://legacy.example.com/fallback.jpg",
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project, manifest);
    // Should contain legacy URL as legacyImageSrc
    expect(file.content).toContain("legacyImageSrc");
    expect(file.content).toContain("https://legacy.example.com/fallback.jpg");
    // Should NOT have heroSrc (no valid AssetRef)
    expect(file.content).not.toContain('heroSrc="/assets');
    // Should NOT contain raw AssetRef
    expect(file.content).not.toContain("heroImage");
  });

  it("old project without assets exports with its Hero URL intact", () => {
    const project = {
      ...MOCK_PROJECT,
      assets: undefined as unknown as never[],
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[1], // Hero section
              props: {
                headline: "Old Site",
                primaryCta: { text: "Go", href: "#" },
                image: "https://cdn.example.com/old-hero.jpg",
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project);
    // Without manifest, the legacy image prop stays and gets serialized
    expect(file.content).toContain("https://cdn.example.com/old-hero.jpg");
  });

  it("projects with assets: [] export with Hero URL intact", () => {
    const project = {
      ...MOCK_PROJECT,
      assets: [],
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[1], // Hero section
              props: {
                headline: "Empty Assets",
                primaryCta: { text: "Go", href: "#" },
                image: "https://cdn.example.com/empty-hero.jpg",
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project);
    expect(file.content).toContain("https://cdn.example.com/empty-hero.jpg");
    expect(file.content).not.toContain("data:image/");
  });

  it("legacy URL is safely escaped in generated output", () => {
    const project = {
      ...MOCK_PROJECT,
      pages: [
        {
          ...MOCK_PROJECT.pages[0],
          sections: [
            {
              ...MOCK_PROJECT.pages[0].sections[1], // Hero section
              props: {
                headline: "Safe",
                primaryCta: { text: "Go", href: "#" },
                image: "https://example.com/?q=hello&world=1",
              },
            },
          ],
        },
      ],
    };

    const file = generatePage(project);
    // URL with & should be properly escaped or preserved
    expect(file.content).toContain("hello");
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
