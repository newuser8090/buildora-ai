// ---------------------------------------------------------------------------
// Page structure — pure helpers
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Page } from "@/types/project";
import {
  slugifyTitle,
  resolveUniqueSlug,
  validatePageTitle,
  buildPage,
  addPageToList,
  renamePageInList,
  deletePageFromList,
  movePageToIndex,
  createPageId,
  sanitizePageMeta,
} from "./page-structure";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    title: "Home",
    slug: "/",
    sections: [
      { id: "hero-1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
    ],
    ...overrides,
  };
}

function makePages(): Page[] {
  return [
    makePage(),
    makePage({ id: "page-2", title: "About", slug: "/about" }),
    makePage({ id: "page-3", title: "Contact", slug: "/contact" }),
  ];
}

// ---------------------------------------------------------------------------
// slugifyTitle
// ---------------------------------------------------------------------------

describe("slugifyTitle", () => {
  it("maps Home to the root path", () => {
    expect(slugifyTitle("Home")).toBe("/");
    expect(slugifyTitle("home")).toBe("/");
  });

  it("lowercases and kebab-cases titles", () => {
    expect(slugifyTitle("About Us")).toBe("/about-us");
    expect(slugifyTitle("  Contact ")).toBe("/contact");
    expect(slugifyTitle("Our Team & History")).toBe("/our-team-history");
  });

  it("falls back to the root path for empty or punctuation-only titles", () => {
    expect(slugifyTitle("")).toBe("/");
    expect(slugifyTitle("   ")).toBe("/");
    expect(slugifyTitle("!!!")).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// resolveUniqueSlug
// ---------------------------------------------------------------------------

describe("resolveUniqueSlug", () => {
  it("returns the base slug when free", () => {
    expect(resolveUniqueSlug(makePages(), "Services")).toBe("/services");
  });

  it("appends a numeric suffix on conflict", () => {
    const pages = makePages();
    expect(resolveUniqueSlug(pages, "About")).toBe("/about-2");
    expect(resolveUniqueSlug(pages, "Contact")).toBe("/contact-2");
  });

  it("escapes further conflicts with incrementing suffixes", () => {
    const pages = [
      ...makePages(),
      makePage({ id: "page-4", title: "About 2", slug: "/about-2" }),
    ];
    expect(resolveUniqueSlug(pages, "About")).toBe("/about-3");
  });

  it("falls back to /home when the root is taken", () => {
    expect(resolveUniqueSlug(makePages(), "Home")).toBe("/home");
  });

  it("ignores the excluded page when resolving its own slug", () => {
    // Renaming "Contact" to "About" must not collide with itself.
    const pages = [
      makePage(),
      makePage({ id: "page-2", title: "About", slug: "/about" }),
    ];
    expect(resolveUniqueSlug(pages, "About", "page-2")).toBe("/about");
  });

  it("reserves the root slug for the first page only", () => {
    // Non-first page titled "Home" never owns "/" (homepage policy).
    const pages = [makePage(), makePage({ id: "page-2", title: "About", slug: "/about" })];
    expect(resolveUniqueSlug(pages, "Home")).toBe("/home");
    // Renaming the first page can keep the root when the title is Home.
    expect(resolveUniqueSlug(pages, "Home", "page-1")).toBe("/");
    // Renaming a non-first page to "Home" must not take the root.
    expect(resolveUniqueSlug(pages, "Home", "page-2")).toBe("/home");
  });

  it("lets the first page of an empty project own the root", () => {
    expect(resolveUniqueSlug([], "Home")).toBe("/");
  });

  it("auto-avoids reserved segments", () => {
    // A page titled "API" would derive "/api" — a reserved Next.js path.
    const pages = [makePage()];
    expect(resolveUniqueSlug(pages, "API")).toBe("/api-2");
  });
});

// ---------------------------------------------------------------------------
// sanitizePageMeta
// ---------------------------------------------------------------------------

describe("sanitizePageMeta", () => {
  it("trims and stores title + description", () => {
    const meta = sanitizePageMeta({ title: "  About Us  ", description: "  A story  " });
    expect(meta).toEqual({ title: "About Us", description: "A story" });
  });

  it("drops empty values", () => {
    expect(sanitizePageMeta({ title: "  ", description: "" })).toEqual({});
    expect(sanitizePageMeta(undefined)).toEqual({});
    expect(sanitizePageMeta({ title: 42 })).toEqual({});
  });

  it("enforces length caps", () => {
    const meta = sanitizePageMeta({
      title: "x".repeat(300),
      description: "y".repeat(900),
    });
    expect(meta.title).toHaveLength(200);
    expect(meta.description).toHaveLength(500);
  });
});

// ---------------------------------------------------------------------------
// validatePageTitle
// ---------------------------------------------------------------------------

describe("validatePageTitle", () => {
  it("rejects empty and whitespace-only titles", () => {
    expect(validatePageTitle("").valid).toBe(false);
    expect(validatePageTitle("   ").valid).toBe(false);
    expect(validatePageTitle(null).valid).toBe(false);
  });

  it("rejects titles over 60 characters", () => {
    expect(validatePageTitle("x".repeat(61)).valid).toBe(false);
    expect(validatePageTitle("x".repeat(60)).valid).toBe(true);
  });

  it("accepts normal titles", () => {
    const result = validatePageTitle("About Us");
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildPage / addPageToList / createPageId
// ---------------------------------------------------------------------------

describe("buildPage / addPageToList / createPageId", () => {
  it("builds a schema-valid page with a starter hero section", () => {
    const page = buildPage({
      pageId: "page-new",
      sectionId: "hero-new",
      title: "Services",
      slug: "/services",
    });
    expect(page.id).toBe("page-new");
    expect(page.title).toBe("Services");
    expect(page.slug).toBe("/services");
    expect(page.sections).toHaveLength(1);
    expect(page.sections[0]).toMatchObject({
      id: "hero-new",
      type: "hero",
      order: 1,
      visible: true,
    });
  });

  it("appends without mutating the input array", () => {
    const pages = makePages();
    const next = addPageToList(pages, buildPage({
      pageId: "page-new",
      sectionId: "hero-new",
      title: "New",
      slug: "/new",
    }));
    expect(next).toHaveLength(4);
    expect(pages).toHaveLength(3);
    expect(next[3].id).toBe("page-new");
  });

  it("creates unique page ids", () => {
    const a = createPageId();
    const b = createPageId();
    expect(a).not.toBe(b);
    expect(a.startsWith("page-")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renamePageInList
// ---------------------------------------------------------------------------

describe("renamePageInList", () => {
  it("renames the title and re-derives the slug", () => {
    const result = renamePageInList({
      pages: makePages(),
      pageId: "page-2",
      title: "Our Story",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.value.pages.find((p) => p.id === "page-2")!;
    expect(renamed.title).toBe("Our Story");
    expect(renamed.slug).toBe("/our-story");
    expect(result.value.changed).toBe(true);
  });

  it("keeps the slug unique against other pages", () => {
    const result = renamePageInList({
      pages: makePages(),
      pageId: "page-3",
      title: "About",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const renamed = result.value.pages.find((p) => p.id === "page-3")!;
    expect(renamed.title).toBe("About");
    expect(renamed.slug).toBe("/about-2");
  });

  it("does not mutate the input array on change", () => {
    const pages = makePages();
    renamePageInList({ pages, pageId: "page-2", title: "Story" });
    expect(pages.find((p) => p.id === "page-2")!.title).toBe("About");
  });

  it("returns changed:false when nothing changes", () => {
    const result = renamePageInList({
      pages: makePages(),
      pageId: "page-2",
      title: "About",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.changed).toBe(false);
  });

  it("fails with PAGE_NOT_FOUND for an unknown page", () => {
    const result = renamePageInList({
      pages: makePages(),
      pageId: "missing",
      title: "New",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("fails with INVALID_PAGE_TITLE for an empty title", () => {
    const result = renamePageInList({
      pages: makePages(),
      pageId: "page-2",
      title: "   ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_PAGE_TITLE");
  });
});

// ---------------------------------------------------------------------------
// deletePageFromList
// ---------------------------------------------------------------------------

describe("deletePageFromList", () => {
  it("deletes a middle page and selects the next", () => {
    const result = deletePageFromList(makePages(), "page-2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pages.map((p) => p.id)).toEqual(["page-1", "page-3"]);
    expect(result.value.nextSelection).toBe("page-3");
  });

  it("deletes the last page and selects the previous", () => {
    const result = deletePageFromList(makePages(), "page-3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nextSelection).toBe("page-2");
  });

  it("refuses to delete the final page", () => {
    const result = deletePageFromList([makePage()], "page-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANNOT_DELETE_LAST_PAGE");
  });

  it("fails with PAGE_NOT_FOUND for an unknown page", () => {
    const result = deletePageFromList(makePages(), "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("does not mutate the input array", () => {
    const pages = makePages();
    deletePageFromList(pages, "page-2");
    expect(pages).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// movePageToIndex
// ---------------------------------------------------------------------------

describe("movePageToIndex", () => {
  it("moves a page to an absolute index", () => {
    const result = movePageToIndex(makePages(), "page-3", 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pages.map((p) => p.id)).toEqual([
      "page-3",
      "page-1",
      "page-2",
    ]);
    expect(result.value.activeIndex).toBe(0);
    expect(result.value.changed).toBe(true);
  });

  it("is a no-op at the same index", () => {
    const result = movePageToIndex(makePages(), "page-2", 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.changed).toBe(false);
  });

  it("rejects out-of-bounds indices", () => {
    const result = movePageToIndex(makePages(), "page-2", 99);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANNOT_MOVE_OUT_OF_BOUNDS");
  });

  it("fails with PAGE_NOT_FOUND for an unknown page", () => {
    const result = movePageToIndex(makePages(), "missing", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });
});
