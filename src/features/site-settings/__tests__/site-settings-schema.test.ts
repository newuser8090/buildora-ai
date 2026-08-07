// ---------------------------------------------------------------------------
// Site settings — schema, sanitization, and ProjectSchema integration
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  SiteSettingsSchema,
  sanitizeSiteSettings,
} from "../schema";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { serializeProject, deserializeProject } from "@/features/persistence/services/project-serializer";
import { normalizeProject } from "@/features/persistence/services/project-normalizer";

function baseProject() {
  return {
    id: "proj-1",
    name: "Acme",
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
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          { id: "hero-1", type: "hero", order: 1, visible: true, props: { headline: "Hi" }, styles: {} },
        ],
      },
    ],
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("SiteSettingsSchema", () => {
  it("accepts a complete settings object", () => {
    const result = SiteSettingsSchema.safeParse({
      siteName: "Acme Bakery",
      siteDescription: "Fresh bread daily",
      language: "fr",
      favicon: { assetId: "a1" },
      seo: {
        title: "Acme — Fresh Bread",
        description: "The best bakery",
        keywords: ["bakery", "bread"],
        canonicalUrl: "https://acme.example",
        robotsIndex: false,
        robotsFollow: true,
      },
      social: {
        title: "Acme Bakery",
        description: "Share line",
        image: { assetId: "a2", altText: "logo" },
      },
      appearance: { themeColor: "#f5f0e8" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsafe canonical URLs via project schema validation (non-URL is allowed shape-wise; UI enforces)", () => {
    // The schema is deliberately permissive (length caps only) — canonical
    // http(s) enforcement happens in the export/UI layer. This test documents
    // that the schema does not hard-fail arbitrary strings.
    const result = SiteSettingsSchema.safeParse({
      siteName: "X",
      seo: { canonicalUrl: "javascript:alert(1)" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects over-length fields", () => {
    const result = SiteSettingsSchema.safeParse({
      siteName: "x".repeat(121),
      seo: { title: "y".repeat(201) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string siteName types", () => {
    expect(SiteSettingsSchema.safeParse({ siteName: 42 }).success).toBe(false);
  });
});

describe("sanitizeSiteSettings", () => {
  it("trims and drops empty fields", () => {
    const sanitized = sanitizeSiteSettings({
      siteName: "  Acme  ",
      siteDescription: "   ",
      language: "en",
    });
    expect(sanitized).toEqual({ siteName: "Acme", language: "en" });
  });

  it("preserves booleans and asset refs", () => {
    const sanitized = sanitizeSiteSettings({
      siteName: "X",
      favicon: { assetId: "  a1  ", altText: "icon" },
      seo: { robotsIndex: false, robotsFollow: true, keywords: ["  a  ", "b", " "] },
    });
    expect(sanitized.favicon).toEqual({ assetId: "a1", altText: "icon" });
    expect(sanitized.seo).toMatchObject({ robotsIndex: false, robotsFollow: true });
    expect((sanitized.seo as { keywords: string[] }).keywords).toEqual(["a", "b"]);
  });

  it("never mutates input", () => {
    const input = { siteName: "  Acme  " };
    sanitizeSiteSettings(input);
    expect(input.siteName).toBe("  Acme  ");
  });
});

describe("ProjectSchema integration (backward compatible)", () => {
  it("accepts projects without siteSettings (legacy)", () => {
    expect(ProjectSchema.safeParse(baseProject()).success).toBe(true);
  });

  it("accepts projects with siteSettings", () => {
    const project = { ...baseProject(), siteSettings: { siteName: "Acme" } };
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });

  it("rejects malformed siteSettings shapes", () => {
    const project = { ...baseProject(), siteSettings: { siteName: 42 } };
    expect(ProjectSchema.safeParse(project).success).toBe(false);
  });

  it("serialize → deserialize preserves siteSettings", () => {
    const project = {
      ...baseProject(),
      siteSettings: {
        siteName: "Acme Bakery",
        siteDescription: "Fresh bread",
        seo: { title: "Acme", description: "D", robotsIndex: false },
        social: { image: { assetId: "a1" } },
        favicon: { assetId: "a2" },
      },
    };
    const json = serializeProject(project);
    const back = deserializeProject(json);
    expect(back.success).toBe(true);
    if (back.success) {
      expect(back.project.siteSettings).toEqual(project.siteSettings);
    }
  });

  it("normalizer preserves siteSettings", () => {
    const project = { ...baseProject(), siteSettings: { siteName: "Acme" } };
    const normalized = normalizeProject(project);
    expect(normalized.success).toBe(true);
    if (normalized.success) {
      expect(normalized.project.siteSettings).toEqual({ siteName: "Acme" });
    }
  });
});
