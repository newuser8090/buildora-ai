// ---------------------------------------------------------------------------
// Builder recommendations — deterministic next-step engine (Phase N, spec §9)
//
// Pure + framework-independent:
//   - no AI / network / store access
//   - no mutation
//   - no random ordering — deterministic priority ordering
//   - no destructive suggestions (never delete/replace/reorder)
//   - dismissed ids are filtered out (session-only, caller provides them)
//   - output is capped
// ---------------------------------------------------------------------------

import type {
  BuilderSiteType,
  BuilderSuggestion,
} from "../types";

export interface RecommendationSection {
  type: string;
  props: Record<string, unknown>;
}

export interface RecommendationContext {
  siteType: BuilderSiteType;
  pageTitle: string;
  /** Visible section types on the current page, in order. */
  sectionTypes: string[];
  /** Visible sections on the current page (for content checks). */
  sections: RecommendationSection[];
  pageCount: number;
  dismissedIds?: string[];
  /** Maximum suggestions to return. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasType(types: string[], type: string): boolean {
  return types.includes(type);
}

function longestHeadline(sections: RecommendationSection[]): string {
  for (const section of sections) {
    if (section.type === "hero") {
      return asString(section.props.headline);
    }
    if (section.type === "cta") {
      return asString(section.props.headline);
    }
  }
  return "";
}

function hasFeaturesWithDescription(sections: RecommendationSection[]): boolean {
  const features = sections.find((s) => s.type === "features");
  if (!features) return false;
  const list = features.props.features;
  if (!Array.isArray(list)) return false;
  return list.some(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).description === "string" &&
      asString((item as Record<string, unknown>).description).length > 0,
  );
}

function hasCtaButton(sections: RecommendationSection[]): boolean {
  const hero = sections.find((s) => s.type === "hero");
  if (hero && hero.props.primaryCta && typeof hero.props.primaryCta === "object") {
    const text = asString((hero.props.primaryCta as Record<string, unknown>).text);
    if (text.length > 0) return true;
  }
  return hasType(sections.map((s) => s.type), "cta");
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

interface PendingRule {
  priority: number;
  make: () => BuilderSuggestion | null;
}

function buildRules(ctx: RecommendationContext): PendingRule[] {
  const types = ctx.sectionTypes;
  const site = ctx.siteType;
  const headline = longestHeadline(ctx.sections);

  const rules: PendingRule[] = [];

  // Blank page — start with the essential three.
  if (types.length === 0) {
    rules.push({
      priority: 10,
      make: () => ({
        id: "rec-add-hero",
        type: "add-section",
        title: "Add your main message",
        description: "Say what your website is about in one clear sentence.",
        reason: "Every homepage needs a first message visitors can understand.",
        priority: 10,
        action: { kind: "add-section", sectionType: "hero" },
      }),
    });
    rules.push({
      priority: 30,
      make: () => ({
        id: "rec-add-header",
        type: "add-section",
        title: "Add top navigation",
        description: "A logo, menu links, and one main action at the top.",
        reason: "Navigation helps people find their way around your site.",
        priority: 30,
        action: { kind: "add-section", sectionType: "header" },
      }),
    });
    rules.push({
      priority: 40,
      make: () => ({
        id: "rec-add-footer",
        type: "add-section",
        title: "Add bottom information",
        description: "Contact details, links, and a copyright line.",
        reason: "Visitors often look at the bottom of a page for contact details.",
        priority: 40,
        action: { kind: "add-section", sectionType: "footer" },
      }),
    });
  }

  // Hero exists but no features — explain what you offer.
  if (hasType(types, "hero") && !hasType(types, "features")) {
    rules.push({
      priority: 20,
      make: () => ({
        id: "rec-add-features",
        type: "add-section",
        title: "Explain what you offer",
        description: "Show your main products, services, or benefits.",
        reason:
          "Visitors understand your message, but not yet what you provide.",
        priority: 20,
        action: { kind: "add-section", sectionType: "features" },
      }),
    });
  }

  // No clear next step anywhere.
  if (!hasCtaButton(ctx.sections)) {
    rules.push({
      priority: 25,
      make: () => ({
        id: "rec-add-cta",
        type: "add-section",
        title: "Add a next step",
        description: "Give visitors a clear action such as Contact, Buy, or Book.",
        reason: "A page with no obvious action lets visitors drift away.",
        priority: 25,
        action: { kind: "add-section", sectionType: "cta" },
      }),
    });
  }

  // Pricing without questions.
  if (hasType(types, "pricing") && !hasType(types, "faq")) {
    rules.push({
      priority: 26,
      make: () => ({
        id: "rec-add-faq",
        type: "add-section",
        title: "Answer common questions",
        description: "A list of questions with short, clear answers.",
        reason: "Questions near pricing often stop visitors from taking action.",
        priority: 26,
        action: { kind: "add-section", sectionType: "faq" },
      }),
    });
  }

  // Header + hero but nothing that builds trust yet.
  if (hasType(types, "header") && hasType(types, "hero") && !hasType(types, "faq") && !hasFeaturesWithDescription(ctx.sections)) {
    rules.push({
      priority: 35,
      make: () => ({
        id: "rec-add-trust",
        type: "add-section",
        title: "Build trust",
        description: "Add common questions or detailed benefits.",
        reason: "Customer opinions and clear answers make your message more believable.",
        priority: 35,
        action: { kind: "add-section", sectionType: "faq" },
      }),
    });
  }

  // No footer.
  if (!hasType(types, "footer")) {
    rules.push({
      priority: 40,
      make: () => ({
        id: "rec-add-footer",
        type: "add-section",
        title: "Add bottom information",
        description: "Contact details, links, and a copyright line.",
        reason: "Your website has no footer yet.",
        priority: 40,
        action: { kind: "add-section", sectionType: "footer" },
      }),
    });
  }

  // Category-specific content.
  if (site !== "generic") {
    if (!hasType(types, "features")) {
      rules.push({
        priority: 30,
        make: () => {
          const copy: Record<string, { title: string; description: string }> = {
            business: {
              title: "Explain what you offer",
              description: "Describe your products or services clearly.",
            },
            portfolio: {
              title: "Show your work",
              description: "A gallery of your best projects or pieces.",
            },
            store: {
              title: "Show what you sell",
              description: "Present your products in a clear, friendly way.",
            },
            restaurant: {
              title: "Show your menu",
              description: "Highlight your dishes or offerings.",
            },
            personal: {
              title: "Share more about you",
              description: "A short section about who you are.",
            },
            event: {
              title: "Share event details",
              description: "Explain what happens, where, and when.",
            },
            generic: {
              title: "Explain what you offer",
              description: "Describe your products or services clearly.",
            },
          };
          const c = copy[site] ?? copy.generic;
          return {
            id: "rec-category-features",
            type: "add-section",
            title: c.title,
            description: c.description,
            reason: "This page is missing the section that explains what you provide.",
            priority: 30,
            action: { kind: "add-section", sectionType: "features" },
          };
        },
      });
    }

    if ((site === "store" || site === "business") && !hasType(types, "pricing")) {
      rules.push({
        priority: 38,
        make: () => ({
          id: "rec-category-pricing",
          type: "add-section",
          title: "Add plans and pricing",
          description: "Show what each option includes.",
          reason: "Pricing helps people decide whether to contact you.",
          priority: 38,
          action: { kind: "add-section", sectionType: "pricing" },
        }),
      });
    }
  }

  // Long main message — content improvement.
  if (headline.length > 90) {
    rules.push({
      priority: 50,
      make: () => ({
        id: "rec-shorten-headline",
        type: "improve-content",
        title: "Make your main message shorter",
        description: "Short messages are easier to read on every screen.",
        reason: `Your main message is ${headline.length} characters — quite long.`,
        priority: 50,
        action: { kind: "edit-section", sectionType: "hero" },
      }),
    });
  }

  // Single page — consider adding another page.
  if (ctx.pageCount === 1 && types.length >= 3) {
    rules.push({
      priority: 60,
      make: () => ({
        id: "rec-add-page",
        type: "add-page",
        title: "Add another page",
        description: "Give your website more room to grow.",
        reason: "Your navigation has no destination pages yet.",
        priority: 60,
        action: { kind: "add-page" },
      }),
    });
  }

  // Mobile preview — low-priority, always available once there is content.
  if (types.length >= 2) {
    rules.push({
      priority: 70,
      make: () => ({
        id: "rec-preview-mobile",
        type: "complete-setting",
        title: "Check the mobile view",
        description: "See how your page looks on a phone.",
        reason: "Most visitors will read your site on a phone.",
        priority: 70,
        action: { kind: "preview-mobile" },
      }),
    });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Deterministic, capped, dismissible recommendation list.
 * Output is stable for identical input — no randomness, no ordering ties
 * beyond rule insertion order.
 */
export function getBuilderRecommendations(
  ctx: RecommendationContext,
): BuilderSuggestion[] {
  const limit = ctx.limit ?? 4;
  const dismissed = new Set(ctx.dismissedIds ?? []);

  const suggestions = buildRules(ctx)
    .filter((rule) => !dismissed.has(rule.make()?.id ?? "__skip__"))
    .sort((a, b) => a.priority - b.priority)
    .map((rule) => rule.make())
    .filter((s): s is BuilderSuggestion => s !== null)
    .filter((s) => !dismissed.has(s.id))
    .slice(0, limit);

  return suggestions;
}
