// ---------------------------------------------------------------------------
// Phase P22-I — prompt analyzer: site-intent detection + site analysis
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  analyzePrompt,
  analyzeSitePrompt,
  detectSiteIntent,
} from "../prompt-analyzer";
import { SITE_MIN_PAGES, SITE_MAX_PAGES } from "../../schemas/generation-plan-schema";

describe("detectSiteIntent — Phase P22-I", () => {
  it("detects clear multi-page / site prompts", () => {
    const prompts = [
      "Build a multi-page SaaS website for Acme",
      "Build a multipage portfolio for Aanya",
      "Build a restaurant website with menu, about, and contact pages",
      "Create a website with about, pricing, and contact pages",
      "Build an ecommerce site with 5 pages",
      "I need an agency website with a services page and a contact page",
      "Create a portfolio with an about page",
      "Build a website with a shop page",
    ];
    for (const p of prompts) {
      expect(detectSiteIntent(p), p).toBe(true);
    }
  });

  it("leaves ordinary landing-page prompts as single-page create", () => {
    // These are the established create-mode prompts (prompt-matrix + E2E):
    // they must keep producing the existing single-page behavior.
    const prompts = [
      "Build a dark SaaS website for an AI meeting assistant called Huddle with blue accents",
      "Create a minimal portfolio for a product designer named Aanya",
      "Build a luxury restaurant website called Ember House with warm brown and cream colors",
      "Create a modern creative agency website called Northstar Studio",
      "Build an ecommerce homepage for a skincare brand called Lumiere with soft beige colors",
      "Build a website",
      "Create a luxury AI restaurant ecommerce portfolio",
      "Create a portfolio for 🚀 Arjun Creative Studio",
      "Build a website for شركة برمجيات عربية",
      "日本の高級レストランのウェブサイトを作成",
      "Build a modern SaaS website for TaskPilot",
    ];
    for (const p of prompts) {
      expect(detectSiteIntent(p), p).toBe(false);
    }
  });
});

describe("analyzeSitePrompt — Phase P22-I", () => {
  it("detects the website type from the prompt", () => {
    expect(
      analyzeSitePrompt("ecommerce website with shop and contact pages").websiteType,
    ).toBe("ecommerce");
    expect(
      analyzeSitePrompt("restaurant website with a menu page").websiteType,
    ).toBe("restaurant");
    expect(
      analyzeSitePrompt("portfolio website with a projects page").websiteType,
    ).toBe("portfolio");
    expect(
      analyzeSitePrompt("agency website with a services page").websiteType,
    ).toBe("agency");
    expect(
      analyzeSitePrompt("saas website with pricing and contact pages").websiteType,
    ).toBe("saas");
  });

  it("extracts the brand name", () => {
    expect(
      analyzeSitePrompt("Build a multi-page SaaS website called Nimbus").brandName,
    ).toBe("Nimbus");
  });

  it("produces 2–6 pages with the homepage first", () => {
    const plan = analyzeSitePrompt(
      "Build a multi-page restaurant website for Ember House with menu, about, and contact pages",
    );
    expect(plan.pages!.length).toBeGreaterThanOrEqual(SITE_MIN_PAGES);
    expect(plan.pages!.length).toBeLessThanOrEqual(SITE_MAX_PAGES);
    expect(plan.pages![0].slug).toBe("/");
    expect(plan.pages![0].title).toBe("Home");
    // The single-page `sections` surface stays populated (schema compat).
    expect(plan.sections.length).toBeGreaterThan(0);
  });

  it("keeps analyzePrompt single-page for ordinary prompts", () => {
    const plan = analyzePrompt("Build a dark SaaS website for Huddle");
    expect(plan.pages).toBeUndefined();
    expect(plan.sections.length).toBeGreaterThan(0);
  });
});
