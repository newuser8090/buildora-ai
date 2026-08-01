import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import {
  findAssetReferences,
  getAssetUsageCount,
  getAssetUsageSummary,
  collectReferencedAssetIds,
} from "../services/reference-analyzer";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "test-proj",
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
        id: "page-1", title: "Home", slug: "/",
        sections: [
          {
            id: "s-header", type: "header", order: 1, visible: true,
            props: {
              logoText: "Brand",
              logoImage: { assetId: "asset-logo", altText: "Logo" },
              navLinks: [],
            },
            styles: {},
          },
          {
            id: "s-hero", type: "hero", order: 2, visible: true,
            props: {
              headline: "Welcome",
              subheadline: "",
              primaryCta: { text: "Start", href: "#" },
              heroImage: { assetId: "asset-hero", altText: "Hero" },
              backgroundImage: { assetId: "asset-bg", altText: "BG" },
            },
            styles: {},
          },
          {
            id: "s-features", type: "features", order: 3, visible: true,
            props: {
              title: "Features",
              features: [
                { title: "F1", description: "D1", icon: "Zap", iconImage: { assetId: "asset-icon-1" } },
                { title: "F2", description: "D2", icon: "Star", iconImage: { assetId: "asset-icon-2" } },
              ],
            },
            styles: {},
          },
          {
            id: "s-cta", type: "cta", order: 4, visible: true,
            props: {
              headline: "CTA", ctaText: "Go", ctaHref: "#",
              backgroundImage: { assetId: "asset-bg" },
            },
            styles: {},
          },
          {
            id: "s-footer", type: "footer", order: 5, visible: false,
            props: {
              text: "©",
              links: [],
              logoImage: { assetId: "asset-logo" },
            },
            styles: {},
          },
          {
            id: "s-pricing", type: "pricing", order: 6, visible: true,
            props: {
              title: "Pricing",
              plans: [{ name: "Free", price: "$0", cta: "Get", description: "", features: [] }],
            },
            styles: {},
          },
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

describe("Reference analyzer — no references", () => {
  it("returns empty array for asset with no references", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-nonexistent");
    expect(refs).toEqual([]);
  });

  it("returns 0 count for asset with no references", () => {
    const project = makeProject();
    expect(getAssetUsageCount(project, "asset-nonexistent")).toBe(0);
  });
});

describe("Reference analyzer — single references", () => {
  it("finds Header logoImage reference (also found in Footer)", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-logo");
    // asset-logo is used in header (logoImage) AND footer (logoImage) → 2 total
    expect(refs.length).toBe(2);

    const headerRefs = refs.filter((r) => r.sectionId === "s-header");
    expect(headerRefs).toHaveLength(1);
    expect(headerRefs[0].sectionType).toBe("header");
    expect(headerRefs[0].field).toBe("logoImage");
  });

  it("finds Hero heroImage reference", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-hero");
    expect(refs).toHaveLength(1);
    expect(refs[0].sectionType).toBe("hero");
    expect(refs[0].field).toBe("heroImage");
  });

  it("finds Hero backgroundImage reference", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-bg");
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it("finds CTA backgroundImage reference", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-bg").filter(
      (r) => r.field === "backgroundImage",
    );
    // Used in both Hero and CTA
    const ctaRefs = refs.filter((r) => r.sectionType === "cta");
    expect(ctaRefs).toHaveLength(1);
  });

  it("finds Footer logoImage reference", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-logo");
    const footerRefs = refs.filter((r) => r.sectionType === "footer");
    expect(footerRefs).toHaveLength(1);
    expect(footerRefs[0].field).toBe("logoImage");
  });
});

describe("Reference analyzer — feature item references", () => {
  it("finds Feature item iconImage references", () => {
    const project = makeProject();
    const refsIcon1 = findAssetReferences(project, "asset-icon-1");
    expect(refsIcon1).toHaveLength(1);
    expect(refsIcon1[0].sectionType).toBe("features");
    expect(refsIcon1[0].itemIndex).toBe(0);
    expect(refsIcon1[0].field).toContain("features[0]");

    const refsIcon2 = findAssetReferences(project, "asset-icon-2");
    expect(refsIcon2).toHaveLength(1);
    expect(refsIcon2[0].itemIndex).toBe(1);
  });
});

