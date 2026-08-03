// ---------------------------------------------------------------------------
// Routing data preservation — export → import round trip
//
// Proves that page slugs and per-page metadata (Page.meta) survive the
// .buildora.json export/import pipeline intact.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import { ProjectExportService } from "../services/project-export-service";
import { ProjectImportService } from "../services/project-import-service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTwoPageProject(): Project {
  const theme = {
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
  };
  return {
    id: "proj-1",
    name: "Routing Site",
    theme,
    assets: [],
    pages: [
      {
        id: "home",
        title: "Home",
        slug: "/",
        meta: { title: "Home SEO", description: "The homepage." },
        sections: [
          { id: "hero-1", type: "hero", order: 1, visible: true, props: { headline: "Hi" }, styles: {} },
        ],
      },
      {
        id: "about",
        title: "About",
        slug: "/about",
        meta: { description: "Learn about us." },
        sections: [
          { id: "hero-2", type: "hero", order: 1, visible: true, props: { headline: "About" }, styles: {} },
        ],
      },
      {
        id: "contact",
        title: "Contact",
        slug: "/contact",
        sections: [
          { id: "hero-3", type: "hero", order: 1, visible: true, props: { headline: "Contact" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Round trip
// ---------------------------------------------------------------------------

describe("routing data round trip", () => {
  it("preserves page slugs and per-page metadata through export → import", () => {
    const project = makeTwoPageProject();

    const exportResult = new ProjectExportService().exportProject(project);
    expect(exportResult.ok).toBe(true);
    if (!exportResult.ok) return;
    const { content } = exportResult;

    const importResult = new ProjectImportService().parse(
      content,
      "routing-site.buildora.json",
    );
    expect(importResult.ok).toBe(true);
    if (!importResult.ok) return;

    const { project: imported } = importResult.preview;

    // Slugs survive
    expect(imported.pages.map((p) => p.slug)).toEqual([
      "/",
      "/about",
      "/contact",
    ]);

    // Page order survives
    expect(imported.pages.map((p) => p.id)).toEqual(["home", "about", "contact"]);

    // Per-page metadata survives
    expect(imported.pages[0].meta).toEqual({
      title: "Home SEO",
      description: "The homepage.",
    });
    expect(imported.pages[1].meta).toEqual({ description: "Learn about us." });
    // Pages without meta stay clean
    expect(imported.pages[2].meta).toBeUndefined();
  });

  it("does not warn about the meta field as unknown", () => {
    const project = makeTwoPageProject();
    const exportResult = new ProjectExportService().exportProject(project);
    if (!exportResult.ok) return;
    const importResult = new ProjectImportService().parse(
      exportResult.content,
      "routing-site.buildora.json",
    );
    if (!importResult.ok) return;
    const warnings = importResult.preview.warnings;
    expect(
      warnings.some((w) => w.code === "UNKNOWN_OPTIONAL_FIELD_IGNORED"),
    ).toBe(false);
  });

  it("round-trips a project whose homepage slug was renamed", () => {
    const project = makeTwoPageProject();
    project.pages[0].slug = "/landing";

    const exportResult = new ProjectExportService().exportProject(project);
    if (!exportResult.ok) return;
    const importResult = new ProjectImportService().parse(
      exportResult.content,
      "routing-site.buildora.json",
    );
    expect(importResult.ok).toBe(true);
    if (!importResult.ok) return;
    expect(importResult.preview.project.pages[0].slug).toBe("/landing");
  });
});
