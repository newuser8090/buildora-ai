// ---------------------------------------------------------------------------
// Rule-based inline provider — deterministic quick-suggestion fallback
//
// Covers the Phase M intent set deterministically: shorter, longer, playful,
// professional, premium, friendly, concise, confident, minimal, regenerate,
// simplify, improve CTA, improve heading.
//
// Guarantees:
//   - deterministic for a given (value, instruction, variant)
//   - preserves Unicode
//   - respects the field max length
//   - never returns an empty suggestion
//   - never reports success when the output equals the input (no unchanged
//     false success — returns INLINE_NO_CHANGE instead)
//   - structured warning for unsupported intents
//   - never mutates the input
// ---------------------------------------------------------------------------

import type {
  InlineSuggestionInput,
  InlineSuggestionProvider,
  InlineSuggestionProviderResult,
} from "../types";
import type { InlineAiError } from "../types";

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------

export type InlineIntent =
  | "shorter"
  | "longer"
  | "playful"
  | "professional"
  | "premium"
  | "friendly"
  | "concise"
  | "confident"
  | "minimal"
  | "regenerate"
  | "simplify"
  | "cta"
  | "heading"
  | "generic-improve";

const INTENT_KEYWORDS: Array<[InlineIntent, string[]]> = [
  ["shorter", ["short", "shorter", "brief", "shorten", "tighten", "compact", "cut down", "shrink"]],
  ["concise", ["concise", "to the point", "tight", "less wordy"]],
  ["minimal", ["minimal", "minimalist", "clean", "simple", "understated"]],
  ["longer", ["longer", "expand", "elaborate", "extend", "more detail", "lengthen", "more text"]],
  ["playful", ["playful", "fun", "quirky", "whimsical", "cheerful", "lighthearted", "witty", "casual"]],
  ["professional", ["professional", "corporate", "formal", "business", "trustworthy", "polished"]],
  ["premium", ["premium", "luxury", "elegant", "high-end", "sophisticated", "upscale", "refined"]],
  ["friendly", ["friendly", "warm", "welcoming", "approachable", "inviting", "kind", "gentle"]],
  ["confident", ["confident", "bold", "assertive", "strong", "punchy", "impactful"]],
  ["regenerate", ["regenerate", "another", "try another", "try again", "different version", "variant", "redo", "again", "new version"]],
  ["simplify", ["simplify", "easier", "plain language", "clear", "uncomplicated"]],
  ["cta", ["cta", "button", "call to action", "action text"]],
  ["heading", ["heading", "headline", "title", "headline text"]],
];

function detectIntent(instruction: string, fieldKind: string): InlineIntent {
  const lower = instruction.toLowerCase();
  // CTA/heading hints only matter for matching field kinds.
  const isButton = fieldKind === "button-text" || fieldKind === "link-text";
  const isHeading = fieldKind === "heading";
  for (const [intent, keywords] of INTENT_KEYWORDS) {
    if (intent === "cta" && !isButton) continue;
    if (intent === "heading" && !isHeading) continue;
    if (keywords.some((k) => lower.includes(k))) return intent;
  }
  if (/improve|better|enhance|polish|refine|upgrade|rewrite|redo/i.test(lower)) {
    if (isButton) return "cta";
    if (isHeading) return "heading";
    return "generic-improve";
  }
  return "generic-improve";
}

// ---------------------------------------------------------------------------
// Deterministic transforms
// ---------------------------------------------------------------------------

function truncateToLength(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  // Cut at a word boundary, keeping the ellipsis within budget.
  let cut = value.slice(0, Math.max(1, maxLength - 1));
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.5) cut = cut.slice(0, lastSpace);
  return `${cut.trim()}…`;
}

