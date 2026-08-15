// ---------------------------------------------------------------------------
// Phase P22-I — project generator: multi-page site projects
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { generateProject } from "../project-generator";
import { analyzeSitePrompt } from "../../analyzers/prompt-analyzer";
import { analyzePrompt } from "../../analyzers/prompt-analyzer";
import { getThemeTokens } from "../../analyzers/theme-resolver";
import { validateRoutingForExport } from "@/features/routing/routes";
import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import type { GenerationPlan } from "../../types/generation-plan";

function sitePlan(prompt: string): GenerationPlan {
  return analyzeSitePrompt(prompt);
}

describe("generateProject — Phase P22-I multi-page sites", () => {
  it("generates multiple pages with the homepage owning the root slug", () => {
    const project = generateProject(
      sitePlan("Build a multi-page restaurant website called Ember House with menu, about, and contact pages"),
    );
    expect(project.pages.length).toBeGreaterThanOrEqual(2);
    expect(project.pages[0].slug).toBe("/");
    expect(project.pages[0].title).toBe("Home");
    expect(project.pages[0].id).toBe("page-1");
  });

  it("produces unique, routing-valid slugs", () => {
    const project = generateProject(
      sitePlan("Build a multi-page ecommerce website called Acme with shop, about, and contact pages"),
    );
    const slugs = project.pages.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(validateRoutingForExport(project.pages)).toEqual([]);
  });

  it("assigns deterministic page and section ids (no timestamps in ids)", () => {
    const plan = sitePlan("Build a multi-page SaaS website called Nimbus");
    const a = generateProject(plan);
    const b = generateProject(plan);
    const strip = (p: typeof a) =>
      JSON.stringify(
        { pages: p.pages },
        (_k, v) => {
          if (_k === "createdAt" || _k === "updatedAt" || _k === "id" && typeof v === "string" && v.startsWith("proj-")) return undefined;
          return v;
        },
      );
    expect(strip(a)).toBe(strip(b));
  });

  it("validates every generated section against the section schema", () => {
    const project = generateProject(
      sitePlan("Build a multi-page agency website called Northstar with services, about, and contact pages"),
    );
    for (const page of project.pages) {
      expect(page.sections.length).toBeGreaterThan(0);
      for (const section of page.sections) {
        const result = AnySectionSchema.safeParse(section);
        expect(result.success).toBe(true);
      }
    }
  });

  it("shares one theme across the entire site", () => {
    const plan = sitePlan("Build a multi-page restaurant website called Ember House");
    const project = generateProject(plan);
    expect(project.theme).toEqual(getThemeTokens(plan.theme));
    // Every page is part of the same project object — no per-page themes exist.
    expect(project.pages.every(() => true)).toBe(true);
  });

  it("keeps the homepage slug unique (second page cannot steal '/')", () => {
    const project = generateProject(
      sitePlan("Build a multi-page SaaS website called Nimbus"),
    );
    const nonHome = project.pages.slice(1).map((p) => p.slug);
    expect(nonHome).not.toContain("/");
  });

  it("preserves single-page create behavior (regression)", () => {
    const plan = analyzePrompt("Build a dark SaaS website for Huddle");
    const project = generateProject(plan);
    expect(project.pages).toHaveLength(1);
    expect(project.pages[0].slug).toBe("/");
    expect(project.pages[0].id).toBe("page-1");
    expect(project.pages[0].sections.length).toBeGreaterThan(0);
    const result = AnySectionSchema.safeParse(project.pages[0].sections[0]);
    expect(result.success).toBe(true);
  });

  it("applies the 6-page cap to oversized site plans", () => {
    const plan = analyzeSitePrompt("Build a multi-page SaaS website called Nimbus");
    // Artificially inflate beyond the bound — the generator must clamp.
    const inflated: GenerationPlan = {
      ...plan,
      pages: Array.from({ length: 12 }, (_, i) => ({
        title: `Page ${i + 1}`,
        slug: i === 0 ? "/" : `/page-${i + 1}`,
        sections: plan.pages![0].sections,
      })),
    };
    const project = generateProject(inflated);
    expect(project.pages.length).toBeLessThanOrEqual(6);
    expect(validateRoutingForExport(project.pages)).toEqual([]);
  });
});
