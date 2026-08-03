// ---------------------------------------------------------------------------
// Section library — registry, definitions, filter, sort tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SectionLibraryRegistry } from "../registry/section-library-registry";
import {
  registerDefaultSectionLibrary,
  resetSectionLibraryRegistration,
} from "../registry/register-default-section-library";
import { sectionLibraryRegistry } from "../registry/section-library-registry";
import { filterSectionDefinitions, searchSectionDefinitions } from "../utils/filter-section-definitions";
import { sortSectionDefinitions } from "../utils/sort-section-definitions";
import { validateSectionSafe } from "../../schemas/section-schemas";
import type {
  SectionLibraryCategory,
  SectionLibraryDefinition,
  SectionType,
} from "../types";
import type { SectionPropsMap } from "@/types/section";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDefinition<T extends SectionType>(
  type: T,
  overrides?: Partial<SectionLibraryDefinition<T>>,
): SectionLibraryDefinition<T> {
  return {
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    description: `The ${type} section.`,
    category: "content",
    keywords: [type, "test"],
    iconKey: "layout-grid",
    createProps: () => ({}) as SectionPropsMap[T],
    createStyles: () => ({}),
    ...overrides,
  };
}

describe("SectionLibraryRegistry", () => {
  let registry: SectionLibraryRegistry;

  beforeEach(() => {
    registry = new SectionLibraryRegistry();
  });

  it("registers a definition", () => {
    expect(registry.register(makeDefinition("hero"))).toBe(true);
    expect(registry.has("hero")).toBe(true);
    expect(registry.get("hero")?.type).toBe("hero");
  });

  it("rejects duplicate registration (first wins)", () => {
    registry.register(makeDefinition("hero"));
    registry.register(makeDefinition("hero", { name: "Second" }));
    expect(registry.get("hero")?.name).toBe("Hero");
    expect(registry.list()).toHaveLength(1);
  });

  it("lists definitions in registration order", () => {
    registry.register(makeDefinition("cta"));
    registry.register(makeDefinition("hero"));
    const types = registry.list().map((d) => d.type);
    expect(types).toEqual(["cta", "hero"]);
  });

  it("exposes registered types", () => {
    registry.register(makeDefinition("faq"));
    expect(registry.types).toEqual(["faq"]);
  });

  it("returns undefined for unknown types", () => {
    expect(registry.get("bogus" as SectionType)).toBeUndefined();
    expect(registry.has("bogus" as SectionType)).toBe(false);
  });

  it("freezes registered definitions (immutable)", () => {
    const def = makeDefinition("hero");
    registry.register(def);
    expect(Object.isFrozen(registry.get("hero"))).toBe(true);
  });
});

describe("registerDefaultSectionLibrary", () => {
  beforeEach(() => {
    resetSectionLibraryRegistration();
    sectionLibraryRegistry.clear();
  });

  it("registers all seven default definitions exactly once", () => {
    registerDefaultSectionLibrary();
    const types = sectionLibraryRegistry.types;
    expect(types).toHaveLength(7);
    expect(types.sort()).toEqual(
      ["header", "hero", "features", "pricing", "faq", "cta", "footer"].sort(),
    );
  });

  it("is idempotent", () => {
    registerDefaultSectionLibrary();
    registerDefaultSectionLibrary();
    expect(sectionLibraryRegistry.list()).toHaveLength(7);
  });

  it("marks header and footer as singletons", () => {
    registerDefaultSectionLibrary();
    expect(sectionLibraryRegistry.get("header")?.singleton).toBe(true);
    expect(sectionLibraryRegistry.get("footer")?.singleton).toBe(true);
    expect(sectionLibraryRegistry.get("hero")?.singleton).toBeUndefined();
  });

  it("all definitions have a supported category", () => {
    registerDefaultSectionLibrary();
    const supported: SectionLibraryCategory[] = [
      "navigation",
      "hero",
      "content",
      "commerce",
      "conversion",
      "footer",
    ];
    for (const def of sectionLibraryRegistry.list()) {
      expect(supported).toContain(def.category);
    }
  });

  it("all definitions produce props/styles that pass schema validation", () => {
    registerDefaultSectionLibrary();
    for (const def of sectionLibraryRegistry.list()) {
      const section = {
        id: `test-${def.type}`,
        type: def.type,
        order: 1,
        visible: true,
        props: def.createProps(),
        styles: def.createStyles(),
      };
      const validation = validateSectionSafe(section);
      expect(validation.success, `${def.type} should validate`).toBe(true);
    }
  });

  it("no default definition contains lorem ipsum or placeholder 'Feature 1' content", () => {
    registerDefaultSectionLibrary();
    const serialized = JSON.stringify(
      sectionLibraryRegistry.list().map((d) => ({
        props: d.createProps(),
        description: d.description,
      })),
    ).toLowerCase();
    expect(serialized).not.toContain("lorem");
    expect(serialized).not.toContain("feature 1");
    expect(serialized).not.toContain("placeholder");
  });

  it("link values use { text, href } shape and pricing CTAs are plain strings", () => {
    registerDefaultSectionLibrary();
    const pricing = sectionLibraryRegistry.get("pricing")!.createProps() as {
      plans: { cta: string }[];
    };
    for (const plan of pricing.plans) {
      expect(typeof plan.cta).toBe("string");
    }
    const header = sectionLibraryRegistry.get("header")!.createProps() as {
      navLinks: unknown[];
    };
    for (const link of header.navLinks) {
      expect(link).toMatchObject({ text: expect.any(String), href: expect.any(String) });
    }
    const footer = sectionLibraryRegistry.get("footer")!.createProps() as {
      links: unknown[];
    };
    for (const link of footer.links) {
      expect(link).toMatchObject({ text: expect.any(String), href: expect.any(String) });
    }
  });

  it("definitions do not carry runtime section IDs", () => {
    registerDefaultSectionLibrary();
    for (const def of sectionLibraryRegistry.list()) {
      expect((def as { id?: unknown }).id).toBeUndefined();
    }
  });

  it("createProps returns fresh, deeply independent objects each call", () => {
    registerDefaultSectionLibrary();
    const def = sectionLibraryRegistry.get("features")!;
    const a = def.createProps() as { features: unknown[] };
    const b = def.createProps() as { features: unknown[] };
    expect(a).not.toBe(b);
    expect(a.features).not.toBe(b.features);
    a.features.push({ title: "mutated" } as never);
    expect(b.features).toHaveLength(3);
  });
});

