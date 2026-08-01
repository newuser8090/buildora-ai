import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import type { AssetRef } from "@/features/assets/types";
import { clearAssetReferences } from "../services/reference-cleanup";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeProject(): Project {
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
              headline: "Welcome", subheadline: "",
              primaryCta: { text: "Start", href: "#" },
              heroImage: { assetId: "asset-hero" },
              backgroundImage: { assetId: "asset-bg" },
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
                { title: "F3", description: "D3", icon: "Star" },
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
            id: "s-footer", type: "footer", order: 5, visible: true,
            props: {
              text: "©", links: [],
              logoImage: { assetId: "asset-logo" },
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Reference cleanup — clearAssetReferences", () => {
  it("does not mutate the original project", () => {
    const project = makeProject();
    const originalLogoRef = (project.pages[0].sections[0].props.logoImage as AssetRef).assetId;

    clearAssetReferences(project, "asset-logo");

    // Original should be unchanged
    expect((project.pages[0].sections[0].props.logoImage as AssetRef).assetId).toBe(originalLogoRef);
  });

  it("clears a direct AssetRef field", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-logo");

    // Header logoImage should be removed
    expect(updated.pages[0].sections[0].props.logoImage).toBeUndefined();
    // Footer logoImage should be removed
    expect(updated.pages[0].sections[4].props.logoImage).toBeUndefined();
  });

  it("clears nested feature item references", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-icon-1");

    const features = updated.pages[0].sections[2].props.features as Array<Record<string, unknown>>;
    expect(features[0].iconImage).toBeUndefined();
    // Other items should be preserved
    expect(features[1].iconImage).toBeDefined();
    expect((features[1].iconImage as AssetRef).assetId).toBe("asset-icon-2");
  });

  it("clears all references to the same asset across sections", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-bg");

    // Hero backgroundImage
    expect(updated.pages[0].sections[1].props.backgroundImage).toBeUndefined();
    // CTA backgroundImage
    expect(updated.pages[0].sections[3].props.backgroundImage).toBeUndefined();
  });

  it("preserves unrelated section props", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-logo");

    // Header logoText should be preserved
    expect(updated.pages[0].sections[0].props.logoText).toBe("Brand");
    // Hero headline should be preserved
    expect(updated.pages[0].sections[1].props.headline).toBe("Welcome");
    // CTA ctaText should be preserved
    expect(updated.pages[0].sections[3].props.ctaText).toBe("Go");
  });

  it("preserves non-matching AssetRef fields", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-logo");

    // Hero heroImage should be preserved (not asset-logo)
    expect(updated.pages[0].sections[1].props.heroImage).toBeDefined();
    expect((updated.pages[0].sections[1].props.heroImage as AssetRef).assetId).toBe("asset-hero");
  });

  it("preserves feature items without iconImage", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-icon-1");

    const features = updated.pages[0].sections[2].props.features as Array<Record<string, unknown>>;
    // F3 had no iconImage field initially
    expect(features[2].iconImage).toBeUndefined();
    // F2 should still have its iconImage
    expect(features[1].iconImage).toBeDefined();
  });

  it("handles sections without matching field mappings gracefully", () => {
    const project = makeProject();
    // Add a pricing section (no asset field mappings)
    project.pages[0].sections.push({
      id: "s-pricing", type: "pricing", order: 6, visible: true,
      props: { title: "Pricing", plans: [] },
      styles: {},
    });

    const updated = clearAssetReferences(project, "asset-logo");
    // Should not throw, pricing props unchanged
    expect(updated.pages[0].sections[5].props.title).toBe("Pricing");
  });

  it("clears nothing when asset has no references", () => {
    const project = makeProject();
    const updated = clearAssetReferences(project, "asset-nonexistent");

    // All sections unchanged
    expect(updated.pages[0].sections[0].props.logoImage).toBeDefined();
    expect(updated.pages[0].sections[1].props.heroImage).toBeDefined();
    expect(updated.pages[0].sections[2].props.features).toBeDefined();
  });

  it("handles empty pages gracefully", () => {
    const project = makeProject();
    project.pages = [];
    const updated = clearAssetReferences(project, "asset-logo");
    expect(updated.pages).toEqual([]);
  });
});
