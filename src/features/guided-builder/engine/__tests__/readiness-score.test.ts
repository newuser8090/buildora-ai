// ---------------------------------------------------------------------------
// Readiness score — engine tests (Phase N, spec §27)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getReadinessReport } from "../readiness-score";
import type { ReadinessContext, ReadinessSection } from "../readiness-score";

function ctx(overrides: Partial<ReadinessContext>): ReadinessContext {
  return {
    siteType: "generic",
    sections: [],
    pageTitle: "Home",
    pageMeta: null,
    pageCount: 1,
    ...overrides,
  };
}

function s(type: string, props: Record<string, unknown> = {}): ReadinessSection {
  return { type, props };
}

const completed: ReadinessSection[] = [
  s("header", { logoText: "Brand", navLinks: [{ text: "Home", href: "/" }] }),
  s("hero", {
    headline: "A clear main message",
    subheadline: "Supporting text here",
    primaryCta: { text: "Get Started" },
  }),
  s("features", {
    title: "What we offer",
    features: [
      { title: "A", description: "A real description", icon: "Zap" },
      { title: "B", description: "Another description", icon: "Zap" },
    ],
  }),
  s("faq", { title: "FAQ", items: [{ question: "Q", answer: "A" }] }),
  s("cta", { headline: "Contact us", ctaText: "Get in touch" }),
  s("footer", { text: "© Brand" }),
];

describe("readiness score", () => {
  it("scores a blank project very low", () => {
    const report = getReadinessReport(ctx({}));
    expect(report.score).toBeLessThan(25);
    expect(report.couldImprove.length).toBeGreaterThan(0);
  });

  it("scores a partially built project mid-range", () => {
    const report = getReadinessReport(
      ctx({
        sections: [
          s("hero", { headline: "A clear main message", primaryCta: { text: "Go" } }),
          s("footer", { text: "©" }),
        ],
        pageCount: 1,
      }),
    );
    expect(report.score).toBeGreaterThanOrEqual(15);
    expect(report.score).toBeLessThan(75);
  });

  it("scores a completed project high", () => {
    const report = getReadinessReport(
      ctx({ sections: completed, pageMeta: { title: "Home", description: "desc" }, pageCount: 2 }),
    );
    expect(report.score).toBeGreaterThanOrEqual(75);
    expect(report.strong.length).toBeGreaterThan(0);
  });

  it("stays within 0-100 boundaries", () => {
    const empty = getReadinessReport(ctx({}));
    const full = getReadinessReport(
      ctx({ sections: completed, pageMeta: { title: "x", description: "y" }, pageCount: 3 }),
    );
    expect(empty.score).toBeGreaterThanOrEqual(0);
    expect(full.score).toBeLessThanOrEqual(100);
  });

  it("excludes hidden sections (caller passes only visible ones)", () => {
    // A page with hero + features vs hero-only differ in trust/content.
    const withFeatures = getReadinessReport(
      ctx({
        sections: [
          s("hero", { headline: "H", subheadline: "S", primaryCta: { text: "Go" } }),
          s("features", { title: "T", features: [{ title: "A", description: "d", icon: "Zap" }] }),
        ],
      }),
    );
    const without = getReadinessReport(
      ctx({
        sections: [s("hero", { headline: "H", subheadline: "S", primaryCta: { text: "Go" } })],
      }),
    );
    expect(withFeatures.score).toBeGreaterThan(without.score);
  });

  it("considers multiple pages for navigation", () => {
    const single = getReadinessReport(
      ctx({ sections: completed, pageCount: 1 }),
    );
    const multi = getReadinessReport(
      ctx({ sections: completed, pageCount: 3 }),
    );
    expect(multi.score).toBeGreaterThan(single.score);
  });

  it("applies SEO basics from page meta", () => {
    const noMeta = getReadinessReport(ctx({ sections: completed, pageMeta: null }));
    const withMeta = getReadinessReport(
      ctx({ sections: completed, pageMeta: { title: "T", description: "D" } }),
    );
    expect(withMeta.score).toBeGreaterThan(noMeta.score);
  });

  it("never claims business performance", () => {
    const report = getReadinessReport(
      ctx({ sections: completed, pageMeta: { title: "T", description: "D" }, pageCount: 2 }),
    );
    const text = JSON.stringify(report).toLowerCase();
    expect(text.includes("sales")).toBe(false);
    expect(text.includes("revenue")).toBe(false);
    expect(text.includes("conversion")).toBe(false);
  });

  it("is deterministic for identical input", () => {
    const a = getReadinessReport(ctx({ sections: completed }));
    const b = getReadinessReport(ctx({ sections: completed }));
    expect(a.score).toBe(b.score);
    expect(a.categories).toEqual(b.categories);
  });

  it("does not mutate input", () => {
    const before = JSON.stringify(completed);
    getReadinessReport(ctx({ sections: completed }));
    expect(JSON.stringify(completed)).toBe(before);
  });
});
