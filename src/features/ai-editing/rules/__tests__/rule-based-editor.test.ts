import { describe, it, expect } from "vitest";
import {
  applyRuleBasedEdit,
  detectTone,
  detectIntent,
  sectionLabel,
} from "../rule-based-editor";
import type { EditTarget } from "../../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function heroTarget(overrides?: Partial<EditTarget>): EditTarget {
  return {
    kind: "section",
    sectionId: "hero-1",
    type: "hero",
    label: "Hero section",
    props: {
      headline: "Acme Platform",
      subheadline: "Original subheadline",
      primaryCta: { text: "Get Started", href: "#start" },
      secondaryCta: { text: "Learn More", href: "#learn" },
    },
    context: { brandName: "Acme" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

describe("detectTone / detectIntent", () => {
  it("detects playful tone", () => {
    expect(detectTone("make it more playful and fun")).toBe("playful");
  });

  it("detects professional tone", () => {
    expect(detectTone("use a professional, corporate voice")).toBe("professional");
  });

  it("defaults when no tone keyword matches", () => {
    expect(detectTone("regenerate this section")).toBe("default");
  });

  it("detects shorter intent", () => {
    expect(detectIntent("make it shorter and concise")).toBe("shorter");
  });

  it("detects more intent", () => {
    expect(detectIntent("add more features please")).toBe("more");
  });

  it("detects rewrite intent from a bare regenerate instruction", () => {
    expect(detectIntent("regenerate the copy")).toBe("rewrite");
  });
});

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

describe("applyRuleBasedEdit — hero", () => {
  it("rewrites copy per tone while preserving CTA objects and hrefs", () => {
    const edited = applyRuleBasedEdit(heroTarget(), "make it playful");
    expect(edited.type).toBe("hero");
    expect(edited.props.headline).toContain("Acme");
    expect(edited.props.subheadline).toBeTruthy();
    // CTA structure + hrefs preserved
    expect(edited.props.primaryCta).toEqual({ text: "Get Started", href: "#start" });
    expect(edited.props.secondaryCta).toEqual({ text: "Learn More", href: "#learn" });
  });

  it("clamps copy on shorter intent", () => {
    const edited = applyRuleBasedEdit(
      heroTarget(),
      "make the headline shorter and concise",
    );
    const words = String(edited.props.headline).split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(6);
  });

  it("is deterministic for identical input", () => {
    const a = applyRuleBasedEdit(heroTarget(), "make it playful");
    const b = applyRuleBasedEdit(heroTarget(), "make it playful");
    expect(a).toEqual(b);
  });

  it("never mutates the input props", () => {
    const target = heroTarget();
    const before = JSON.stringify(target.props);
    applyRuleBasedEdit(target, "make it bold");
    expect(JSON.stringify(target.props)).toBe(before);
  });

  it("falls back to a neutral subject without a brand", () => {
    const target = heroTarget({ context: undefined });
    const edited = applyRuleBasedEdit(target, "make it minimal");
    expect(String(edited.props.headline)).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Structure preservation
// ---------------------------------------------------------------------------

describe("applyRuleBasedEdit — structure preservation", () => {
  it("header preserves navLinks and refreshes the CTA label", () => {
    const target: EditTarget = {
      kind: "section",
      sectionId: "header-1",
      type: "header",
      props: {
        logoText: "Acme",
        navLinks: [{ text: "Home", href: "/" }, { text: "Pricing", href: "/pricing" }],
        ctaText: "Old CTA",
      },
    };
    const edited = applyRuleBasedEdit(target, "make it bold");
    expect(edited.props.navLinks).toEqual([
      { text: "Home", href: "/" },
      { text: "Pricing", href: "/pricing" },
    ]);
    expect(edited.props.logoText).toBe("Acme");
    expect(edited.props.ctaText).toBe("Get Started");
  });

  it("features keeps the item count on rewrite and grows it on 'more'", () => {
    const target: EditTarget = {
      kind: "section",
      sectionId: "features-1",
      type: "features",
      props: {
        title: "Features",
        features: [
          { title: "A", description: "D1", icon: "Zap" },
          { title: "B", description: "D2", icon: "Shield" },
        ],
      },
    };
    const rewritten = applyRuleBasedEdit(target, "rewrite the copy");
    expect(rewritten.props.features).toHaveLength(2);

    const grown = applyRuleBasedEdit(target, "add more features");
    expect(grown.props.features).toHaveLength(4);
  });

  it("pricing preserves plan names, prices, and feature lists", () => {
    const target: EditTarget = {
      kind: "section",
      sectionId: "pricing-1",
      type: "pricing",
      props: {
        title: "Pricing",
        plans: [
          { name: "Basic", price: "$10", features: ["A"], cta: "Buy Basic" },
          { name: "Pro", price: "$50", features: ["A", "B"], cta: "Buy Pro" },
        ],
      },
    };
    const edited = applyRuleBasedEdit(target, "make it luxury");
    const plans = edited.props.plans as Array<Record<string, unknown>>;
    expect(plans).toHaveLength(2);
    expect(plans[0].name).toBe("Basic");
    expect(plans[0].price).toBe("$10");
    expect(plans[1].price).toBe("$50");
    expect(edited.props.title).toContain("pricing");
  });

  it("faq grows on 'more' and rewrites in place otherwise", () => {
    const target: EditTarget = {
      kind: "section",
      sectionId: "faq-1",
      type: "faq",
      props: {
        title: "FAQ",
        items: [
          { question: "Q1", answer: "A1" },
          { question: "Q2", answer: "A2" },
        ],
      },
      context: { brandName: "Acme" },
    };
    const edited = applyRuleBasedEdit(target, "make it friendly");
    const items = edited.props.items as Array<{ question: string; answer: string }>;
    expect(items).toHaveLength(2);
    expect(items[0].question).toContain("Acme");

    const grown = applyRuleBasedEdit(target, "add more faq items");
    const grownItems = grown.props.items as Array<{ question: string; answer: string }>;
    expect(grownItems).toHaveLength(4);
  });

  it("cta preserves ctaHref and refreshes the label", () => {
    const target: EditTarget = {
      kind: "section",
      sectionId: "cta-1",
      type: "cta",
      props: { headline: "Old", ctaText: "Old", ctaHref: "/buy" },
    };
    const edited = applyRuleBasedEdit(target, "make it minimal");
    expect(edited.props.ctaHref).toBe("/buy");
    expect(edited.props.ctaText).toBe("Start");
  });

  it("footer preserves links and rewrites the copyright line", () => {
    const target: EditTarget = {
      kind: "section",
      sectionId: "footer-1",
      type: "footer",
      props: {
        text: "© Old",
        links: [{ text: "Privacy", href: "/privacy" }],
      },
      context: { brandName: "Acme" },
    };
    const edited = applyRuleBasedEdit(target, "make it playful");
    expect(edited.props.links).toEqual([{ text: "Privacy", href: "/privacy" }]);
    expect(String(edited.props.text)).toContain("Acme");
  });

  it("is a safe no-op for unknown section types", () => {
    const target = heroTarget({ type: "gallery", props: { headline: "Keep" } }) as EditTarget;
    const edited = applyRuleBasedEdit(target, "rewrite");
    expect(edited.type).toBe("gallery");
    expect(edited.props).toEqual({ headline: "Keep" });
  });
});

describe("sectionLabel", () => {
  it("maps known types to friendly labels", () => {
    expect(sectionLabel("hero")).toBe("Hero section");
    expect(sectionLabel("pricing")).toBe("Pricing section");
  });

  it("title-cases unknown types", () => {
    expect(sectionLabel("gallery")).toBe("Gallery section");
  });
});