function splitSentences(value: string): string[] {
  // Split on sentence-ending punctuation, keeping the punctuation.
  return value
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeShorter(value: string, maxLength: number): string {
  // 1. Prefer the first half of the sentences.
  const sentences = splitSentences(value);
  let candidate =
    sentences.length > 1
      ? sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).join(" ")
      : value;

  // 2. Strip common filler words.
  const words = candidate.split(/\s+/);
  const fillers = new Set(["really", "very", "quite", "just", "basically", "literally", "honestly"]);
  const filtered = words.filter((w) => !fillers.has(w.toLowerCase()));
  if (filtered.length >= 2) candidate = filtered.join(" ");

  // 3. If the text still didn't shrink (single short sentence), keep the
  //    first ~60% of the words so "shorter" always produces a change.
  const originalWords = value.trim().split(/\s+/);
  const currentWords = candidate.trim().split(/\s+/);
  if (currentWords.length >= originalWords.length && originalWords.length > 2) {
    const keep = Math.max(2, Math.ceil(originalWords.length * 0.6));
    candidate = originalWords.slice(0, keep).join(" ");
  }

  return truncateToLength(candidate.trim(), maxLength);
}

function makeLonger(value: string, maxLength: number, variant: number): string {
  const suffixes = [
    " — crafted for teams that value clarity and results.",
    " — built to make every step effortless and rewarding.",
    " — because great products deserve thoughtful words.",
    " — designed with care, delivered with confidence.",
  ];
  const suffix = suffixes[variant % suffixes.length];
  return truncateToLength(value.replace(/\.?$/, "") + suffix, maxLength);
}

function makePlayful(value: string, maxLength: number, variant: number): string {
  const openers = ["Hey!", "Oh hi!", "Guess what?"];
  const base = value.replace(/[.!]+$/, "");
  const candidate = `${openers[variant % openers.length]} ${base} ✨`;
  return truncateToLength(candidate, maxLength);
}

function makeProfessional(value: string, maxLength: number): string {
  const base = value.replace(/[!]+$/, ".").replace(/\s+/g, " ").trim();
  const sentence = base.charAt(0).toUpperCase() + base.slice(1);
  return truncateToLength(sentence.endsWith(".") ? sentence : `${sentence}.`, maxLength);
}

function makePremium(value: string, maxLength: number): string {
  // Uppercase-first pass + a luxury descriptor where natural.
  const base = value.replace(/[.!]+$/, "").trim();
  const word = base.split(/\s+/);
  if (word.length === 0) return value;
  word[0] = word[0].charAt(0).toUpperCase() + word[0].slice(1);
  const candidate = `${word.join(" ")} — elevated.`;
  return truncateToLength(candidate, maxLength);
}

function makeFriendly(value: string, maxLength: number, variant: number): string {
  const closers = [" 😊", " — we're here to help!", " — let's build something great together."];
  const base = value.replace(/[.!]+$/, "");
  return truncateToLength(base + closers[variant % closers.length], maxLength);
}

function makeConfident(value: string, maxLength: number): string {
  const base = value
    .replace(/\bmaybe\b|\bperhaps\b|\bhopefully\b|\bI think\b/gi, "")
    .replace(/[?!]+$/, ".")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = base.charAt(0).toUpperCase() + base.slice(1);
  return truncateToLength(sentence.endsWith(".") ? sentence : `${sentence}.`, maxLength);
}

function makeCta(value: string, maxLength: number, variant: number): string {
  const starters = [
    "Start", "Get", "Try", "Explore", "Launch", "Join", "Unlock", "Discover",
  ];
  const base = value.replace(/[.!]+$/, "").trim();
  // If the CTA already reads like an action (verb-first, short), vary slightly.
  if (base.split(/\s+/).length <= 3 && base.length > 0) {
    const starter = starters[(variant + 1) % starters.length];
    if (!new RegExp(`^${starter}\\b`, "i").test(base)) {
      return truncateToLength(`${starter} ${base.toLowerCase()}`, maxLength);
    }
  }
  const second = starters[(variant + 2) % starters.length];
  return truncateToLength(`${second} ${base.toLowerCase()}`, maxLength);
}

