// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — component converter
//
// Detects composite / navigation patterns (cards, pricing, features, FAQ,
// reviews, team, tabs, accordion, hero, CTA, navigation, badges, avatars,
// logos) from class tokens and tag names, and maps them onto EXISTING
// composite + navigation block types.
//
// Detection is heuristic but deterministic. The node converter always
// re-validates the chosen type against the actual converted children and
// downgrades to a container when nesting rules would be violated.
// ---------------------------------------------------------------------------

import type { ImportElementNode } from "../types";
import type { BlockType } from "../../blocks/types";
import type { ConversionContext } from "./conversion-report";

export interface ComponentDetection {
  /** Candidate block type (null → generic tag/layout rules apply). */
  type: BlockType | null;
  /** Human label used as the block name (e.g. "Hero", "Logo"). */
  name?: string;
}

// ---------------------------------------------------------------------------
// Class-token pattern helpers
// ---------------------------------------------------------------------------

/** Match a token group delimited by - or _ (e.g. "pricing", "price"). */
function tokenMatcher(...tokens: string[]): RegExp {
  const alternation = tokens.join("|");
  return new RegExp(`(^|[-_])(${alternation})([-_]|$)`);
}

interface ClassPattern {
  pattern: RegExp;
  /** Skip classes that look like containers of items (grids/lists/wrappers). */
  excludeContainerish?: boolean;
}

const PRICING: ClassPattern = { pattern: tokenMatcher("pricing", "price", "plan"), excludeContainerish: true };
const FEATURE: ClassPattern = { pattern: tokenMatcher("feature", "benefit"), excludeContainerish: true };
const FAQ: ClassPattern = { pattern: tokenMatcher("faq", "question"), excludeContainerish: true };
const REVIEW: ClassPattern = { pattern: tokenMatcher("testimonial", "review"), excludeContainerish: true };
const TEAM: ClassPattern = { pattern: tokenMatcher("team", "member"), excludeContainerish: true };
const CARD: ClassPattern = { pattern: tokenMatcher("card"), excludeContainerish: true };
const BADGE: ClassPattern = { pattern: tokenMatcher("badge", "chip", "pill") };
const AVATAR: ClassPattern = { pattern: tokenMatcher("avatar") };
const LOGO: ClassPattern = { pattern: tokenMatcher("logo") };
const HERO: ClassPattern = { pattern: tokenMatcher("hero") };
const CTA: ClassPattern = { pattern: tokenMatcher("cta", "calltoaction") };
const TABS: ClassPattern = { pattern: tokenMatcher("tab") };
const ACCORDION: ClassPattern = { pattern: tokenMatcher("accordion", "collapsible", "collapse") };
const NAVBAR: ClassPattern = { pattern: tokenMatcher("navbar", "navigation") };
const MENU: ClassPattern = { pattern: tokenMatcher("menu", "nav-links", "navlinks") };
const FOOTER_EL: ClassPattern = { pattern: tokenMatcher("footer") };

/** Container-ish class suffixes that describe wrappers, not cards. */
const CONTAINERISH_SUFFIX = /(?:grid|list|wrapper|wrap|section|container|row|col|holder|group)$/;

function matchesAnyClass(
  classNames: readonly string[],
  candidates: ClassPattern[],
): boolean {
  for (const className of classNames) {
    const lower = className.toLowerCase();
    for (const candidate of candidates) {
      if (candidate.excludeContainerish && CONTAINERISH_SUFFIX.test(lower)) {
        continue;
      }
      if (candidate.pattern.test(lower)) return true;
    }
  }
  return false;
}

function hasAnyClass(classNames: readonly string[], candidate: ClassPattern): boolean {
  return matchesAnyClass(classNames, [candidate]);
}

// ---------------------------------------------------------------------------
// Text collection (for composite props)
// ---------------------------------------------------------------------------

/** All non-empty descendant text values of an element (deterministic order). */
export function collectElementText(element: ImportElementNode): string[] {
  const texts: string[] = [];
  const walk = (nodes: ImportElementNode["children"]): void => {
    for (const node of nodes) {
      if (node.kind === "text") {
        const value = node.value.trim();
        if (value.length > 0) texts.push(value);
      } else if (node.kind === "element") {
        walk(node.children);
      } else if (node.kind === "fragment") {
        walk(node.children);
      }
    }
  };
  walk(element.children);
  return texts;
}

