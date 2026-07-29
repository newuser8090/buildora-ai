import { describe, it, expect } from "vitest";
import {
  normalizeLinkItem,
  normalizeLinks,
  normalizeCtaText,
  normalizeLinkField,
  normalizePricingCta,
  normalizeSectionProps,
} from "../link-normalizer";

// ---------------------------------------------------------------------------
// normalizeLinkItem
// ---------------------------------------------------------------------------

describe("normalizeLinkItem", () => {
  it("passes through a valid { text, href } object", () => {
    expect(normalizeLinkItem({ text: "Home", href: "/" })).toEqual({
      text: "Home",
      href: "/",
    });
  });

  it("converts a plain string to { text, href: '#' }", () => {
    expect(normalizeLinkItem("Get Started")).toEqual({
      text: "Get Started",
      href: "#",
    });
  });

  it("converts { label, href } to { text, href }", () => {
    expect(normalizeLinkItem({ label: "About", href: "/about" })).toEqual({
      text: "About",
      href: "/about",
    });
  });

  it("returns null for invalid values", () => {
    expect(normalizeLinkItem(null)).toBeNull();
    expect(normalizeLinkItem(undefined)).toBeNull();
    expect(normalizeLinkItem(42)).toBeNull();
    expect(normalizeLinkItem({})).toBeNull();
    expect(normalizeLinkItem({ noText: true })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeLinks
// ---------------------------------------------------------------------------

describe("normalizeLinks", () => {
  it("normalizes an array of link-like values", () => {
    const result = normalizeLinks([
      { text: "Home", href: "/" },
      "About",
      { label: "Contact", href: "/contact" },
      null,
      42,
    ]);
    expect(result).toEqual([
      { text: "Home", href: "/" },
      { text: "About", href: "#" },
      { text: "Contact", href: "/contact" },
    ]);
  });

  it("returns empty array for empty or invalid input", () => {
    expect(normalizeLinks([])).toEqual([]);
    expect(normalizeLinks([null, undefined])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeCtaText
// ---------------------------------------------------------------------------

describe("normalizeCtaText", () => {
  it("passes through a plain string", () => {
    expect(normalizeCtaText("Get Started")).toBe("Get Started");
  });

  it("extracts text from { text, href } object", () => {
    expect(normalizeCtaText({ text: "Get Started", href: "#" })).toBe(
      "Get Started",
    );
  });

  it("extracts text from { label } object", () => {
    expect(normalizeCtaText({ label: "Learn More" })).toBe("Learn More");
  });

  it("returns empty string for invalid values", () => {
    expect(normalizeCtaText(null)).toBe("");
    expect(normalizeCtaText(42)).toBe("");
    expect(normalizeCtaText({})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// normalizeLinkField
// ---------------------------------------------------------------------------

describe("normalizeLinkField", () => {
  it("passes through a valid LinkItem", () => {
    expect(normalizeLinkField({ text: "Click", href: "/page" })).toEqual({
      text: "Click",
      href: "/page",
    });
  });

  it("converts a plain string to { text, href: '#' }", () => {
    expect(normalizeLinkField("Click")).toEqual({
      text: "Click",
      href: "#",
    });
  });

  it("converts { label, href } to { text, href }", () => {
    expect(normalizeLinkField({ label: "Go", href: "/go" })).toEqual({
      text: "Go",
      href: "/go",
    });
  });

  it("returns default for invalid values", () => {
    const result = normalizeLinkField(null);
    expect(result.text).toBe("Learn More");
    expect(result.href).toBe("#");
  });
});

// ---------------------------------------------------------------------------
// normalizePricingCta
// ---------------------------------------------------------------------------

describe("normalizePricingCta", () => {
  it("passes through a plain string", () => {
    expect(normalizePricingCta("Subscribe")).toBe("Subscribe");
  });

  it("extracts text from { text, href } object", () => {
    expect(normalizePricingCta({ text: "Buy Now", href: "#" })).toBe(
      "Buy Now",
    );
  });

  it("returns default for invalid values", () => {
    expect(normalizePricingCta(null)).toBe("Get Started");
    expect(normalizePricingCta(42)).toBe("Get Started");
    expect(normalizePricingCta({})).toBe("Get Started");
  });
});

// ---------------------------------------------------------------------------
// normalizeSectionProps
// ---------------------------------------------------------------------------

describe("normalizeSectionProps", () => {
  it("normalizes header navLinks", () => {
    const result = normalizeSectionProps({
      type: "header",
      props: {
        logoText: "Brand",
        navLinks: ["Home", { label: "About", href: "/about" }],
        ctaText: { text: "Click", href: "#" },
      },
    });
    expect(result.props.navLinks).toEqual([
      { text: "Home", href: "#" },
      { text: "About", href: "/about" },
    ]);
    expect(result.props.ctaText).toBe("Click");
  });

  it("normalizes hero primaryCta from string to LinkItem", () => {
    const result = normalizeSectionProps({
      type: "hero",
      props: { primaryCta: "Get Started" },
    });
    expect(result.props.primaryCta).toEqual({
      text: "Get Started",
      href: "#",
    });
  });

  it("normalizes pricing plan cta from object to string", () => {
    const result = normalizeSectionProps({
      type: "pricing",
      props: {
        plans: [
          { name: "Basic", price: "$0", cta: { text: "Buy", href: "#" } },
        ],
      },
    });
    const plans = result.props.plans as Array<Record<string, unknown>>;
    expect(plans[0].cta).toBe("Buy");
  });

  it("normalizes cta section ctaText from object to string", () => {
    const result = normalizeSectionProps({
      type: "cta",
      props: { ctaText: { text: "Subscribe", href: "#signup" } },
    });
    expect(result.props.ctaText).toBe("Subscribe");
  });

  it("normalizes footer links", () => {
    const result = normalizeSectionProps({
      type: "footer",
      props: {
        text: "Copyright",
        links: ["Twitter", { label: "GitHub", href: "https://github.com" }],
      },
    });
    expect(result.props.links).toEqual([
      { text: "Twitter", href: "#" },
      { text: "GitHub", href: "https://github.com" },
    ]);
  });

  it("handles features with malformed link fields", () => {
    const result = normalizeSectionProps({
      type: "features",
      props: {
        title: "Features",
        features: [
          { title: "F1", description: "D1", icon: "Zap", link: "Details" },
        ],
      },
    });
    const features = result.props.features as Array<Record<string, unknown>>;
    expect(features[0].link).toEqual({ text: "Details", href: "#" });
  });
});
