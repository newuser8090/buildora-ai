// ---------------------------------------------------------------------------
// Rule-based editor — deterministic AI-editing fallback
//
// Mirrors the create-mode philosophy: when Gemini is unavailable, edits are
// still applied locally using a deterministic, structure-preserving editor.
//
// Guarantees:
//   - NEVER mutates input
//   - preserves structure: array lengths (unless "more"), hrefs, prices,
//     plan names, asset refs, CTAs — only copy fields are rewritten
//   - deterministic: same input + instruction → same output
// ---------------------------------------------------------------------------

import type { EditTarget, EditedSection } from "../types";
import { normalizeSectionProps } from "@/features/generation/normalizers/link-normalizer";

// ---------------------------------------------------------------------------
// Tone + intent detection
// ---------------------------------------------------------------------------

export type ToneKey =
  | "playful"
  | "bold"
  | "professional"
  | "friendly"
  | "luxury"
  | "minimal"
  | "default";

export type IntentKey = "rewrite" | "shorter" | "longer" | "more" | "default";

const TONE_KEYWORDS: Array<[ToneKey, string[]]> = [
  ["playful", ["playful", "fun", "quirky", "cheerful", "lighthearted", "witty", "whimsical"]],
  ["bold", ["bold", "punchy", "strong", "confident", "impactful", "striking", "assertive"]],
  ["professional", ["professional", "corporate", "formal", "business", "trustworthy", "reliable", "serious"]],
  ["friendly", ["friendly", "warm", "welcoming", "approachable", "inviting"]],
  ["luxury", ["luxury", "premium", "elegant", "high-end", "exclusive", "sophisticated"]],
  ["minimal", ["minimal", "clean", "simple", "understated", "sleek"]],
];

const INTENT_KEYWORDS: Array<[IntentKey, string[]]> = [
  ["shorter", ["shorter", "concise", "brief", "compact", "tighten", "less text", "summarize"]],
  ["longer", ["longer", "expand", "elaborate", "detailed", "more detail", "more text", "extend"]],
  ["more", ["add more", "more features", "more items", "more faq", "add faq", "add features", "more plans"]],
  ["rewrite", ["rewrite", "regenerate", "refresh", "improve", "make better", "rephrase", "change the copy", "redo", "update the", "edit the"]],
];

export function detectTone(instruction: string): ToneKey {
  const lower = instruction.toLowerCase();
  for (const [tone, keywords] of TONE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return tone;
  }
  return "default";
}

export function detectIntent(instruction: string): IntentKey {
  const lower = instruction.toLowerCase();
  for (const [intent, keywords] of INTENT_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return intent;
  }
  return "default";
}

// ---------------------------------------------------------------------------
// Copy templates — {brand} is interpolated; falls back to a neutral subject
// ---------------------------------------------------------------------------

function brandOf(target: EditTarget): string {
  const fromContext = target.context?.brandName?.trim();
  if (fromContext) return fromContext;
  const logoText =
    target.type === "header" && typeof target.props.logoText === "string"
      ? target.props.logoText
      : undefined;
  if (logoText?.trim()) return logoText.trim();
  return "your brand";
}

const HERO_COPY: Record<ToneKey, { headline: string; subheadline: string }> = {
  playful: {
    headline: "Let's make {brand} your new favorite",
    subheadline: "Fun, fast, and built around you — {brand} keeps things light.",
  },
  bold: {
    headline: "Own your momentum with {brand}",
    subheadline: "Bold tools. Clear results. No fluff.",
  },
  professional: {
    headline: "{brand} — built for business",
    subheadline: "Dependable solutions that move your work forward.",
  },
  friendly: {
    headline: "Welcome to {brand}",
    subheadline: "We're here to help you every step of the way.",
  },
  luxury: {
    headline: "{brand} — crafted without compromise",
    subheadline: "Premium quality, delivered with care.",
  },
  minimal: {
    headline: "{brand}",
    subheadline: "Simple. Clear. Effective.",
  },
  default: {
    headline: "{brand}",
    subheadline: "Everything you need to get started — thoughtfully designed.",
  },
};