function makeHeading(value: string, maxLength: number, variant: number): string {
  const frames = [
    (s: string) => s,
    (s: string) => `The ${s}`,
    (s: string) => `${s}, done right`,
    (s: string) => `Your ${s}`,
  ];
  const base = value.replace(/[.!]+$/, "").trim();
  const framed = frames[variant % frames.length](base);
  // Title-case for headings.
  const words = framed.split(/\s+/);
  const title = words
    .map((w) => (w.length > 3 || words.indexOf(w) === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
  return truncateToLength(title, maxLength);
}

function makeGenericImprove(value: string, maxLength: number, variant: number): string {
  // Variant 0 must still change the text (no unchanged false success).
  const frames = [
    (s: string) => `The ${s}`,
    (s: string) => `${s} — reimagined.`,
    (s: string) => `Elevated: ${s}`,
    (s: string) => `${s}, done right`,
  ];
  const base = value.replace(/[.!]+$/, "").trim();
  return truncateToLength(frames[(variant + 1) % frames.length](base), maxLength);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Deterministically transform a field's text according to the detected intent.
 * Exported for direct testing.
 */
export function applyRuleBasedInlineSuggestion(
  input: InlineSuggestionInput,
): { ok: true; suggestedValue: string; explanation?: string; intent: InlineIntent; warnings: string[] }
  | { ok: false; error: InlineAiError; warnings: string[] } {
  const { instruction, currentValue, fieldKind, variant } = input;
  const value = currentValue ?? "";
  const maxLength = 2000; // provider-level cap; orchestrator clamps per field

  if (!value.trim()) {
    return {
      ok: false,
      error: { code: "INLINE_NO_CHANGE", message: "There is no text to improve." },
      warnings: [],
    };
  }

  const intent = detectIntent(instruction, fieldKind);
  let candidate = value;

  switch (intent) {
    case "shorter":
    case "concise":
    case "minimal":
    case "simplify":
      candidate = makeShorter(value, maxLength);
      break;
    case "longer":
      candidate = makeLonger(value, maxLength, variant ?? 0);
      break;
    case "playful":
      candidate = makePlayful(value, maxLength, variant ?? 0);
      break;
    case "professional":
      candidate = makeProfessional(value, maxLength);
      break;
    case "premium":
      candidate = makePremium(value, maxLength);
      break;
    case "friendly":
      candidate = makeFriendly(value, maxLength, variant ?? 0);
      break;
    case "confident":
      candidate = makeConfident(value, maxLength);
      break;
    case "cta":
      candidate = makeCta(value, maxLength, variant ?? 0);
      break;
    case "heading":
      candidate = makeHeading(value, maxLength, variant ?? 0);
      break;
    case "regenerate":
      candidate = makeGenericImprove(value, maxLength, (variant ?? 0) + 1);
      break;
    case "generic-improve":
      candidate = makeGenericImprove(value, maxLength, variant ?? 0);
      break;
  }

  // No unchanged false success — a suggestion must differ from the input.
  if (candidate.trim() === value.trim()) {
    return {
      ok: false,
      error: {
        code: "INLINE_NO_CHANGE",
        message: "I couldn't suggest a change — the text already matches that intent.",
      },
      warnings: [`No change produced for intent "${intent}".`],
    };
  }

  const warnings: string[] =
    intent === "generic-improve"
      ? ["The instruction didn't match a specific intent — I applied a light polish."]
      : [];

  return {
    ok: true,
    suggestedValue: candidate,
    explanation:
      intent === "generic-improve"
        ? "Applied a light polish since the request was generic."
        : `Made the text ${intent.replace("-", " ")}.`,
    intent,
    warnings,
  };
}

export class RuleBasedInlineProvider implements InlineSuggestionProvider {
  readonly id = "rule-based";

  async suggest(input: InlineSuggestionInput): Promise<InlineSuggestionProviderResult> {
    const result = applyRuleBasedInlineSuggestion(input);
    if (!result.ok) {
      return { ok: false, error: result.error, warnings: result.warnings };
    }
    return {
      ok: true,
      suggestion: {
        suggestedValue: result.suggestedValue,
        explanation: result.explanation,
      },
      warnings: result.warnings,
    };
  }
}

/** Convenience singleton. */
export const ruleBasedInlineProvider = new RuleBasedInlineProvider();
