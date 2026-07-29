import { normalizeLinks, normalizeCtaText, normalizePricingCta, logNormalizationWarning } from "../normalizers/link-normalizer";
import type { PlannedSection } from "../types/generation-plan";

// ---------------------------------------------------------------------------
// Content Generator — ensures every planned section has valid, complete props.
// Fills in any missing values with sensible defaults.
// Also normalizes legacy link shapes to canonical { text, href }.
// Now handles ALL nested fields including pricing plan cta.
// ---------------------------------------------------------------------------

export function finalizeSectionContent(section: PlannedSection, brand: string): PlannedSection {
  const type = section.type;
  const props = { ...section.props };

  switch (type) {
    case "header": {
      props.logoText = props.logoText ?? brand;
      if (props.navLinks) {
        const normalized = normalizeLinks(props.navLinks as unknown[]);
        logNormalizationWarning(type, "navLinks", props.navLinks);
        props.navLinks = normalized.length > 0 ? normalized : [
          { text: "Home", href: "#" },
          { text: "About", href: "#about" },
        ];
      } else {
        props.navLinks = [
          { text: "Home", href: "#" },
          { text: "About", href: "#about" },
        ];
      }
      // Normalize ctaText
      if (typeof props.ctaText === "object" && props.ctaText !== null) {
        logNormalizationWarning(type, "ctaText", props.ctaText);
        props.ctaText = normalizeCtaText(props.ctaText);
      }
      break;
    }
    case "hero": {
      props.headline = props.headline ?? `Welcome to ${brand}`;
      props.subheadline = props.subheadline ?? `Discover what ${brand} can do for you.`;
      props.primaryCta = props.primaryCta ?? { text: "Get Started", href: "#" };
      break;
    }
    case "features": {
      props.title = props.title ?? "Features";
      props.features = props.features ?? [
        { title: "Feature 1", description: "Description of your first feature.", icon: "Zap" },
        { title: "Feature 2", description: "Description of your second feature.", icon: "Star" },
      ];
      break;
    }
    case "pricing": {
      props.title = props.title ?? "Pricing";
      // Normalize each plan's cta field (critical: must be string, not object)
      if (Array.isArray(props.plans)) {
        props.plans = (props.plans as unknown[]).map((p) => {
          if (typeof p === "object" && p !== null) {
            const plan = { ...(p as Record<string, unknown>) };
            if (plan.cta !== undefined) {
              const original = plan.cta;
              plan.cta = normalizePricingCta(plan.cta);
              if (original !== plan.cta) {
                logNormalizationWarning(type, "plan.cta", original);
              }
            }
            return plan;
          }
          return p;
        });
      }
      // Ensure default plans
      if (!Array.isArray(props.plans) || props.plans.length === 0) {
        props.plans = [
          { name: "Basic", price: "$0", description: "Free plan", features: ["Feature 1"], cta: "Get Started" },
          { name: "Pro", price: "$29", description: "Pro plan", features: ["Feature 1", "Feature 2"], cta: "Start Free Trial", highlighted: true },
        ];
      }
      break;
    }
    case "faq": {
      props.title = props.title ?? "FAQ";
      props.items = props.items ?? [
        { question: "How does it work?", answer: `${brand} makes it simple to get started.` },
        { question: "Can I customize it?", answer: "Yes, everything is fully customizable." },
      ];
      break;
    }
    case "cta": {
      props.headline = props.headline ?? `Get started with ${brand}`;
      // Normalize ctaText in case Gemini returned an object
      const rawCta = props.ctaText;
      props.ctaText = normalizeCtaText(rawCta) || "Get Started";
      if (typeof rawCta === "object") {
        logNormalizationWarning(type, "ctaText", rawCta);
      }
      break;
    }
    case "footer": {
      props.text = props.text ?? `© 2026 ${brand}. All rights reserved.`;
      if (props.links) {
        const normalized = normalizeLinks(props.links as unknown[]);
        logNormalizationWarning(type, "links", props.links);
        props.links = normalized.length > 0 ? normalized : [
          { text: "Twitter", href: "#" },
          { text: "GitHub", href: "#" },
        ];
      } else {
        props.links = [
          { text: "Twitter", href: "#" },
          { text: "GitHub", href: "#" },
        ];
      }
      break;
    }
  }

  return { ...section, props };
}
