// ---------------------------------------------------------------------------
// Guided section language — presentation-layer mapping (Phase N, spec §6)
//
// Central registry that maps internal section types to plain-language names
// for beginners. Internal section types are never renamed; the registry only
// feeds UI presentation.
//
// Rules:
//   - every built-in section type has a guided label + explanation + example
//   - guided labels contain no technical jargon (hero/cta/flex/grid/…)
//   - malformed/unknown section types fall back safely
//   - deterministic, no mutation, framework-independent
// ---------------------------------------------------------------------------

import type { SectionType } from "@/features/editor/section-library/types";
import { getSectionTypeLabel } from "@/features/editor/utils/section-labels";
import type { EditorExperienceMode } from "../types";

// ---------------------------------------------------------------------------
// Guided block categories — the beginner-facing library taxonomy
// ---------------------------------------------------------------------------

export type GuidedBlockCategory =
  | "start"
  | "explain"
  | "trust"
  | "sell"
  | "connect"
  | "finish";

export const GUIDED_BLOCK_CATEGORIES: GuidedBlockCategory[] = [
  "start",
  "explain",
  "trust",
  "sell",
  "connect",
  "finish",
];

export const GUIDED_CATEGORY_LABELS: Record<GuidedBlockCategory, string> = {
  start: "Start",
  explain: "Explain",
  trust: "Build trust",
  sell: "Sell",
  connect: "Connect",
  finish: "Finish",
};

// ---------------------------------------------------------------------------
// Language entries
// ---------------------------------------------------------------------------

export interface GuidedSectionLanguage {
  type: SectionType;
  guidedLabel: string;
  explanation: string;
  example: string;
  /** Beginner-language search synonyms (e.g. "customer reviews", "menu"). */
  synonyms: string[];
  category: GuidedBlockCategory;
}

const GUIDED_LANGUAGE: Record<string, GuidedSectionLanguage> = {
  header: {
    type: "header",
    guidedLabel: "Top navigation",
    explanation: "Your logo, menu links, and main action.",
    example: "Helps people see where they are and move around your site.",
    synonyms: ["top bar", "nav", "menu", "navigation", "links", "logo", "top"],
    category: "start",
  },
  hero: {
    type: "hero",
    guidedLabel: "Main message",
    explanation: "The first thing visitors see.",
    example: "A short, clear statement of what your website is about.",
    synonyms: ["main message", "headline", "banner", "welcome", "intro", "opening"],
    category: "start",
  },
  features: {
    type: "features",
    guidedLabel: "What you offer",
    explanation: "Explain your main products, services, or benefits.",
    example: "A few cards that describe what people get from you.",
    synonyms: [
      "offer",
      "products",
      "services",
      "benefits",
      "features",
      "cards",
      "menu",
      "customer reviews",
      "reviews",
      "testimonials",
    ],
    category: "explain",
  },
  pricing: {
    type: "pricing",
    guidedLabel: "Plans and pricing",
    explanation: "Show visitors what each option includes.",
    example: "A few plans so people can pick what fits them.",
    synonyms: ["prices", "pricing", "plans", "cost", "price", "package"],
    category: "sell",
  },
  faq: {
    type: "faq",
    guidedLabel: "Common questions",
    explanation: "Answer questions before visitors need to ask.",
    example: "A list of questions with short, clear answers.",
    synonyms: ["questions", "faq", "answers", "help", "support", "trust"],
    category: "trust",
  },
  cta: {
    type: "cta",
    guidedLabel: "Action section",
    explanation: "Encourage visitors to take the next step.",
    example: "A clear call to contact, buy, or book.",
    synonyms: ["action", "button", "contact", "sign up", "cta", "next step", "call to action"],
    category: "connect",
  },
  footer: {
    type: "footer",
    guidedLabel: "Bottom information",
    explanation: "Contact details, links, and copyright information.",
    example: "The closing area with contact info and legal text.",
    synonyms: ["footer", "bottom", "contact", "copyright", "legal", "details"],
    category: "finish",
  },
};

// ---------------------------------------------------------------------------
// Lookups — all deterministic, all fallback-safe
// ---------------------------------------------------------------------------

/** Guided (plain-language) label for a section type. */
export function getGuidedSectionLabel(type: string): string {
  const entry = GUIDED_LANGUAGE[type];
  return entry ? entry.guidedLabel : getSectionTypeLabel(type);
}

/** Guided explanation for a section type. */
export function getGuidedSectionExplanation(type: string): string {
  return GUIDED_LANGUAGE[type]?.explanation ?? "";
}

/** Guided example usage for a section type. */
export function getGuidedSectionExample(type: string): string {
  return GUIDED_LANGUAGE[type]?.example ?? "";
}

/** Search synonyms for a section type (guided block browser). */
export function getGuidedSynonyms(type: string): string[] {
  return GUIDED_LANGUAGE[type]?.synonyms ?? [];
}

/** Guided block category for a section type (falls back to "explain"). */
export function getGuidedCategory(type: string): GuidedBlockCategory {
  return GUIDED_LANGUAGE[type]?.category ?? "explain";
}

/**
 * Mode-aware section name:
 *   guided   → plain-language label
 *   standard → conventional name ("Hero", "Pricing", …)
 *   advanced → conventional name
 */
export function getSectionNameForMode(
  mode: EditorExperienceMode,
  type: string,
): string {
  if (mode === "guided") return getGuidedSectionLabel(type);
  return getSectionTypeLabel(type);
}

/** Guided category label for a category id (fallback-safe). */
export function getGuidedCategoryLabel(category: GuidedBlockCategory): string {
  return GUIDED_CATEGORY_LABELS[category];
}

/** Deterministic listing of every registered language entry. */
export function listGuidedSectionLanguage(): GuidedSectionLanguage[] {
  return (Object.keys(GUIDED_LANGUAGE) as SectionType[])
    .sort()
    .map((type) => GUIDED_LANGUAGE[type]);
}

/**
 * Resolve a beginner-language search query to matching section types.
 * Matches guided labels, explanations, examples and synonyms (case-insensitive,
 * token-based). Deterministic — result order follows the canonical order.
 */
export function resolveBeginnerSearch(
  query: string,
): { type: string; score: number }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const tokens = q.split(/\s+/);
  const results: { type: string; score: number }[] = [];

  for (const type of Object.keys(GUIDED_LANGUAGE) as SectionType[]) {
    const entry = GUIDED_LANGUAGE[type];
    const haystack = [
      entry.guidedLabel,
      entry.explanation,
      entry.example,
      ...entry.synonyms,
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1;
    }
    if (score > 0) {
      results.push({ type, score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}
