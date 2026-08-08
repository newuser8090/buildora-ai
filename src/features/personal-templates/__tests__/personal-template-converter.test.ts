// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — converter tests
//
// Verifies a stored PersonalTemplateRecord wraps as a BuildoraTemplate and
// that TemplateProjectFactory can build a fresh, schema-valid project from it
// (fresh IDs, retained content, derived preview).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { personalTemplateToBuildoraTemplate } from "../convert/personal-template-converter";
import { TemplateProjectFactory } from "@/features/templates/services/template-project-factory";
import { TemplateRegistry } from "@/features/templates/registry/template-registry";
import type { PersonalTemplateRecord } from "../types";

function makeRecord(): PersonalTemplateRecord {
  return {
    id: "personal-convert-1",
    name: "My Saved Design",
    description: "A design I made",
    category: "portfolio",
    tags: ["favorite"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    source: "personal",
    project: {
      id: "proj-old",
      name: "Old Name",
      theme: {
        palette: {
          background: "#ffffff", foreground: "#111", primary: "#0f9d8f",
          primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#111",
          muted: "#f5f5f5", mutedForeground: "#666", accent: "#0f9d8f",
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
          id: "old-page",
          title: "Home",
          slug: "/",
          sections: [
            {
              id: "old-sec",
              type: "hero",
              order: 1,
              visible: true,
              props: { headline: "Keep me", primaryCta: { text: "Go", href: "#" } },
              styles: {},
            },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("personalTemplateToBuildoraTemplate", () => {
  it("derives a deterministic preview from the snapshot (accent + sections)", () => {
    const buildora = personalTemplateToBuildoraTemplate(makeRecord());
    expect(buildora.source).toBe("personal");
    expect(buildora.id).toBe("personal-convert-1");
    expect(buildora.preview.accent).toBe("#0f9d8f");
    expect(buildora.preview.badge).toBe("Yours");
    expect(buildora.preview.sections).toEqual([
      { kind: "hero", label: "Hero" },
    ]);
  });

  it("createProject builds a fresh, schema-valid project via the factory", () => {
    const registry = new TemplateRegistry();
    registry.register(personalTemplateToBuildoraTemplate(makeRecord()));
    const factory = new TemplateProjectFactory({ registry });

    let n = 0;
    const result = factory.createProjectFromTemplate({
      templateId: "personal-convert-1",
      projectName: "New Project",
      now: "2026-09-01T00:00:00.000Z",
      idFactory: {
        projectId: () => `fresh-${++n}`,
        pageId: (_t, i) => `fresh-page-${i}`,
        sectionId: (_t, _type, i) => `fresh-sec-${i}`,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.id).toBe("fresh-1");
    expect(result.project.name).toBe("New Project");
    expect(result.project.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.project.pages[0].id).toBe("fresh-page-0");
    expect(result.project.pages[0].sections[0].id).toBe("fresh-sec-0");
    // Content retained through the pipeline.
    expect(result.project.pages[0].sections[0].props.headline).toBe("Keep me");
  });

  it("never shares mutable references with the stored record", () => {
    const record = makeRecord();
    const buildora = personalTemplateToBuildoraTemplate(record);
    const built = buildora.createProject({
      templateId: record.id,
      projectId: "new-id",
      projectName: "X",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ids: {
        projectId: () => "new-id",
        pageId: () => "new-page",
        sectionId: () => "new-sec",
      },
    });
    built.pages[0].sections[0].props.headline = "MUTATED";
    expect(record.project.pages[0].sections[0].props.headline).toBe("Keep me");
  });
});
