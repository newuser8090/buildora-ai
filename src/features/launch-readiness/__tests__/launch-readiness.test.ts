// ---------------------------------------------------------------------------
// Launch readiness — canonical engine tests (Phase P7)
//
// Every rule is tested individually; score determinism, deductions, and the
// blocked state are also covered.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getLaunchReadinessReport, hasUnpublishedChanges } from "../engine/launch-readiness";
import type { LaunchReadinessReport } from "../types";
import { makeProject, makeBareProject, makeAsset, makeTheme } from "./helpers";

function report(project = makeProject(), ctx = {}): LaunchReadinessReport {
  return getLaunchReadinessReport(project, ctx);
}

function byId(r: LaunchReadinessReport, id: string) {
  return r.checks.find((c) => c.id === id);
}

function findStatus(r: LaunchReadinessReport, id: string) {
  const check = byId(r, id);
  expect(check).toBeDefined();
  return check!.status;
}

// ---------------------------------------------------------------------------
// Site basics
// ---------------------------------------------------------------------------

describe("site basics checks", () => {
  it("site-name fails when missing and passes when present", () => {
    expect(findStatus(report(makeBareProject()), "site-name")).toBe("fail");
    expect(findStatus(report(), "site-name")).toBe("pass");
  });

  it("site-description warns when missing", () => {
    expect(findStatus(report(makeBareProject()), "site-description")).toBe("warning");
    expect(findStatus(report(), "site-description")).toBe("pass");
  });

  it("site-favicon warns when absent or unresolvable", () => {
    expect(findStatus(report(makeBareProject()), "site-favicon")).toBe("warning");
    const broken = makeProject({ siteSettings: { siteName: "X", favicon: { assetId: "missing" } } });
    expect(findStatus(report(broken), "site-favicon")).toBe("warning");
    expect(findStatus(report(), "site-favicon")).toBe("pass");
  });

  it("site-language is info by default and pass when set", () => {
    expect(findStatus(report(makeBareProject()), "site-language")).toBe("info");
    expect(findStatus(report(), "site-language")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

describe("pages checks", () => {
  it("home-page fails when no pages exist", () => {
    const r = report(makeProject({ pages: [] }));
    expect(findStatus(r, "home-page")).toBe("fail");
    expect(byId(r, "home-page")!.severity).toBe("critical");
  });

  it("page-routes fails on duplicate slugs", () => {
    const dup = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A" }, styles: {} }] },
        { id: "p2", title: "Home", slug: "/", sections: [{ id: "s2", type: "hero", order: 1, visible: true, props: { headline: "B" }, styles: {} }] },
      ],
    });
    expect(findStatus(report(dup), "page-routes")).toBe("fail");
    expect(findStatus(report(), "page-routes")).toBe("pass");
  });

  it("empty-pages warns when a page has no visible content", () => {
    const empty = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [] },
        { id: "p2", title: "About", slug: "/about", sections: [{ id: "s2", type: "hero", order: 1, visible: true, props: { headline: "B" }, styles: {} }] },
      ],
    });
    expect(findStatus(report(empty), "empty-pages")).toBe("warning");
    expect(findStatus(report(), "empty-pages")).toBe("pass");
  });

  it("page-titles warns when a page has no name", () => {
    const untitled = makeProject({
      pages: [
        { id: "p1", title: "", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A" }, styles: {} }] },
      ],
    });
    expect(findStatus(report(untitled), "page-titles")).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe("navigation checks", () => {
  it("nav-exists is info for a single page and warning for multi-page without a menu", () => {
    expect(findStatus(report(makeBareProject()), "nav-exists")).toBe("info");
    const multiNoNav = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A" }, styles: {} }] },
        { id: "p2", title: "About", slug: "/about", sections: [{ id: "s2", type: "hero", order: 1, visible: true, props: { headline: "B" }, styles: {} }] },
      ],
    });
    expect(findStatus(report(multiNoNav), "nav-exists")).toBe("warning");
    expect(findStatus(report(), "nav-exists")).toBe("pass");
  });

  it("nav-routes warns when a menu link points to a missing page", () => {
    const broken = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "X", navLinks: [{ text: "Nope", href: "/missing" }] }, styles: {} },
            { id: "s2", type: "hero", order: 2, visible: true, props: { headline: "A" }, styles: {} },
          ],
        },
      ],
    });
    expect(findStatus(report(broken), "nav-routes")).toBe("warning");
  });

  it("nav-orphans is info when a non-home page has no menu link", () => {
    const orphan = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A" }, styles: {} }] },
        { id: "p2", title: "About", slug: "/about", sections: [{ id: "s2", type: "hero", order: 1, visible: true, props: { headline: "B" }, styles: {} }] },
      ],
    });
    expect(findStatus(report(orphan), "nav-orphans")).toBe("info");
  });
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