// ---------------------------------------------------------------------------
// Composite prop extraction
// ---------------------------------------------------------------------------

/** Heuristic props for composite blocks, extracted from descendant text. */
export function extractCompositeProps(
  type: BlockType,
  texts: readonly string[],
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  switch (type) {
    case "pricing-card": {
      const price = texts.find((t) => /^\$[\d.,]+/.test(t));
      if (price) props.price = price;
      const period = texts.find((t) => /(\bper\b|\/mo(?:nth)?|\/year|\bannually\b|\bmonthly\b)/i.test(t));
      if (period) props.period = period;
      const name = texts.find((t) => t.length <= 40 && !/^\$/.test(t) && !/(\bper\b|\/mo)/i.test(t));
      if (name) props.name = name;
      break;
    }
    case "team-member": {
      if (texts.length > 0) props.name = texts[0];
      if (texts.length > 1) props.role = texts[1];
      break;
    }
    case "review-card": {
      const star = texts.find((t) => /^[★☆*]{1,5}$/.test(t.trim()));
      if (star) {
        const count = [...star.trim()].filter((c) => c === "★" || c === "*").length;
        if (count >= 1 && count <= 5) props.rating = count;
      }
      const ratio = texts.find((t) => /^\d\/5$/.test(t.trim()));
      if (ratio) props.rating = Number(ratio.trim()[0]);
      break;
    }
    case "faq-item": {
      if (texts.length > 0) props.name = texts[0].slice(0, 60);
      break;
    }
    default:
      break;
  }

  return props;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect a composite or navigation block type for an element. Returns null
 * when generic rules (tag mapping, layout) should decide.
 */
export function detectComponentType(
  element: ImportElementNode,
  _context: ConversionContext,
): ComponentDetection {
  const tag = element.tagName.toLowerCase();
  const classNames = element.classNames;

  // ---- Navigation elements ----
  if (tag === "nav") {
    return { type: "menu", name: "Menu" };
  }
  if (tag === "footer" || hasAnyClass(classNames, FOOTER_EL)) {
    return { type: "footer", name: "Footer" };
  }
  if (tag === "header") {
    return { type: "navbar", name: "Navigation" };
  }
  if (hasAnyClass(classNames, NAVBAR)) {
    return { type: "navbar", name: "Navigation" };
  }
  if (hasAnyClass(classNames, MENU)) {
    return { type: "menu", name: "Menu" };
  }

  // ---- Composite blocks (specific patterns first) ----
  if (hasAnyClass(classNames, PRICING)) {
    return { type: "pricing-card", name: "Pricing card" };
  }
  if (hasAnyClass(classNames, FEATURE)) {
    return { type: "feature-card", name: "Feature card" };
  }
  if (hasAnyClass(classNames, FAQ)) {
    return { type: "faq-item", name: "Question" };
  }
  if (hasAnyClass(classNames, REVIEW)) {
    return { type: "review-card", name: "Review card" };
  }
  if (hasAnyClass(classNames, TEAM)) {
    return { type: "team-member", name: "Team member" };
  }
  if (hasAnyClass(classNames, CARD)) {
    return { type: "card", name: "Card" };
  }
  if (hasAnyClass(classNames, TABS)) {
    return { type: "tabs", name: "Tabs" };
  }
  if (hasAnyClass(classNames, ACCORDION)) {
    return { type: "accordion", name: "Accordion" };
  }
  if (hasAnyClass(classNames, BADGE)) {
    return { type: "badge", name: "Badge" };
  }

  // ---- Avatars / logos / section names ----
  if (hasAnyClass(classNames, AVATAR) && (tag === "img" || tag === "svg")) {
    return { type: "image", name: "Avatar" };
  }
  if (hasAnyClass(classNames, LOGO)) {
    // Text logos keep their text block; image logos become image blocks.
    if (tag === "img") return { type: "image", name: "Logo" };
    return { type: null, name: "Logo" };
  }
  if (hasAnyClass(classNames, HERO)) {
    return { type: null, name: "Hero" };
  }
  if (hasAnyClass(classNames, CTA)) {
    return { type: null, name: "CTA" };
  }

  return { type: null };
}
