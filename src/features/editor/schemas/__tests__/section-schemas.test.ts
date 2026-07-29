import { describe, it, expect } from "vitest";
import {
  AnySectionSchema,
  HeaderSectionPropsSchema,
  HeroSectionPropsSchema,
  PricingSectionPropsSchema,
  CtaSectionPropsSchema,
  validateSectionSafe,
} from "../section-schemas";

// ---------------------------------------------------------------------------
// HeaderSectionPropsSchema
// ---------------------------------------------------------------------------

describe("HeaderSectionPropsSchema", () => {
  it("accepts valid header props", () => {
    const result = HeaderSectionPropsSchema.parse({
      logoText: "MyBrand",
      navLinks: [
        { text: "Home", href: "/" },
        { text: "About", href: "/about" },
      ],
      ctaText: "Get Started",
    });
    expect(result.logoText).toBe("MyBrand");
    expect(result.navLinks).toHaveLength(2);
    expect(result.ctaText).toBe("Get Started");
  });

  it("applies default for missing optional fields", () => {
    const result = HeaderSectionPropsSchema.parse({});
    expect(result.logoText).toBe("Brand");
    expect(result.navLinks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// HeroSectionPropsSchema
// ---------------------------------------------------------------------------

describe("HeroSectionPropsSchema", () => {
  it("accepts valid hero props", () => {
    const result = HeroSectionPropsSchema.parse({
      headline: "Welcome",
      subheadline: "We build things.",
      primaryCta: { text: "Click", href: "#" },
    });
    expect(result.headline).toBe("Welcome");
    expect(result.primaryCta.text).toBe("Click");
  });

  it("applies defaults for empty input", () => {
    const result = HeroSectionPropsSchema.parse({});
    expect(result.headline).toBe("Welcome");
    expect(result.primaryCta).toEqual({ text: "Get Started", href: "#" });
  });
});

// ---------------------------------------------------------------------------
// PricingSectionPropsSchema - THE CRITICAL TEST
// ---------------------------------------------------------------------------

describe("PricingSectionPropsSchema", () => {
  it("rejects pricing plan with object cta (should be string)", () => {
    const result = PricingSectionPropsSchema.safeParse({
      title: "Pricing",
      plans: [
        {
          name: "Basic",
          price: "$0",
          cta: { text: "Buy Now", href: "#" }, // WRONG: should be string
        },
      ],
    });
    // This should fail because cta must be a string, not an object
    expect(result.success).toBe(false);
  });

  it("accepts pricing plan with string cta", () => {
    const result = PricingSectionPropsSchema.parse({
      title: "Pricing",
      plans: [
        {
          name: "Basic",
          price: "$0",
          cta: "Buy Now",
        },
      ],
    });
    expect(result.plans[0].cta).toBe("Buy Now");
  });
});

// ---------------------------------------------------------------------------
// CtaSectionPropsSchema
// ---------------------------------------------------------------------------

describe("CtaSectionPropsSchema", () => {
  it("rejects ctaText as object (should be string)", () => {
    const result = CtaSectionPropsSchema.safeParse({
      headline: "CTA",
      ctaText: { text: "Click", href: "#" }, // WRONG: should be string
    });
    expect(result.success).toBe(false);
  });

  it("accepts ctaText as string", () => {
    const result = CtaSectionPropsSchema.parse({
      headline: "CTA",
      ctaText: "Click",
    });
    expect(result.ctaText).toBe("Click");
  });
});

// ---------------------------------------------------------------------------
// AnySectionSchema (discriminated union)
// ---------------------------------------------------------------------------

describe("AnySectionSchema", () => {
  it("validates a complete header section", () => {
    const result = AnySectionSchema.parse({
      id: "s1",
      type: "header",
      order: 1,
      visible: true,
      styles: {},
      props: {
        logoText: "Brand",
        navLinks: [{ text: "Home", href: "/" }],
      },
    });
    expect(result.type).toBe("header");
    expect((result.props as { logoText: string }).logoText).toBe("Brand");
  });

  it("rejects a header section with object ctaText", () => {
    const result = AnySectionSchema.safeParse({
      id: "s1",
      type: "header",
      order: 1,
      visible: true,
      styles: {},
      props: {
        logoText: "Brand",
        navLinks: [],
        ctaText: { text: "Click", href: "#" }, // WRONG: should be string
      },
    });
    expect(result.success).toBe(false);
  });

  it("validates a hero section with valid primaryCta", () => {
    const result = AnySectionSchema.parse({
      id: "s2",
      type: "hero",
      order: 2,
      visible: true,
      styles: {},
      props: {
        headline: "Hello",
        primaryCta: { text: "Go", href: "/go" },
      },
    });
    expect(result.type).toBe("hero");
  });

  it("rejects a hero section with string primaryCta", () => {
    const result = AnySectionSchema.safeParse({
      id: "s2",
      type: "hero",
      order: 2,
      visible: true,
      styles: {},
      props: {
        headline: "Hello",
        primaryCta: "Go", // WRONG: should be {text, href}
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown section type", () => {
    const result = AnySectionSchema.safeParse({
      id: "s3",
      type: "unknown_type",
      order: 3,
      visible: true,
      styles: {},
      props: {},
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateSectionSafe
// ---------------------------------------------------------------------------

describe("validateSectionSafe", () => {
  it("returns success for valid sections", () => {
    const result = validateSectionSafe({
      id: "s1",
      type: "footer",
      order: 1,
      visible: true,
      styles: {},
      props: { text: "Copyright", links: [{ text: "Home", href: "/" }] },
    });
    expect(result.success).toBe(true);
  });

  it("returns failure for sections with malformed data", () => {
    const result = validateSectionSafe({
      id: "s1",
      type: "cta",
      order: 1,
      visible: true,
      styles: {},
      props: { ctaText: { text: "Click", href: "#" } }, // Should be string
    });
    expect(result.success).toBe(false);
  });
});