describe("content checks", () => {
  it("placeholder-text warns on draft copy", () => {
    const draft = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Lorem ipsum dolor sit" }, styles: {} }] },
      ],
    });
    expect(findStatus(report(draft), "placeholder-text")).toBe("warning");
    expect(findStatus(report(), "placeholder-text")).toBe("pass");
  });

  it("empty-headings warns when a section has no heading", () => {
    const noHeading = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] },
      ],
    });
    expect(findStatus(report(noHeading), "empty-headings")).toBe("warning");
  });

  it("cta-exists is info without any button and pass with buttons", () => {
    const noCta = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "features", order: 1, visible: true, props: { title: "Feat", features: [] }, styles: {} }] },
      ],
    });
    expect(findStatus(report(noCta), "cta-exists")).toBe("info");
    expect(findStatus(report(), "cta-exists")).toBe("pass");
  });

  it("duplicate-headings is info when a heading repeats 3+ times", () => {
    const dupes = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Same" }, styles: {} },
          { id: "s2", type: "cta", order: 2, visible: true, props: { title: "Same" }, styles: {} },
          { id: "s3", type: "features", order: 3, visible: true, props: { title: "Same", features: [] }, styles: {} },
        ] },
      ],
    });
    expect(findStatus(report(dupes), "duplicate-headings")).toBe("info");
    expect(findStatus(report(), "duplicate-headings")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

describe("mobile checks", () => {
  it("mobile-overflow warns on very wide fixed styles", () => {
    const wide = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A" }, styles: { base: "width: 1200px" } },
          ],
        },
      ],
    });
    expect(findStatus(report(wide), "mobile-overflow")).toBe("warning");
    expect(findStatus(report(), "mobile-overflow")).toBe("pass");
  });

  it("mobile-preview is info by default and pass after previewing on phone", () => {
    expect(findStatus(report(), "mobile-preview")).toBe("info");
    expect(findStatus(report(makeProject(), { hasPreviewedMobile: true }), "mobile-preview")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

describe("accessibility checks", () => {
  it("image-alt warns when images lack alt text", () => {
    const noAlt = makeProject({
      assets: [makeAsset({ id: "img" })],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A", heroImage: { assetId: "img" } }, styles: {} },
          ],
        },
      ],
    });
    expect(findStatus(report(noAlt), "image-alt")).toBe("warning");
    expect(findStatus(report(), "image-alt")).toBe("pass");
  });

  it("link-labels warns when links have no text", () => {
    const unlabeled = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "X", navLinks: [{ href: "/about" }] }, styles: {} },
            { id: "s2", type: "hero", order: 2, visible: true, props: { headline: "A" }, styles: {} },
          ],
        },
      ],
    });
    expect(findStatus(report(unlabeled), "link-labels")).toBe("warning");
  });

  it("heading-hierarchy is info when a page lacks a hero heading", () => {
    const noHero = makeProject({
      pages: [
        { id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "features", order: 1, visible: true, props: { title: "F", features: [] }, styles: {} }] },
      ],
    });
    expect(findStatus(report(noHero), "heading-hierarchy")).toBe("info");
    expect(findStatus(report(), "heading-hierarchy")).toBe("pass");
  });

  it("a11y-disclaimer is always present as info", () => {
    const r = report();
    const disclaimer = byId(r, "a11y-disclaimer");
    expect(disclaimer).toBeDefined();
    expect(disclaimer!.status).toBe("info");
    expect(disclaimer!.weight).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Search & sharing
// ---------------------------------------------------------------------------

describe("search & sharing checks", () => {
  it("seo-title passes when a distinct search title is set", () => {
    expect(findStatus(report(), "seo-title")).toBe("pass");
    expect(findStatus(report(makeBareProject()), "seo-title")).toBe("warning");
  });

  it("seo-description warns when missing", () => {
    expect(findStatus(report(makeBareProject()), "seo-description")).toBe("warning");
  });

  it("social-image passes when a share image exists", () => {
    expect(findStatus(report(), "social-image")).toBe("pass");
    expect(findStatus(report(makeBareProject()), "social-image")).toBe("info");
  });

  it("page-meta is info when pages lack search titles", () => {
    const noMeta = makeProject({ pages: makeProject().pages.map((p) => ({ ...p, meta: undefined })) });
    expect(findStatus(report(noMeta), "page-meta")).toBe("info");
  });

  it("noindex warns when the site is hidden from search engines", () => {
    const hidden = makeProject({ siteSettings: { siteName: "X", seo: { robotsIndex: false } } });
    expect(findStatus(report(hidden), "noindex")).toBe("warning");
    expect(findStatus(report(), "noindex")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Links & actions
// ---------------------------------------------------------------------------

describe("links & actions checks", () => {
  it("unsafe-hrefs hard-fails on javascript: links", () => {
    const unsafe = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A", primaryCta: { text: "Bad", href: "javascript:alert(1)" } }, styles: {} },
          ],
        },
      ],
    });
    const r = report(unsafe);
    expect(findStatus(r, "unsafe-hrefs")).toBe("fail");
    expect(byId(r, "unsafe-hrefs")!.severity).toBe("critical");
    expect(r.blocked).toBe(true);
  });

  it("internal-links warns when a link points to a missing page", () => {
    const broken = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "A", primaryCta: { text: "Go", href: "/does-not-exist" } }, styles: {} },
          ],
        },
      ],
    });
    expect(findStatus(report(broken), "internal-links")).toBe("warning");
  });

  it("button-targets warns when a button has no meaningful target", () => {
    const noTarget = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "cta", order: 1, visible: true, props: { title: "CTA", ctaText: "Go", ctaHref: "#" }, styles: {} },
          ],
        },
      ],
    });
    expect(findStatus(report(noTarget), "button-targets")).toBe("warning");
    expect(findStatus(report(), "button-targets")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe("performance checks", () => {
  it("image-sizes warns when an asset exceeds 2 MB", () => {
    const big = makeProject({
      assets: [makeAsset({ id: "big", name: "huge.png", size: 3 * 1024 * 1024 })],
    });
    expect(findStatus(report(big), "image-sizes")).toBe("warning");
    expect(findStatus(report(), "image-sizes")).toBe("pass");
  });

  it("section-count is info when there are more than 40 sections", () => {
    const manySections = Array.from({ length: 42 }, (_, i) => ({
      id: `s${i}`, type: "features" as const, order: i + 1, visible: true,
      props: { title: `F${i}`, features: [] }, styles: {},
    }));
    const big = makeProject({
      pages: [{ id: "p1", title: "Home", slug: "/", sections: manySections }],
    });
    expect(findStatus(report(big), "section-count")).toBe("info");
    expect(findStatus(report(), "section-count")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Publish readiness
// ---------------------------------------------------------------------------

describe("publish checks", () => {
  it("export-valid fails on a project with a missing referenced asset", () => {
    const broken = makeProject({
      assets: [],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "X", logoImage: { assetId: "missing-logo" }, navLinks: [] }, styles: {} },
            { id: "s2", type: "hero", order: 2, visible: true, props: { headline: "A" }, styles: {} },
          ],
        },
      ],
    });
    const r = report(broken);
    expect(findStatus(r, "export-valid")).toBe("fail");
    expect(r.blocked).toBe(true);
    expect(r.blockers.length).toBeGreaterThan(0);
  });

  it("form-behavior warns when a custom block contains form nodes", () => {
    const form = makeProject({
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            {
              id: "s1", type: "custom-block", order: 1, visible: true,
              props: { tree: { nodes: { n1: { props: {} }, n2: { type: "form", props: {} } } } },
              styles: {},
            },
          ],
        },
      ],
    });
    expect(findStatus(report(form), "form-behavior")).toBe("warning");
    expect(findStatus(report(), "form-behavior")).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// Score & report integrity
// ---------------------------------------------------------------------------

describe("score", () => {
  it("is deterministic across calls", () => {
    const a = report();
    const b = report();
    expect(a.score).toBe(b.score);
    expect(JSON.stringify(a.checks)).toBe(JSON.stringify(b.checks));
  });

  it("perfect project scores 100", () => {
    const r = report(makeProject(), { hasPreviewedMobile: true });
    expect(r.score).toBe(100);
    expect(r.blocked).toBe(false);
  });

  it("bare project scores well below 100", () => {
    const r = report(makeBareProject());
    expect(r.score).toBeLessThan(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it("score improves when issues are fixed", () => {
    const broken = report(makeBareProject());
    const fixed = report(makeProject(), { hasPreviewedMobile: true });
    expect(fixed.score).toBeGreaterThan(broken.score);
  });

  it("deductions are explained by per-check weights", () => {
    const r = report(makeBareProject());
    const failing = r.checks.filter((c) => c.status === "fail");
    // Every failing check explains its deduction via title/explanation.
    for (const check of failing) {
      expect(check.title.length).toBeGreaterThan(0);
      expect(check.explanation.length).toBeGreaterThan(0);
      expect(check.suggestedAction.length).toBeGreaterThan(0);
    }
  });

  it("categories cover all ten areas and sum consistently", () => {
    const r = report();
    expect(r.categories).toHaveLength(10);
    const catIds = r.categories.map((c) => c.id);
    expect(catIds).toEqual([
      "site-basics", "pages", "navigation", "content", "mobile",
      "accessibility", "search-sharing", "links-actions", "performance", "publish",
    ]);
    const totalPossible = r.categories.reduce((n, c) => n + c.possible, 0);
    const scoredPossible = r.checks.filter((c) => c.weight > 0).reduce((n, c) => n + c.weight, 0);
    expect(totalPossible).toBe(scoredPossible);
  });

  it("does not include duplicate findings for the same id", () => {
    const r = report(makeProject({ theme: makeTheme() }));
    const ids = r.checks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exposes strong and couldImprove summaries", () => {
    const r = report(makeBareProject());
    expect(r.strong.length).toBeGreaterThan(0);
    expect(r.couldImprove.length).toBeGreaterThan(0);
  });

  it("does not mutate the input project", () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    getLaunchReadinessReport(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Unpublished-changes helper
// ---------------------------------------------------------------------------

describe("hasUnpublishedChanges", () => {
  it("is false when there is no active deployment", () => {
    expect(hasUnpublishedChanges("abc", undefined)).toBe(false);
  });

  it("is false when hashes match", () => {
    expect(hasUnpublishedChanges("abc", "abc")).toBe(false);
  });

  it("is true when hashes differ", () => {
    expect(hasUnpublishedChanges("abc", "def")).toBe(true);
  });
});
