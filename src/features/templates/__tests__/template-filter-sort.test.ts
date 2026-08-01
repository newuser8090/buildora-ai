// ---------------------------------------------------------------------------
// Template search + sort tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { filterTemplates, templateCategories } from "../utils/filter-templates";
import { sortTemplates, featuredTemplates } from "../utils/sort-templates";
import type { BuildoraTemplate } from "../types";

function makeTemplate(id: string, overrides: Partial<BuildoraTemplate> = {}): BuildoraTemplate {
  return {
    id,
    name: `Name ${id}`,
    description: `Description for ${id}`,
    category: "business",
    tags: [],
    defaultName: `Name ${id}`,
    preview: { sections: [{ kind: "hero", label: "Hero" }] },
    createProject: () => ({}),
    ...overrides,
  } as unknown as BuildoraTemplate;
}

const templates: BuildoraTemplate[] = [
  makeTemplate("t-saas", {
    name: "SaaS Landing Page",
    description: "Marketing site for a software product.",
    category: "landing-page",
    tags: ["saas", "software"],
    featured: true,
    sortOrder: 10,
  }),
  makeTemplate("t-portfolio", {
    name: "Portfolio",
    description: "A refined portfolio for creatives.",
    category: "portfolio",
    tags: ["creative", "designer"],
    featured: true,
    sortOrder: 20,
  }),
  makeTemplate("t-agency", {
    name: "Creative Agency",
    description: "A bold site for an agency.",
    category: "business",
    tags: ["agency", "studio"],
    sortOrder: 30,
  }),
  makeTemplate("t-restaurant", {
    name: "Restaurant",
    description: "An appetizing site for a restaurant.",
    category: "food",
    tags: ["restaurant", "cafe"],
    sortOrder: 40,
  }),
  makeTemplate("t-blank", {
    name: "Blank Project",
    description: "A clean slate.",
    category: "blank",
    tags: ["blank", "minimal"],
    featured: true,
    sortOrder: 0,
  }),
];

describe("filterTemplates", () => {
  it("returns all templates with no options", () => {
    expect(filterTemplates(templates)).toHaveLength(templates.length);
  });

  it("searches by name", () => {
    const result = filterTemplates(templates, { search: "portfolio" });
    expect(result.map((t) => t.id)).toEqual(["t-portfolio"]);
  });

  it("searches by description", () => {
    const result = filterTemplates(templates, { search: "appetizing" });
    expect(result.map((t) => t.id)).toEqual(["t-restaurant"]);
  });

  it("searches by tag", () => {
    const result = filterTemplates(templates, { search: "designer" });
    expect(result.map((t) => t.id)).toEqual(["t-portfolio"]);
  });

  it("searches by category label", () => {
    const result = filterTemplates(templates, { search: "landing" });
    expect(result.map((t) => t.id)).toEqual(["t-saas"]);
  });

  it("is case-insensitive", () => {
    const result = filterTemplates(templates, { search: "PORTFOLIO" });
    expect(result.map((t) => t.id)).toEqual(["t-portfolio"]);
  });

  it("trims the query", () => {
    const result = filterTemplates(templates, { search: "  agency  " });
    expect(result.map((t) => t.id)).toEqual(["t-agency"]);
  });

  it("combines category filter with search", () => {
    const result = filterTemplates(templates, { search: "a", category: "business" });
    expect(result.length).toBeGreaterThan(0);
    for (const t of result) expect(t.category).toBe("business");
  });

  it("empty query restores all within category", () => {
    const result = filterTemplates(templates, { search: "   ", category: "food" });
    expect(result.map((t) => t.id)).toEqual(["t-restaurant"]);
  });

  it("returns empty array for no matches", () => {
    const result = filterTemplates(templates, { search: "zzzz-nothing" });
    expect(result).toHaveLength(0);
  });

  it("does not mutate the source array", () => {
    const snapshot = JSON.stringify(templates);
    filterTemplates(templates, { search: "portfolio" });
    expect(JSON.stringify(templates)).toBe(snapshot);
  });
});

describe("templateCategories", () => {
  it("returns distinct categories excluding blank", () => {
    const categories = templateCategories(templates);
    expect(categories).toEqual(["landing-page", "portfolio", "business", "food"]);
  });
});

describe("sortTemplates", () => {
  it("puts blank first", () => {
    const sorted = sortTemplates(templates);
    expect(sorted[0].id).toBe("t-blank");
  });

  it("puts featured templates before non-featured", () => {
    const sorted = sortTemplates(templates);
    const blankIdx = sorted.findIndex((t) => t.id === "t-blank");
    const featuredNonBlank = sorted.slice(1).filter((t) => t.featured);
    const firstNonFeatured = sorted.slice(1).find((t) => !t.featured);
    for (const f of featuredNonBlank) {
      expect(sorted.indexOf(f)).toBeLessThan(sorted.indexOf(firstNonFeatured!));
    }
    void blankIdx;
  });

  it("sorts by sortOrder ascending within the same featured group", () => {
    const sorted = sortTemplates([
      makeTemplate("b", { sortOrder: 5, featured: true, category: "portfolio" }),
      makeTemplate("a", { sortOrder: 3, featured: true, category: "portfolio" }),
      makeTemplate("c", { sortOrder: 9, featured: true, category: "portfolio" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("ties broken by name ascending", () => {
    const sorted = sortTemplates([
      makeTemplate("x", { name: "Zed", featured: true, category: "portfolio" }),
      makeTemplate("y", { name: "Alpha", featured: true, category: "portfolio" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["y", "x"]);
  });

  it("identical name ties broken by id ascending", () => {
    const sorted = sortTemplates([
      makeTemplate("b", { name: "Same", featured: true, category: "portfolio" }),
      makeTemplate("a", { name: "Same", featured: true, category: "portfolio" }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("templates without sortOrder sort after those with one", () => {
    const sorted = sortTemplates([
      makeTemplate("no-order", { category: "portfolio", featured: true }),
      makeTemplate("with-order", { category: "portfolio", featured: true, sortOrder: 1 }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["with-order", "no-order"]);
  });

  it("does not mutate the source array", () => {
    const snapshot = JSON.stringify(templates);
    sortTemplates(templates);
    expect(JSON.stringify(templates)).toBe(snapshot);
  });

  it("featuredTemplates returns only featured, in sort order", () => {
    const featured = featuredTemplates(templates);
    expect(featured.every((t) => t.featured)).toBe(true);
    expect(featured.map((t) => t.id)).toEqual(["t-blank", "t-saas", "t-portfolio"]);
  });

  it("is deterministic — repeated calls return the same order", () => {
    expect(sortTemplates(templates)).toEqual(sortTemplates(templates));
  });
});
