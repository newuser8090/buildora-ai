import { describe, it, expect } from "vitest";
import { buildExportAssetManifest, generateAssetFiles } from "../generators/asset-export-manifest";
import type { Project } from "@/types/project";
import type { Asset } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: "a1",
    name: "logo.png",
    type: "image",
    mimeType: "image/png",
    extension: ".png",
    size: 1024,
    source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "Brand", navLinks: [] }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Asset export manifest", () => {
  it("returns valid empty manifest for project with no assets", () => {
    const project = makeProject({ assets: [] });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toEqual([]);
    expect(manifest.errors).toEqual([]);
  });

  it("returns valid empty manifest for project with assets but no references", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "unused.png" })],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toEqual([]);
  });

  it("missing Hero content AssetRef with legacy URL is a warning, not an error", () => {
    const project = makeProject({
      assets: [],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "hero", order: 1, visible: true,
              props: {
                headline: "Hey",
                primaryCta: { text: "Go", href: "#" },
                heroImage: { assetId: "missing-asset" },
                image: "https://legacy.example.com/hero.jpg",
              },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    // Should be valid (warning, not blocking error)
    expect(manifest.valid).toBe(true);
    expect(manifest.errors).toEqual([]);
    expect(manifest.warnings.length).toBeGreaterThan(0);
    expect(manifest.warnings[0]).toContain("Falling back to legacy image URL");
  });

  it("missing Header logo AssetRef is still a blocking error", () => {
    const project = makeProject({
      assets: [],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "missing-asset" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    // Header missing asset has no fallback → blocking error
    expect(manifest.valid).toBe(false);
    expect(manifest.errors.length).toBeGreaterThan(0);
    expect(manifest.warnings).toEqual([]);
  });

  it("includes a single referenced PNG asset", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "logo.png" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].assetId).toBe("a1");
    expect(manifest.entries[0].filename).toBe("logo.png");
    expect(manifest.entries[0].publicPath).toBe("/assets/logo.png");
    expect(manifest.byAssetId.get("a1")).toBeDefined();
  });

  it("includes JPEG, WebP, and SVG assets", () => {
    const project = makeProject({
      assets: [
        makeAsset({ id: "a1", name: "hero.jpg", mimeType: "image/jpeg", extension: ".jpg", source: { type: "data-url", value: "data:image/jpeg;base64,/9j/4AAQ" } }),
        makeAsset({ id: "a2", name: "icon.webp", mimeType: "image/webp", extension: ".webp", source: { type: "data-url", value: "data:image/webp;base64,UklGRiQ=" } }),
        makeAsset({ id: "a3", name: "bg.svg", mimeType: "image/svg+xml", extension: ".svg", source: { type: "data-url", value: "data:image/svg+xml;base64,PHN2Zy8+" } }),
      ],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "hero", order: 1, visible: true,
              props: {
                headline: "Hey",
                primaryCta: { text: "Go", href: "#" },
                heroImage: { assetId: "a1" },
                backgroundImage: { assetId: "a3" },
              },
              styles: {},
            },
            {
              id: "s2", type: "features", order: 2, visible: true,
              props: {
                title: "Feat",
                features: [
                  { title: "F1", description: "D1", icon: "Zap", iconImage: { assetId: "a2" } },
                ],
              },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toHaveLength(3);
    expect(manifest.entries.map((e) => e.filename)).toContain("hero.jpg");
    expect(manifest.entries.map((e) => e.filename)).toContain("icon.webp");
    expect(manifest.entries.map((e) => e.filename)).toContain("bg.svg");
  });

  it("deduplicates repeated references to the same asset", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "logo.png" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
            {
              id: "s2", type: "footer", order: 2, visible: true,
              props: { text: "© 2026", logoImage: { assetId: "a1" }, links: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toHaveLength(1);
  });

  it("excludes unused assets", () => {
    const project = makeProject({
      assets: [
        makeAsset({ id: "a1", name: "used.png" }),
        makeAsset({ id: "a2", name: "unused.png" }),
      ],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].assetId).toBe("a1");
  });

  it("reports error for missing referenced asset", () => {
    const project = makeProject({
      assets: [],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "nonexistent" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(false);
    expect(manifest.errors.length).toBeGreaterThan(0);
    expect(manifest.errors[0]).toContain("not found");
  });

  it("reports error for malformed data URL", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "bad.png", source: { type: "data-url", value: "not-a-data-url" } })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(false);
    expect(manifest.errors.length).toBeGreaterThan(0);
    expect(manifest.errors[0]).toContain("invalid data URL");
  });

  it("reports error for empty data URL", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "empty.png", source: { type: "data-url", value: "data:image/png;base64," } })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(false);
    expect(manifest.errors.length).toBeGreaterThan(0);
  });

  it("reports MIME type mismatch", () => {
    const project = makeProject({
      assets: [makeAsset({
        id: "a1", name: "wrong.png", mimeType: "image/png",
        source: { type: "data-url", value: "data:image/jpeg;base64,/9j/4AAQ" },
      })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(false);
    expect(manifest.errors.length).toBeGreaterThan(0);
  });

  it("handles duplicate filenames with collision resolution", () => {
    const project = makeProject({
      assets: [
        makeAsset({ id: "a1", name: "logo.png" }),
        makeAsset({ id: "a2", name: "logo.png" }),
      ],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
            {
              id: "s2", type: "footer", order: 2, visible: true,
              props: { text: "© 2026", logoImage: { assetId: "a2" }, links: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toHaveLength(2);
    // First entry keeps original name, second gets numbered variant
    const filenames = manifest.entries.map((e) => e.filename);
    expect(filenames[0]).toBe("logo.png");
    expect(filenames[1]).toMatch(/logo-\d+\.png/);
  });

  it("handles path traversal filenames", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "../../etc/passwd.png" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].filename).not.toContain("..");
    expect(manifest.entries[0].filename).not.toContain("/");
  });

  it("handles uppercase extensions", () => {
    const project = makeProject({
      assets: [makeAsset({
        id: "a1", name: "Logo.PNG", mimeType: "image/png", extension: ".PNG",
      })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.valid).toBe(true);
    // Filename should have lowercase extension
    expect(manifest.entries[0].filename).toBe("Logo.png");
  });

  it("does not mutate the input project", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "logo.png" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const before = JSON.stringify(project);
    buildExportAssetManifest(project);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("collects only visible section references", () => {
    const project = makeProject({
      assets: [
        makeAsset({ id: "a1", name: "visible.png" }),
        makeAsset({ id: "a2", name: "hidden.png" }),
      ],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Visible", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
            {
              id: "s2", type: "footer", order: 2, visible: false,
              props: { text: "Hidden", logoImage: { assetId: "a2" }, links: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].assetId).toBe("a1");
  });
});

// ---------------------------------------------------------------------------
// Asset file generation tests
// ---------------------------------------------------------------------------

describe("Asset file generation", () => {
  it("generates base64-encoded OutputFile for each manifest entry", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "logo.png" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    const files = generateAssetFiles(manifest);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("public/assets/logo.png");
    expect(files[0].encoding).toBe("base64");
    expect(files[0].content).toBeTruthy();
  });

  it("generates files with correct public/assets/ path prefix", () => {
    const project = makeProject({
      assets: [
        makeAsset({ id: "a1", name: "logo.png" }),
        makeAsset({ id: "a2", name: "hero.jpg", mimeType: "image/jpeg", extension: ".jpg", source: { type: "data-url", value: "data:image/jpeg;base64,/9j/4AAQ" } }),
      ],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
            {
              id: "s2", type: "hero", order: 2, visible: true,
              props: {
                headline: "H", primaryCta: { text: "Go", href: "#" },
                heroImage: { assetId: "a2" },
              },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    const files = generateAssetFiles(manifest);
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file.path).toMatch(/^public\/assets\//);
      expect(file.path).not.toContain("..");
    }
  });

  it("contains no project data URLs in content (base64 only)", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "a1", name: "logo.png" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "header", order: 1, visible: true,
              props: { logoText: "Brand", logoImage: { assetId: "a1" }, navLinks: [] },
              styles: {},
            },
          ],
        },
      ],
    });
    const manifest = buildExportAssetManifest(project);
    const files = generateAssetFiles(manifest);
    for (const file of files) {
      // Content should be pure base64 (no "data:" prefix, no MIME, no comma)
      expect(file.content).not.toMatch(/^data:/);
      expect(file.content).not.toContain("base64,");
    }
  });

  it("returns empty array for empty manifest", () => {
    const files = generateAssetFiles({ entries: [], byAssetId: new Map(), errors: [], warnings: [], valid: true });
    expect(files).toEqual([]);
  });
});
