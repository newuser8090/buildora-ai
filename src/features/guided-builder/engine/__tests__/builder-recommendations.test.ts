// ---------------------------------------------------------------------------
// Builder recommendations — engine tests (Phase N, spec §26)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getBuilderRecommendations } from "../builder-recommendations";
import type { RecommendationContext } from "../builder-recommendations";

function ctx(overrides: Partial<RecommendationContext>): RecommendationContext {
  return {
    siteType: "generic",
    pageTitle: "Home",
    sectionTypes: [],
    sections: [],
    pageCount: 1,
    ...overrides,
  };
}

function section(type: string, props: Record<string, unknown> = {}) {
  return { type, props };
}

const hero = section("hero", {
  headline: "Build something",
  subheadline: "A short line",
  primaryCta: { text: "Get Started" },
});

const header = section("header", {
  logoText: "Brand",
  navLinks: [{ text: "Home", href: "/" }],
});

const features = section("features", {
  title: "What we do",
  features: [
    { title: "A", description: "Does things", icon: "Zap" },
    { title: "B", description: "", icon: "Zap" },
  ],
});

const pricing = section("pricing", { title: "Pricing", plans: [] });

const cta = section("cta", { headline: "Contact us", ctaText: "Get in touch" });

const footer = section("footer", { text: "© Brand" });

describe("builder recommendations", () => {
  it("suggests the essential three for a blank page", () => {
    const result = getBuilderRecommendations(ctx({}));
    const ids = result.map((r) => r.id);
    expect(ids).toContain("rec-add-hero");
    expect(ids).toContain("rec-add-header");
    expect(ids).toContain("rec-add-footer");
  });

  it("suggests 'explain what you offer' after a hero without features", () => {
    const result = getBuilderRecommendations(
      ctx({ sectionTypes: ["hero"], sections: [hero] }),
    );
    expect(result.map((r) => r.id)).toContain("rec-add-features");
  });

  it("does not suggest features when features already exist", () => {
    const result = getBuilderRecommendations(
      ctx({ sectionTypes: ["hero", "features"], sections: [hero, features] }),
    );
    expect(result.map((r) => r.id)).not.toContain("rec-add-features");
  });

  it("suggests a next step when there is no clear action", () => {
    const noAction = getBuilderRecommendations(
      ctx({
        sectionTypes: ["hero"],
        sections: [section("hero", { headline: "Hi", subheadline: "" })],
      }),
    );
    expect(noAction.map((r) => r.id)).toContain("rec-add-cta");

    const withHeroCta = getBuilderRecommendations(
      ctx({
        sectionTypes: ["hero"],
        sections: [section("hero", { headline: "Hi", primaryCta: { text: "Go" } })],
      }),
    );
    expect(withHeroCta.map((r) => r.id)).not.toContain("rec-add-cta");
  });

  it("suggests FAQ after pricing without one", () => {
    const result = getBuilderRecommendations(
      ctx({ sectionTypes: ["pricing"], sections: [pricing] }),
    );
    expect(result.map((r) => r.id)).toContain("rec-add-faq");
  });

  it("suggests bottom information when the footer is missing", () => {
    const result = getBuilderRecommendations(
      ctx({ sectionTypes: ["hero", "features"], sections: [hero, features] }),
    );
    expect(result.map((r) => r.id)).toContain("rec-add-footer");
  });

  it("never suggests destructive actions", () => {
    const result = getBuilderRecommendations(
      ctx({ sectionTypes: ["hero", "features", "cta"], sections: [hero, features, cta] }),
    );
    for (const suggestion of result) {
      expect(["add-section", "edit-section", "add-page", "improve-content", "complete-setting"]).toContain(
        suggestion.type,
      );
    }
  });

  it("suggests a shorter main message for very long headlines", () => {
    const long = section("hero", {
      headline: "x".repeat(120),
      primaryCta: { text: "Go" },
    });
    const result = getBuilderRecommendations(
      ctx({ sectionTypes: ["hero"], sections: [long] }),
    );
    expect(result.map((r) => r.id)).toContain("rec-shorten-headline");
  });

  it("applies category-specific rules", () => {
    const business = getBuilderRecommendations(
      ctx({ siteType: "business", sectionTypes: ["hero"], sections: [hero] }),
    );
    expect(business.map((r) => r.id)).toContain("rec-category-features");

    const store = getBuilderRecommendations(
      ctx({ siteType: "store", sectionTypes: ["hero", "features"], sections: [hero, features] }),
    );
    expect(store.map((r) => r.id)).toContain("rec-category-pricing");
  });

  it("suggests adding a page only when the site has content and one page", () => {
    const result = getBuilderRecommendations(
      ctx({
        sectionTypes: ["header", "hero", "features", "cta", "footer"],
        sections: [header, hero, features, cta, footer],
        pageCount: 1,
      }),
    );
    expect(result.map((r) => r.id)).toContain("rec-add-page");

    const multi = getBuilderRecommendations(
      ctx({
        sectionTypes: ["header", "hero", "features", "cta", "footer"],
        sections: [header, hero, features, cta, footer],
        pageCount: 2,
      }),
    );
    expect(multi.map((r) => r.id)).not.toContain("rec-add-page");
  });

  it("orders by priority deterministically", () => {
    const result = getBuilderRecommendations(ctx({}));
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i - 1].priority).toBeLessThanOrEqual(result[i].priority);
    }
    const again = getBuilderRecommendations(ctx({}));
    expect(result.map((r) => r.id)).toEqual(again.map((r) => r.id));
  });

  it("filters dismissed suggestions", () => {
    const result = getBuilderRecommendations(
      ctx({ dismissedIds: ["rec-add-hero"] }),
    );
    expect(result.map((r) => r.id)).not.toContain("rec-add-hero");
  });

  it("caps output", () => {
    const result = getBuilderRecommendations(ctx({ limit: 2 }));
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("produces nothing for a fully complete homepage", () => {
    const result = getBuilderRecommendations(
      ctx({
        sectionTypes: ["header", "hero", "features", "cta", "footer"],
        sections: [header, hero, features, cta, footer],
        pageCount: 2,
      }),
    );
    // Only low-priority generic suggestions remain (mobile preview etc.)
    expect(result.some((r) => r.id === "rec-add-hero")).toBe(false);
    expect(result.some((r) => r.id === "rec-add-features")).toBe(false);
    expect(result.some((r) => r.id === "rec-add-cta")).toBe(false);
    expect(result.some((r) => r.id === "rec-add-footer")).toBe(false);
  });

  it("does not mutate input", () => {
    const sections = [hero, features];
    const before = JSON.stringify(sections);
    getBuilderRecommendations(
      ctx({ sectionTypes: ["hero", "features"], sections }),
    );
    expect(JSON.stringify(sections)).toBe(before);
  });
});