describe("Reference analyzer — multiple references", () => {
  it("finds multiple references for the same asset", () => {
    const project = makeProject();
    // asset-logo is used in header AND footer
    const refs = findAssetReferences(project, "asset-logo");
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  it("count is correct for duplicated asset usage", () => {
    const project = makeProject();
    const count = getAssetUsageCount(project, "asset-bg");
    // Used in Hero background and CTA background
    expect(count).toBe(2);
  });

  it("getAssetUsageSummary groups by section type and field", () => {
    const project = makeProject();
    const summary = getAssetUsageSummary(project, "asset-bg");
    expect(summary.length).toBeGreaterThanOrEqual(1);

    // Group with sectionType=hero and field=backgroundImage
    const heroBg = summary.find((s) => s.sectionType === "hero");
    expect(heroBg).toBeDefined();
    expect(heroBg!.count).toBe(1);

    // Group with sectionType=cta and field=backgroundImage
    const ctaBg = summary.find((s) => s.sectionType === "cta");
    expect(ctaBg).toBeDefined();
    expect(ctaBg!.count).toBe(1);
  });
});

describe("Reference analyzer — invisible sections", () => {
  it("includes invisible sections by default", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-logo");
    const footerRefs = refs.filter((r) => r.sectionType === "footer");
    expect(footerRefs.length).toBe(1); // footer is invisible but still found
  });

  it("excludes invisible sections when visibleOnly=true", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "asset-logo", { visibleOnly: true });
    const footerRefs = refs.filter((r) => r.sectionType === "footer");
    expect(footerRefs.length).toBe(0); // footer is invisible
  });
});

describe("Reference analyzer — collectReferencedAssetIds", () => {
  it("collects all unique asset IDs from all sections", () => {
    const project = makeProject();
    const ids = collectReferencedAssetIds(project);
    expect(ids.has("asset-logo")).toBe(true);
    expect(ids.has("asset-hero")).toBe(true);
    expect(ids.has("asset-bg")).toBe(true);
    expect(ids.has("asset-icon-1")).toBe(true);
    expect(ids.has("asset-icon-2")).toBe(true);
    expect(ids.size).toBe(5);
  });

  it("excludes invisible sections when visibleOnly=true (same asset used elsewhere is still included)", () => {
    const project = makeProject();
    const ids = collectReferencedAssetIds(project, { visibleOnly: true });
    // All 5 unique assets are used in at least one visible section:
    //   asset-logo: header (visible) + footer (invisible) → collected via header
    //   asset-hero: hero (visible) → collected
    //   asset-bg: hero (visible) + cta (visible) → collected
    //   asset-icon-1: features[0] (visible) → collected
    //   asset-icon-2: features[1] (visible) → collected
    // Result: all 5 assets are still collected because each has at least one
    // visible usage. The only invisible section is footer, but logo appears in header too.
    expect(ids.size).toBe(5);
    expect(ids.has("asset-logo")).toBe(true);
    expect(ids.has("asset-hero")).toBe(true);
    expect(ids.has("asset-bg")).toBe(true);
    expect(ids.has("asset-icon-1")).toBe(true);
    expect(ids.has("asset-icon-2")).toBe(true);
  });

  it("does not treat unrelated string values as asset references", () => {
    const project = makeProject();
    // Pricing section has no asset references - it shouldn't match any string
    const ids = collectReferencedAssetIds(project);
    // No asset IDs from pricing (it has no AssetRef fields)
    expect(ids.has("Get Started")).toBe(false);
    expect(ids.has("$0")).toBe(false);
  });
});

describe("Reference analyzer — edge cases", () => {
  it("handles missing pages gracefully", () => {
    const project = makeProject({ pages: [] });
    expect(findAssetReferences(project, "asset-logo")).toEqual([]);
    expect(collectReferencedAssetIds(project).size).toBe(0);
  });

  it("handles empty section arrays gracefully", () => {
    const project = makeProject();
    project.pages[0].sections = [];
    expect(findAssetReferences(project, "asset-logo")).toEqual([]);
  });

  it("handles pages with undefined sections", () => {
    const project = makeProject();
    (project.pages[0] as unknown as Record<string, unknown>).sections = undefined;
    expect(findAssetReferences(project, "asset-logo")).toEqual([]);
  });

  it("ignores section types without asset field mappings", () => {
    const project = makeProject();
    const refs = findAssetReferences(project, "nonexistent");
    expect(refs).toEqual([]);
  });
});
