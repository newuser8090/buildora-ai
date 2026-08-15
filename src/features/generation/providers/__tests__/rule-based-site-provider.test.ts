// ---------------------------------------------------------------------------
// Phase P22-I — rule-based provider: deterministic site generation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ruleBasedProvider } from "../rule-based-generation-provider";
import { GenerationPlanSchema } from "../../schemas/generation-plan-schema";

describe("ruleBasedProvider — Phase P22-I site mode", () => {
  it("generates a deterministic, schema-valid multi-page site plan", async () => {
    const result = await ruleBasedProvider.generatePlan({
      prompt:
        "Build a multi-page SaaS website for Nimbus with features, pricing, about, and contact pages",
      mode: "site",
    });
    expect(result.source).toBe("rule-based");
    expect(result.plan.pages!.length).toBeGreaterThanOrEqual(2);

    const check = GenerationPlanSchema.safeParse(result.plan);
    expect(check.success).toBe(true);
    if (check.success) {
      expect(check.data.pages![0].slug).toBe("/");
    }
  });

  it("is deterministic for the same prompt", async () => {
    const a = await ruleBasedProvider.generatePlan({
      prompt: "Build a multi-page restaurant website called Ember House with menu, about, and contact pages",
      mode: "site",
    });
    const b = await ruleBasedProvider.generatePlan({
      prompt: "Build a multi-page restaurant website called Ember House with menu, about, and contact pages",
      mode: "site",
    });
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
  });

  it("works for every supported website type", async () => {
    const prompts: Array<[string, string]> = [
      ["ecommerce", "multi-page ecommerce website with shop, about, and contact pages"],
      ["restaurant", "multi-page restaurant website with a menu page"],
      ["portfolio", "multi-page portfolio website with a projects page"],
      ["agency", "multi-page agency website with a services page"],
      ["saas", "multi-page saas website with pricing and contact pages"],
    ];
    for (const [type, prompt] of prompts) {
      const result = await ruleBasedProvider.generatePlan({
        prompt,
        mode: "site",
      });
      expect(result.plan.websiteType).toBe(type);
      expect(result.plan.pages!.length).toBeGreaterThanOrEqual(2);
      const check = GenerationPlanSchema.safeParse(result.plan);
      expect(check.success, type).toBe(true);
    }
  });

  it("keeps create mode single-page (unchanged)", async () => {
    const result = await ruleBasedProvider.generatePlan({
      prompt: "Build a dark SaaS website for Huddle",
    });
    expect(result.plan.pages).toBeUndefined();
    expect(result.plan.sections.length).toBeGreaterThan(0);
    const check = GenerationPlanSchema.safeParse(result.plan);
    expect(check.success).toBe(true);
  });

  it("normalizes every page's sections (supported types only)", async () => {
    const result = await ruleBasedProvider.generatePlan({
      prompt: "multi-page restaurant website with a menu page",
      mode: "site",
    });
    const types = result.plan
      .pages!.flatMap((p) => p.sections)
      .map((s) => s.type);
    for (const t of types) {
      expect(["header", "hero", "features", "pricing", "faq", "cta", "footer"]).toContain(t);
    }
  });
});