const FEATURE_TITLES: Record<ToneKey, string[]> = {
  playful: ["Fast & Fun", "Playful by design", "Made to delight", "Easy as pie"],
  bold: ["Built to perform", "No-compromise quality", "Results, fast", "Stand out"],
  professional: ["Reliable", "Secure", "Scalable", "Supportive"],
  friendly: ["Here for you", "Easy to love", "Always helpful", "Made with care"],
  luxury: ["Impeccable", "Refined", "Exclusive", "Flawless"],
  minimal: ["Simple", "Clear", "Focused", "Streamlined"],
  default: ["Fast", "Secure", "Reliable", "Scalable"],
};

const FEATURE_DESCRIPTIONS: Record<ToneKey, string[]> = {
  playful: ["Lightning quick and a joy to use.", "Small touches that make you smile.", "Details that turn work into play."],
  bold: ["Built to handle anything you throw at it.", "Strength you can measure, not just feel.", "Made for teams that aim high."],
  professional: ["Dependable performance your team can count on.", "Enterprise-grade protection by default.", "Grows with your organization."],
  friendly: ["We make the hard parts feel easy.", "Real humans, real help, real fast.", "A tool that works the way you do."],
  luxury: ["Exceptional attention to every detail.", "A finish you can feel from the first click.", "Reserved for those who expect more."],
  minimal: ["No clutter, no noise.", "Exactly what you need and nothing more.", "Quietly does its job, perfectly."],
  default: ["Everything you need, nothing you don't.", "Built to save you time every day.", "Simple, reliable, and effective."],
};

const FAQ_COPY: Record<ToneKey, { question: string; answer: string }[]> = {
  playful: [
    { question: "Is {brand} really that fun to use?", answer: "We think so — and our users agree. It's built to feel effortless from day one." },
    { question: "Can I switch plans later?", answer: "Anytime! Upgrade, downgrade, or change your mind — we make it painless." },
    { question: "Do you offer support?", answer: "Yes — friendly, fast support that actually answers your questions." },
  ],
  bold: [
    { question: "What makes {brand} different?", answer: "We built it to be the strongest option in its class — no compromises." },
    { question: "How fast can I see results?", answer: "Most teams are up and running within minutes." },
    { question: "Is it secure?", answer: "Security is our baseline, not an add-on." },
  ],
  professional: [
    { question: "What does {brand} do?", answer: "It helps your team work more efficiently with dependable, scalable tools." },
    { question: "How does onboarding work?", answer: "A guided setup gets you productive quickly, with documentation at every step." },
    { question: "Do you offer enterprise support?", answer: "Yes, including dedicated account management for larger teams." },
  ],
  friendly: [
    { question: "Is {brand} easy to get started with?", answer: "Absolutely — most people are up and running in under five minutes." },
    { question: "What if I need help?", answer: "Our team is right here. Ask us anything, anytime." },
    { question: "Can I try it first?", answer: "Of course — start free and upgrade when you're ready." },
  ],
  luxury: [
    { question: "What level of quality can I expect?", answer: "The same meticulous care in every detail of the product." },
    { question: "Is there a white-glove onboarding?", answer: "Yes — a dedicated specialist will set everything up with you." },
    { question: "How is support handled?", answer: "Priority support with response times our customers rave about." },
  ],
  minimal: [
    { question: "What does {brand} do?", answer: "One thing, done exceptionally well." },
    { question: "How long does setup take?", answer: "Minutes." },
    { question: "Do I need training?", answer: "No." },
  ],
  default: [
    { question: "What is {brand}?", answer: "A focused product that helps you get things done." },
    { question: "How do I get started?", answer: "Sign up and follow the quick-start guide." },
    { question: "Is there support?", answer: "Yes — we're happy to help." },
  ],
};

