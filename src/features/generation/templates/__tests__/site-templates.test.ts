// ---------------------------------------------------------------------------
// Phase P22-I — deterministic site template tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { getSiteTemplatePages } from "../site-templates";
import {
  GenerationPlanSchema,
  SITE_MAX_PAGES,
  SITE_MIN_PAGES,
} from "../../schemas/generation-plan-schema";
import { SUPPORTED_SECTION_TYPES } from "../../providers/generation-provider";
import type { WebsiteType } from "../../types/generation-plan";

const SITE_TYPES: WebsiteType[] = [
  "saas",
  "ecommerce",
  "restaurant",
  "portfolio",
  "agency",
];

describe("site templates — Phase P22-I", () => {
  it("produces 2–6 pages for every supported site type", () => {
    for (const type of SITE_TYPES) {
      const pages = getSiteTemplatePages(type, "Acme");
      expect(pages.length).toBeGreaterThanOrEqual(SITE_MIN_PAGES);
      expect(pages.length).toBeLessThanOrEqual(SITE_MAX_PAGES);
    }
  });

  it("is deterministic (identical input → identical output)", () => {
    const a = getSiteTemplatePages("saas", "Acme");
    const b = getSiteTemplatePages("saas", "Acme");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("injects the brand into the content", () => {
    const pages = getSiteTemplatePages("saas", "Nimbus");
    expect(JSON.stringify(pages)).toContain("Nimbus");
  });

  it("has the homepage first with the root slug and unique non-root slugs", () => {
    for (const type of SITE_TYPES) {
      const pages = getSiteTemplatePages(type, "Acme");
      expect(pages[0].slug).toBe("/");
      expect(pages[0].title).toBe("Home");
      const slugs = pages.map((p) => p.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs.slice(1)) {
        expect(slug).toMatch(/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/);
      }
    }
  });

  it("gives every page a header + footer with only supported section types and 1..N orders", () => {
    for (const type of SITE_TYPES) {
      for (const page of getSiteTemplatePages(type, "Acme")) {
        const types = page.sections.map((s) => s.type);
        expect(types).toContain("header");
        expect(types).toContain("footer");
        for (const t of types) {
          expect(SUPPORTED_SECTION_TYPES).toContain(t);
        }
        page.sections.forEach((s, i) => expect(s.order).toBe(i + 1));
      }
    }
  });

  it("points header navigation at generated pages (valid cross-page hrefs)", () => {
    for (const type of SITE_TYPES) {
      const pages = getSiteTemplatePages(type, "Acme");
      const slugs = pages.map((p) => p.slug);
      for (const page of pages) {
        const header = page.sections.find((s) => s.type === "header")!;
        const navLinks = (header.props.navLinks ?? []) as Array<{
          text: string;
          href: string;
        }>;
        expect(navLinks.length).toBeGreaterThanOrEqual(2);
        for (const link of navLinks) {
          expect(typeof link.text).toBe("string");
          // Internal page hrefs must resolve to a generated page.
          if (link.href.startsWith("/")) {
            expect(slugs).toContain(link.href);
          } else if (link.href !== "#" && !link.href.startsWith("mailto:")) {
            expect(link.href).toMatch(/^(https?:|\/\/)/i);
          }
        }
      }
    }
  });

  it("validates as a GenerationPlan for every site type", () => {
    for (const type of SITE_TYPES) {
      const pages = getSiteTemplatePages(type, "Acme");
      const plan = {
        websiteType: type,
        brandName: "Acme",
        theme: "modern",
        sections: pages[0].sections,
        pages,
      };
      const result = GenerationPlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
    }
  });
});
