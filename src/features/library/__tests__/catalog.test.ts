// ---------------------------------------------------------------------------
// Element Library catalog (Phase P22-D) — unit tests
//   - every exposed item is a registered, renderable block type
//   - element-only types (no render/persist path yet) are excluded
//   - category + search filtering
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerDefaultBlocks,
  isDefaultBlocksRegistered,
} from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import {
  buildLibraryCatalog,
  filterLibraryItems,
  LIBRARY_CATEGORIES,
  matchesLibraryQuery,
} from "../catalog";
import { isElementOnlyType, ELEMENT_ONLY_TYPES } from "@/features/elements/types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
});

describe("buildLibraryCatalog", () => {
  it("exposes every registered block type", () => {
    const catalog = buildLibraryCatalog();
    const types = catalog.map((item) => item.type);
    for (const blockType of [
      "container", "row", "column", "grid", "stack", "divider", "spacer",
      "heading", "paragraph", "button", "image", "video", "icon", "badge",
      "form", "input", "textarea", "checkbox", "tabs", "accordion",
      "card", "pricing-card", "feature-card", "review-card", "faq-item", "team-member",
      "navbar", "footer", "menu",
    ]) {
      expect(types).toContain(blockType);
    }
  });

  it("never exposes element-only types (no render/persist path yet)", () => {
    const catalog = buildLibraryCatalog();
    for (const item of catalog) {
      expect(isElementOnlyType(item.type as string)).toBe(false);
    }
    for (const type of ELEMENT_ONLY_TYPES) {
      expect(catalog.some((item) => item.type === (type as string))).toBe(false);
    }
  });

  it("maps every item to a known library category", () => {
    const catalog = buildLibraryCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    const ids = new Set(LIBRARY_CATEGORIES.map((c) => c.id));
    for (const item of catalog) {
      expect(ids.has(item.category)).toBe(true);
    }
  });

  it("returns deterministic order matching the block registry", () => {
    const a = buildLibraryCatalog();
    const b = buildLibraryCatalog();
    expect(a.map((i) => i.type)).toEqual(b.map((i) => i.type));
  });

  it("each item carries label, description, icon and keywords", () => {
    for (const item of buildLibraryCatalog()) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.iconKey.length).toBeGreaterThan(0);
      expect(Array.isArray(item.keywords)).toBe(true);
    }
  });
});

describe("filterLibraryItems", () => {
  const catalog = () => buildLibraryCatalog();

  it("empty query + all category returns the whole catalog", () => {
    const items = catalog();
    expect(filterLibraryItems(items, { category: "all", query: "" }).length).toBe(items.length);
  });

  it("filters by category", () => {
    const items = catalog();
    const layout = filterLibraryItems(items, { category: "layout", query: "" });
    expect(layout.length).toBeGreaterThan(0);
    for (const item of layout) expect(item.category).toBe("layout");
  });

  it("searches by label", () => {
    const items = catalog();
    const found = filterLibraryItems(items, { category: "all", query: "heading" });
    expect(found.map((i) => i.type)).toContain("heading");
  });

  it("searches by keywords and synonyms", () => {
    const items = catalog();
    const byKeyword = filterLibraryItems(items, { category: "all", query: "cta" });
    expect(byKeyword.map((i) => i.type)).toContain("button");
    const bySynonym = filterLibraryItems(items, { category: "all", query: "testimonial" });
    expect(bySynonym.map((i) => i.type)).toContain("review-card");
  });

  it("combines category + query", () => {
    const items = catalog();
    const found = filterLibraryItems(items, { category: "layout", query: "grid" });
    expect(found.length).toBeGreaterThan(0);
    for (const item of found) expect(item.category).toBe("layout");
  });

  it("returns an empty list for a miss", () => {
    const items = catalog();
    expect(filterLibraryItems(items, { category: "all", query: "zzzzz" }).length).toBe(0);
  });
});

describe("matchesLibraryQuery", () => {
  it("matches type, keywords and plain-language synonyms", () => {
    const items = buildLibraryCatalog();
    const navbar = items.find((i) => i.type === "navbar")!;
    expect(matchesLibraryQuery(navbar, "navbar")).toBe(true);
    expect(matchesLibraryQuery(navbar, "navigation")).toBe(true);
    expect(matchesLibraryQuery(navbar, "header")).toBe(true);
    expect(matchesLibraryQuery(navbar, "xyz")).toBe(false);
  });

  it("requires every whitespace-separated token to match", () => {
    const items = buildLibraryCatalog();
    const pricing = items.find((i) => i.type === "pricing-card")!;
    expect(matchesLibraryQuery(pricing, "price card")).toBe(true);
    expect(matchesLibraryQuery(pricing, "price blog")).toBe(false);
  });
});