describe("filterSectionDefinitions", () => {
  const defs: SectionLibraryDefinition[] = [
    makeDefinition("hero", { name: "Hero Banner", keywords: ["landing", "banner"], category: "hero" }),
    makeDefinition("pricing", { name: "Pricing Plans", keywords: ["money", "billing"], category: "commerce" }),
    makeDefinition("cta", { name: "Call to Action", keywords: ["button", "signup"], category: "conversion" }),
  ];

  it("returns everything for an empty filter", () => {
    expect(filterSectionDefinitions(defs, {})).toHaveLength(3);
  });

  it("searches by name", () => {
    expect(searchSectionDefinitions(defs, "hero")).toHaveLength(1);
    expect(searchSectionDefinitions(defs, "banner")).toHaveLength(1);
  });

  it("searches by description", () => {
    expect(searchSectionDefinitions(defs, "section")).toHaveLength(3);
  });

  it("searches by keyword", () => {
    expect(searchSectionDefinitions(defs, "billing")).toHaveLength(1);
  });

  it("filters by category", () => {
    expect(filterSectionDefinitions(defs, { category: "commerce" })).toHaveLength(1);
    expect(filterSectionDefinitions(defs, { category: "all" })).toHaveLength(3);
  });

  it("combines query + category", () => {
    const results = filterSectionDefinitions(defs, { query: "banner", category: "hero" });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("hero");
  });

  it("matches all whitespace-separated tokens", () => {
    expect(searchSectionDefinitions(defs, "pricing plans")).toHaveLength(1);
  });

  it("preserves input order (deterministic)", () => {
    const results = searchSectionDefinitions(defs, "section");
    expect(results.map((d) => d.type)).toEqual(["hero", "pricing", "cta"]);
  });
});

describe("sortSectionDefinitions", () => {
  it("sorts by explicit sortOrder first", () => {
    const defs = [
      makeDefinition("cta", { sortOrder: 30 }),
      makeDefinition("hero", { sortOrder: 10 }),
      makeDefinition("faq", { sortOrder: 20 }),
    ];
    expect(sortSectionDefinitions(defs).map((d) => d.type)).toEqual(["hero", "faq", "cta"]);
  });

  it("does not mutate the input", () => {
    const defs = [makeDefinition("cta"), makeDefinition("hero")];
    const input = [...defs];
    sortSectionDefinitions(defs);
    expect(defs).toEqual(input);
  });

  it("uses recommendedPosition as a tie-breaker", () => {
    const defs = [
      makeDefinition("cta", { recommendedPosition: "bottom" }),
      makeDefinition("hero", { recommendedPosition: "top" }),
    ];
    expect(sortSectionDefinitions(defs).map((d) => d.type)).toEqual(["hero", "cta"]);
  });

  it("falls back to name ordering for unspecified positions", () => {
    const defs = [makeDefinition("cta"), makeDefinition("hero")];
    expect(sortSectionDefinitions(defs).map((d) => d.type)).toEqual(["cta", "hero"]);
  });
});
