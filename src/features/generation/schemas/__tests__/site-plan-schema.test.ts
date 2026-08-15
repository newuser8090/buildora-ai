// ---------------------------------------------------------------------------
// Phase P22-I — GenerationPlanSchema site-plan validation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  GenerationPlanSchema,
  PlannedPageSchema,
  SITE_MAX_PAGES,
  SITE_MIN_PAGES,
} from "../generation-plan-schema";

const validSection = { type: "hero", order: 1, props: { headline: "Hi" } };

function makeSitePlan(overrides: Record<string, unknown> = {}) {
  return {
    websiteType: "saas",
    brandName: "Acme",
    theme: "modern",
    sections: [validSection],
    pages: [
      { title: "Home", slug: "/", sections: [validSection] },
      { title: "About", slug: "/about", sections: [validSection] },
    ],
    ...overrides,
  };
}

describe("GenerationPlanSchema — Phase P22-I site plans", () => {
  it("accepts a valid multi-page site plan", () => {
    const result = GenerationPlanSchema.safeParse(makeSitePlan());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pages).toHaveLength(2);
    }
  });

  it("accepts a plan at the upper page bound (6)", () => {
    const pages = Array.from({ length: SITE_MAX_PAGES }, (_, i) => ({
      title: `Page ${i + 1}`,
      slug: i === 0 ? "/" : `/page-${i + 1}`,
      sections: [validSection],
    }));
    const result = GenerationPlanSchema.safeParse(makeSitePlan({ pages }));
    expect(result.success).toBe(true);
  });

  it(`rejects fewer than ${SITE_MIN_PAGES} pages`, () => {
    const pages = [{ title: "Home", slug: "/", sections: [validSection] }];
    const result = GenerationPlanSchema.safeParse(makeSitePlan({ pages }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain("pages");
    }
  });

  it(`rejects more than ${SITE_MAX_PAGES} pages`, () => {
    const pages = Array.from({ length: SITE_MAX_PAGES + 1 }, (_, i) => ({
      title: `Page ${i + 1}`,
      slug: i === 0 ? "/" : `/page-${i + 1}`,
      sections: [validSection],
    }));
    const result = GenerationPlanSchema.safeParse(makeSitePlan({ pages }));
    expect(result.success).toBe(false);
  });

  it("rejects a page without a title", () => {
    const result = PlannedPageSchema.safeParse({
      slug: "/about",
      sections: [validSection],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid slugs (uppercase, spaces, trailing slash, reserved)", () => {
    for (const slug of ["About", "/About", "/about us", "/about/", "//", "/api", "/about..x"]) {
      const result = PlannedPageSchema.safeParse({
        title: "About",
        slug,
        sections: [validSection],
      });
      expect(result.success).toBe(false);
    }
  });

  it("rejects a page without sections", () => {
    const result = PlannedPageSchema.safeParse({
      title: "About",
      slug: "/about",
      sections: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a page with an empty section type", () => {
    const result = PlannedPageSchema.safeParse({
      title: "About",
      slug: "/about",
      sections: [{ type: "", order: 1, props: {} }],
    });
    expect(result.success).toBe(false);
  });

  it("keeps ordinary single-page create plans valid without pages", () => {
    const result = GenerationPlanSchema.safeParse({
      websiteType: "saas",
      brandName: "Acme",
      theme: "modern",
      sections: [validSection],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pages).toBeUndefined();
    }
  });

  it("rejects malformed provider output (non-object pages)", () => {
    const result = GenerationPlanSchema.safeParse(
      makeSitePlan({ pages: "not-an-array" }),
    );
    expect(result.success).toBe(false);
  });
});
