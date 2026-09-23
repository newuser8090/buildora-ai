// ---------------------------------------------------------------------------
// Local Grocery Store template — hydration + content tests (Stage 2)
//
// Verifies the template builds a schema-valid Project with the promised
// grocery structure: header storefront, hero banner with badge/CTA, category
// showcase, product grid with pack/price/"+ Add", and the footer guarantee.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { TemplateProjectFactory } from "../services/template-project-factory";
import { templateRegistry } from "../registry/template-registry";
import {
  registerDefaultTemplates,
  resetTemplateRegistration,
} from "../registry/register-default-templates";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";

describe("grocery store template", () => {
  let factory: TemplateProjectFactory;

  beforeEach(() => {
    resetTemplateRegistration();
    templateRegistry.clear();
    registerDefaultTemplates();
    factory = new TemplateProjectFactory();
  });

  function createProject(): Project {
    const result = factory.createProjectFromTemplate({
      templateId: "template-grocery",
      projectName: "Local Grocery Store",
    });
    if (!result.ok) {
      throw new Error(`hydration failed: ${result.error.message}`);
    }
    return result.project;
  }

  it("hydrates into a schema-valid project", () => {
    const project = createProject();
    const validation = ProjectSchema.safeParse(project);
    expect(validation.success).toBe(true);
  });

  it("produces the promised section stack", () => {
    const project = createProject();
    const sections = project.pages[0].sections;
    expect(sections.map((s) => s.type)).toEqual([
      "header",
      "hero",
      "features",
      "pricing",
      "footer",
    ]);
    for (const section of sections) {
      expect(section.visible).toBe(true);
      expect(section.order).toBeGreaterThan(0);
    }
  });

  it("header carries the FreshMart storefront fields", () => {
    const project = createProject();
    const header = project.pages[0].sections.find((s) => s.type === "header");
    const props = header?.props as { logoText?: string; ctaText?: string; navLinks?: { text: string }[] };
    expect(props.logoText).toBe("FreshMart");
    expect(props.ctaText).toBe("Shop Now");
    const navTexts = (props.navLinks ?? []).map((l) => l.text);
    expect(navTexts).toContain("Search");
    expect(navTexts).toContain("Wishlist");
    expect(navTexts).toContain("Account");
    expect(navTexts).toContain("Cart");
  });

  it("hero carries the delivery headline, organic badge, and Shop Now CTA", () => {
    const project = createProject();
    const hero = project.pages[0].sections.find((s) => s.type === "hero");
    const props = hero?.props as { headline?: string; subheadline?: string; primaryCta?: { text?: string } };
    expect(props.headline).toContain("Fresh farm groceries delivered to your door");
    expect(props.subheadline).toContain("100% organic");
    expect(props.primaryCta?.text).toBe("Shop Now");
  });

  it("category showcase covers all four promised categories", () => {
    const project = createProject();
    const features = project.pages[0].sections.find((s) => s.type === "features");
    const props = features?.props as { features?: { title: string }[] };
    const titles = (props.features ?? []).map((f) => f.title);
    expect(titles).toEqual([
      "Fruits & Vegetables",
      "Dairy & Bakery",
      "Pantry Essentials",
      "Cold Drinks & Juices",
    ]);
  });

  it("product grid uses the INR price + pack + Add-to-cart model", () => {
    const project = createProject();
    const pricing = project.pages[0].sections.find((s) => s.type === "pricing");
    const props = pricing?.props as {
      plans?: { name: string; price: string; cta: string; features: string[] }[];
    };
    const plans = props.plans ?? [];
    expect(plans.length).toBeGreaterThanOrEqual(4);

    const names = plans.map((p) => p.name);
    expect(names).toContain("Organic Hass Avocado");
    expect(names).toContain("Whole Farm Milk");

    for (const product of plans) {
      expect(product.price).toMatch(/^₹\d+/);
      expect(product.cta).toBe("+ Add");
      expect(product.features.length).toBeGreaterThan(0); // pack/weight info
    }
  });

  it("footer carries the delivery guarantee, timings, and contact", () => {
    const project = createProject();
    const footer = project.pages[0].sections.find((s) => s.type === "footer");
    const text = String(footer?.props.text ?? "");
    expect(text).toContain("Delivery guaranteed");
    expect(text).toContain("7 AM – 10 PM");
    expect(text).toContain("WhatsApp");
    expect(text).toContain("© 2026 FreshMart");
  });

  it("keeps all sections visible with valid deterministic sections", () => {
    const project = createProject();
    for (const page of project.pages) {
      for (const section of page.sections) {
        const typed = section as BaseSection;
        expect(typed.id.length).toBeGreaterThan(0);
        expect(typeof typed.props).toBe("object");
      }
    }
  });
});