const CTA_COPY: Record<ToneKey, { headline: string; ctaText: string }> = {
  playful: { headline: "Ready for a little fun with {brand}?", ctaText: "Let's Go!" },
  bold: { headline: "Stop waiting. Start winning.", ctaText: "Get Started" },
  professional: { headline: "Partner with {brand} today", ctaText: "Contact Us" },
  friendly: { headline: "We'd love to have you with us", ctaText: "Join Us" },
  luxury: { headline: "Experience {brand} for yourself", ctaText: "Book a Demo" },
  minimal: { headline: "Get started with {brand}", ctaText: "Start" },
  default: { headline: "Get started with {brand}", ctaText: "Get Started" },
};

const HEADER_CTA: Record<ToneKey, string> = {
  playful: "Try it free",
  bold: "Get Started",
  professional: "Contact Sales",
  friendly: "Get in touch",
  luxury: "Book a Demo",
  minimal: "Start",
  default: "Get Started",
};

const FOOTER_TEXT: Record<ToneKey, string> = {
  playful: "© {brand} — made with a smile.",
  bold: "© {brand} — built to last.",
  professional: "© {brand} — all rights reserved.",
  friendly: "© {brand} — we're glad you're here.",
  luxury: "© {brand} — crafted with care.",
  minimal: "© {brand}",
  default: "© {brand} — all rights reserved.",
};

function fill(template: string, brand: string): string {
  return template.replace(/\{brand\}/g, brand);
}

// ---------------------------------------------------------------------------
// Structure helpers
// ---------------------------------------------------------------------------

function clampWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text.trim() : `${words.slice(0, maxWords).join(" ")}…`;
}

// ---------------------------------------------------------------------------
// Section-specific editors
// ---------------------------------------------------------------------------

function editHero(target: EditTarget, tone: ToneKey, intent: IntentKey, brand: string): Record<string, unknown> {
  const props = { ...target.props };
  const copy = HERO_COPY[tone];
  let headline = fill(copy.headline, brand);
  let subheadline = fill(copy.subheadline, brand);

  if (intent === "shorter") {
    headline = clampWords(headline, 6);
    subheadline = clampWords(subheadline, 8);
  } else if (intent === "longer") {
    subheadline = `${subheadline} From your first click to your hundredth, ${brand} is designed to feel effortless.`;
  }

  props.headline = headline;
  props.subheadline = subheadline;
  return props;
}

function editHeader(target: EditTarget, tone: ToneKey, _intent: IntentKey, _brand: string): Record<string, unknown> {
  const props = { ...target.props };
  // Preserve navLinks, logoText, hrefs — only refresh the CTA label.
  props.ctaText = HEADER_CTA[tone];
  if (!Array.isArray(props.navLinks)) props.navLinks = [];
  return props;
}

function editFeatures(target: EditTarget, tone: ToneKey, intent: IntentKey, brand: string): Record<string, unknown> {
  const props = { ...target.props };
  const titles = FEATURE_TITLES[tone];
  const descriptions = FEATURE_DESCRIPTIONS[tone];

  const existing = Array.isArray(props.features)
    ? (props.features as Array<Record<string, unknown>>).filter((f) => f && typeof f === "object")
    : [];

  let count = existing.length;
  if (intent === "more") count = Math.max(count + 2, 4);
  if (count === 0) count = 3;

  const features = Array.from({ length: count }, (_, i) => {
    const base = existing[i] ?? {};
    return {
      ...base,
      title: fill(titles[i % titles.length], brand),
      description: fill(descriptions[i % descriptions.length], brand),
      icon: typeof base.icon === "string" ? base.icon : "Zap",
    };
  });

  props.title =
    intent === "shorter"
      ? "Why {brand}".replace("{brand}", brand)
      : fill(tone === "default" ? "What {brand} offers" : `What makes ${brand} different`, brand);
  props.features = features;
  return props;
}

