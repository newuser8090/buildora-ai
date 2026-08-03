// ---------------------------------------------------------------------------
// Routing — slug validation, route table, link resolution
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Page } from "@/types/project";
import {
  validateSlug,
  isReservedSlugSegment,
  slugToRouteUrl,
  slugToRoutePath,
  computePageRoutes,
  resolveInternalHref,
  validateRoutingForExport,
  ROOT_SLUG,
} from "../routes";

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
// validateSlug
// ---------------------------------------------------------------------------

describe("validateSlug", () => {
  it("accepts the root slug and simple kebab slugs", () => {
    expect(validateSlug("/").valid).toBe(true);
    expect(validateSlug("/about").valid).toBe(true);
    expect(validateSlug("/about-us").valid).toBe(true);
    expect(validateSlug("/about/team").valid).toBe(true);
  });

  it("rejects non-strings, empty values, and missing leading slash", () => {
    expect(validateSlug("").valid).toBe(false);
    expect(validateSlug(null).valid).toBe(false);
    expect(validateSlug(42).valid).toBe(false);
    expect(validateSlug("about").valid).toBe(false);
  });

  it("rejects trailing slashes and double slashes", () => {
    expect(validateSlug("/about/").valid).toBe(false);
    expect(validateSlug("/about//team").valid).toBe(false);
  });

  it("rejects unsafe and non-kebab segments", () => {
    expect(validateSlug("/About").valid).toBe(false);
    expect(validateSlug("/about space").valid).toBe(false);
    expect(validateSlug("/about.team").valid).toBe(false);
    expect(validateSlug("/../secret").valid).toBe(false);
    expect(validateSlug("/.").valid).toBe(false);
    expect(validateSlug("/about_team").valid).toBe(false);
  });

  it("rejects reserved segments", () => {
    expect(validateSlug("/api").valid).toBe(false);
    expect(validateSlug("/_next").valid).toBe(false);
    expect(validateSlug("/_private").valid).toBe(false);
    expect(validateSlug("/[slug]").valid).toBe(false);
    expect(validateSlug("/(group)").valid).toBe(false);
  });

  it("isReservedSlugSegment flags Next.js reserved names", () => {
    expect(isReservedSlugSegment("api")).toBe(true);
    expect(isReservedSlugSegment("_next")).toBe(true);
    expect(isReservedSlugSegment("_private")).toBe(true);
    expect(isReservedSlugSegment("[x]")).toBe(true);
    expect(isReservedSlugSegment("(x)")).toBe(true);
    expect(isReservedSlugSegment("about")).toBe(false);
    expect(isReservedSlugSegment("api-2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// slugToRouteUrl / slugToRoutePath
// ---------------------------------------------------------------------------

describe("slugToRouteUrl / slugToRoutePath", () => {
  it("maps the root slug to the homepage file", () => {
    expect(slugToRouteUrl(ROOT_SLUG)).toBe("/");
    expect(slugToRoutePath(ROOT_SLUG)).toBe("app/page.tsx");
  });

  it("maps simple and nested slugs to route files", () => {
    expect(slugToRouteUrl("/about")).toBe("/about");
    expect(slugToRoutePath("/about")).toBe("app/about/page.tsx");
    expect(slugToRoutePath("/about/team")).toBe("app/about/team/page.tsx");
  });

  it("normalizes trailing slashes", () => {
    expect(slugToRouteUrl("/about/")).toBe("/about");
  });
});

// ---------------------------------------------------------------------------
// computePageRoutes
// ---------------------------------------------------------------------------

describe("computePageRoutes", () => {
  it("always maps the first page to the root route", () => {
    const routes = computePageRoutes(makePages());
    expect(routes).toHaveLength(3);
    expect(routes[0]).toMatchObject({
      isHome: true,
      routeUrl: "/",
      filePath: "app/page.tsx",
    });
    expect(routes[1]).toMatchObject({
      isHome: false,
      routeUrl: "/about",
      filePath: "app/about/page.tsx",
    });
    expect(routes[2].filePath).toBe("app/contact/page.tsx");
  });

  it("keeps the homepage at the root even when its slug differs", () => {
    const pages = [makePage({ id: "home", slug: "/landing" }), makePage({ id: "p2", title: "About", slug: "/about" })];
    const routes = computePageRoutes(pages);
    expect(routes[0].routeUrl).toBe("/");
    expect(routes[0].filePath).toBe("app/page.tsx");
    expect(routes[1].routeUrl).toBe("/about");
  });
});

// ---------------------------------------------------------------------------
// resolveInternalHref
// ---------------------------------------------------------------------------

describe("resolveInternalHref", () => {
  const routes = computePageRoutes(makePages());

  it("keeps external and special protocol links unchanged", () => {
    expect(resolveInternalHref("https://example.com", routes)).toBe("https://example.com");
    expect(resolveInternalHref("mailto:hi@example.com", routes)).toBe("mailto:hi@example.com");
    expect(resolveInternalHref("tel:+123", routes)).toBe("tel:+123");
    expect(resolveInternalHref("#pricing", routes)).toBe("#pricing");
    expect(resolveInternalHref("", routes)).toBe("#");
    expect(resolveInternalHref(null, routes)).toBe("#");
  });

  it("resolves page slugs to their canonical routes", () => {
    expect(resolveInternalHref("/about", routes)).toBe("/about");
    expect(resolveInternalHref("/contact", routes)).toBe("/contact");
    // Bare path without a leading slash
    expect(resolveInternalHref("about", routes)).toBe("/about");
  });

  it("resolves the root and the homepage slug to the home route", () => {
    expect(resolveInternalHref("/", routes)).toBe("/");
  });

  it("preserves query strings and hashes on resolved links", () => {
    expect(resolveInternalHref("/about#team", routes)).toBe("/about#team");
    expect(resolveInternalHref("/about?utm=x", routes)).toBe("/about?utm=x");
  });

  it("keeps unknown internal paths unchanged", () => {
    expect(resolveInternalHref("/blog", routes)).toBe("/blog");
    expect(resolveInternalHref("/nope/deep", routes)).toBe("/nope/deep");
  });

  it("resolves the homepage slug to the root even when the slug differs", () => {
    const renamed = computePageRoutes([
      makePage({ id: "home", slug: "/landing" }),
      makePage({ id: "p2", title: "About", slug: "/about" }),
    ]);
    expect(resolveInternalHref("/landing", renamed)).toBe("/");
    expect(resolveInternalHref("/", renamed)).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// validateRoutingForExport
// ---------------------------------------------------------------------------

describe("validateRoutingForExport", () => {
  it("accepts a valid multi-page project", () => {
    expect(validateRoutingForExport(makePages())).toEqual([]);
  });

  it("flags invalid slugs", () => {
    const errors = validateRoutingForExport([
      makePage(),
      makePage({ id: "p2", title: "Bad", slug: "About Space" }),
    ]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("invalid slug");
  });

  it("flags a non-home page owning the root slug", () => {
    const errors = validateRoutingForExport([
      makePage(),
      makePage({ id: "p2", title: "Home Clone", slug: "/" }),
    ]);
    expect(errors.some((e) => e.includes("root slug"))).toBe(true);
  });

  it("flags duplicate routes among non-home pages", () => {
    const errors = validateRoutingForExport([
      makePage(),
      makePage({ id: "p2", title: "About", slug: "/about" }),
      makePage({ id: "p3", title: "About Two", slug: "/about" }),
    ]);
    expect(errors.some((e) => e.includes("share the route"))).toBe(true);
  });

  it("flags a non-home slug that shadows the homepage slug", () => {
    const errors = validateRoutingForExport([
      makePage({ id: "home", slug: "/landing" }),
      makePage({ id: "p2", title: "Landing Copy", slug: "/landing" }),
    ]);
    expect(errors.some((e) => e.includes("same slug as the homepage"))).toBe(true);
  });

  it("flags reserved slugs", () => {
    const errors = validateRoutingForExport([
      makePage(),
      makePage({ id: "p2", title: "API", slug: "/api" }),
    ]);
    expect(errors.some((e) => e.includes("reserved"))).toBe(true);
  });

  it("returns no errors for an empty project", () => {
    expect(validateRoutingForExport([])).toEqual([]);
  });
});