function editPricing(target: EditTarget, tone: ToneKey, _intent: IntentKey, brand: string): Record<string, unknown> {
  const props = { ...target.props };
  // Pricing is factual — preserve plan names, prices, and feature lists.
  // Only the framing copy is touched.
  props.title =
    tone === "default"
      ? "Pricing"
      : fill(tone === "minimal" ? "Simple pricing" : `${brand} pricing`, brand);
  if (typeof props.subtitle === "string" && props.subtitle) {
    props.subtitle =
      tone === "default"
        ? props.subtitle
        : fill("Choose the plan that fits you best.", brand);
  }
  return props;
}

function editFaq(target: EditTarget, tone: ToneKey, intent: IntentKey, brand: string): Record<string, unknown> {
  const props = { ...target.props };
  const templates = FAQ_COPY[tone];
  const existing = Array.isArray(props.items)
    ? (props.items as Array<Record<string, unknown>>).filter((i) => i && typeof i === "object")
    : [];

  let count = existing.length;
  if (intent === "more") count = Math.max(count + 2, 4);
  if (count === 0) count = templates.length;

  const items = Array.from({ length: count }, (_, i) => {
    const t = templates[i % templates.length];
    return {
      question: fill(t.question, brand),
      answer: fill(t.answer, brand),
    };
  });

  props.items = items;
  return props;
}

function editCta(target: EditTarget, tone: ToneKey, intent: IntentKey, brand: string): Record<string, unknown> {
  const props = { ...target.props };
  const copy = CTA_COPY[tone];
  props.headline = intent === "shorter" ? clampWords(fill(copy.headline, brand), 8) : fill(copy.headline, brand);
  props.ctaText = copy.ctaText;
  if (typeof props.ctaHref !== "string") props.ctaHref = "#";
  return props;
}

function editFooter(target: EditTarget, tone: ToneKey, _intent: IntentKey, brand: string): Record<string, unknown> {
  const props = { ...target.props };
  props.text = fill(FOOTER_TEXT[tone], brand);
  if (!Array.isArray(props.links)) props.links = [];
  return props;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Human-readable label for a section type, e.g. "Hero section". */
export function sectionLabel(type: string): string {
  const map: Record<string, string> = {
    header: "Header",
    hero: "Hero",
    features: "Features",
    pricing: "Pricing",
    faq: "FAQ",
    cta: "CTA",
    footer: "Footer",
  };
  const name = map[type] ?? (type.charAt(0).toUpperCase() + type.slice(1));
  return `${name} section`;
}

/**
 * Apply a deterministic edit to a section.
 * Returns a single edited section (type preserved, props rewritten), ready
 * for client-side application and provider-agnostic.
 */
export function applyRuleBasedEdit(
  target: EditTarget,
  instruction: string,
): EditedSection {
  const tone = detectTone(instruction);
  const intent = detectIntent(instruction);
  const brand = brandOf(target);

  let props: Record<string, unknown>;
  switch (target.type) {
    case "header":
      props = editHeader(target, tone, intent, brand);
      break;
    case "hero":
      props = editHero(target, tone, intent, brand);
      break;
    case "features":
      props = editFeatures(target, tone, intent, brand);
      break;
    case "pricing":
      props = editPricing(target, tone, intent, brand);
      break;
    case "faq":
      props = editFaq(target, tone, intent, brand);
      break;
    case "cta":
      props = editCta(target, tone, intent, brand);
      break;
    case "footer":
      props = editFooter(target, tone, intent, brand);
      break;
    default:
      // Unknown types keep their props untouched (safe no-op).
      props = { ...target.props };
  }

  // Run through the canonical normalizer so link/CTA shapes stay valid.
  const normalized = normalizeSectionProps({ type: target.type, props, order: 1 });
  return { type: target.type, props: normalized.props };
}
