"use client";

// ---------------------------------------------------------------------------
// Contextual AI actions (Stage 5) — direct canvas natural language
//
// One deterministic engine behind the AI Magic drawer's quick chips and the
// free-form prompt bar:
//   - TEXT transforms ("Make punchier", "Translate to Hindi", "Change tone to
//     friendly") rewrite the targeted element's `props.text`;
//   - STYLE requests ("make background light green", "change button to dark
//     orange") write style tokens;
//   - SECTION requests ("Add discount banner", "Regenerate copy with fresh
//     items") rewrite section-bound copy props.
//
// Everything commits as exactly ONE history entry — element requests through
// `commitElementTree` (fresh-tree re-materialization, same discipline as the
// inspector's commit path), section requests through `updateSectionProps`
// (withHistory merge). No network, no async — the chips answer instantly and
// one Undo removes the whole step.
// ---------------------------------------------------------------------------

import {
  updateElementProps,
  updateElementStyle,
} from "@/features/elements/engine/element-operations";
import type {
  ElementNode,
  ElementStyleTokens,
  ElementTree,
} from "@/features/elements/types";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { singleNestedSelectionId } from "@/features/canvas/engine/selection";
import { useCanvasInteractionStore } from "@/features/canvas/store/canvas-interaction-store";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Result contract
// ---------------------------------------------------------------------------

export type ContextualActionResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Text transforms
// ---------------------------------------------------------------------------

/** Boost verb/adjective energy with punchier, confident copy. */
function makePunchier(text: string): string {
  const punch = new Map<string, string>([
    ["good", "outstanding"],
    ["great", "incredible"],
    ["nice", "brilliant"],
    ["buy", "get yours now"],
    ["shop", "shop now"],
    ["learn more", "see how"],
    ["sign up", "join free"],
    ["start", "kick off"],
    ["help", "supercharge"],
    ["improve", "transform"],
    ["fast", "blazing fast"],
    ["easy", "effortless"],
    ["fresh", "farm-fresh"],
    ["delicious", "mouthwatering"],
    ["big", "massive"],
    ["new", "brand-new"],
    ["save", "save big"],
    ["try", "try it free"],
  ]);
  let out = text;
  for (const [from, to] of punch) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "gi"), (m) =>
      m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to,
    );
  }
  out = out.replace(/!{2,}/g, "!").trim();
  if (!/[.!?]$/.test(out) && out.split(/\s+/).length <= 6) out += "!";
  return out;
}

/** Warm, welcoming tone — softer words, gentler phrasing. */
function makeFriendly(text: string): string {
  const warm = new Map<string, string>([
    ["buy", "pick your favorites"],
    ["order", "treat yourself"],
    ["get", "enjoy"],
    ["shop now", "come on in"],
    ["buy now", "say hello"],
    ["sign up", "we'd love to have you"],
    ["cheap", "great value"],
    ["fast", "quick"],
  ]);
  let out = text;
  for (const [from, to] of warm) {
    out = out.replace(new RegExp(`\\b${from}\\b`, "gi"), (m) =>
      m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to,
    );
  }
  out = out.replace(/!{2,}/g, "!").trim();
  return out;
}

// ---------------------------------------------------------------------------
// Hindi transliteration — phrase-level dictionary + word-level fallback
// (deterministic, offline). Covers the copy this system generates; unseen
// English words transliterate phonetically so nothing is dropped.
// ---------------------------------------------------------------------------

const HI_PHRASES: Array<[RegExp, string]> = [
  [/\bfreshest\b/gi, "सबसे ताज़ा"],
  [/\bfresh\b/gi, "ताज़ा"],
  [/\bfarm\b/gi, "खेत"],
  [/\bgroceries\b/gi, "किराना"],
  [/\bgrocery\b/gi, "किराना"],
  [/\bdelivery\b/gi, "डिलीवरी"],
  [/\bdelivered\b/gi, "डिलीवर"],
  [/\bto your door\b/gi, "आपके दरवाज़े तक"],
  [/\bdoor\b/gi, "दरवाज़ा"],
  [/\borganic\b/gi, "जैविक"],
  [/\bshop now\b/gi, "अभी खरीदें"],
  [/\bbuy now\b/gi, "अभी खरीदें"],
  [/\bshop\b/gi, "दुकान"],
  [/\bbuy\b/gi, "खरीदें"],
  [/\bnow\b/gi, "अभी"],
  [/\bfree\b/gi, "मुफ़्त"],
  [/\bnew\b/gi, "नया"],
  [/\bbest\b/gi, "सर्वश्रेष्ठ"],
  [/\bprice\b/gi, "कीमत"],
  [/\bsale\b/gi, "सेल"],
  [/\bdiscount\b/gi, "छूट"],
  [/\bwelcome\b/gi, "स्वागत है"],
  [/\bhello\b/gi, "नमस्ते"],
  [/\btoday\b/gi, "आज"],
  [/\bmenu\b/gi, "मेन्यू"],
  [/\border\b/gi, "ऑर्डर"],
  [/\bstore\b/gi, "स्टोर"],
  [/\bproducts?\b/gi, "उत्पाद"],
  [/\bmilk\b/gi, "दूध"],
  [/\bbread\b/gi, "ब्रेड"],
  [/\bfruits?\b/gi, "फल"],
  [/\bvegetables?\b/gi, "सब्ज़ियाँ"],
];

const HI_WORDS: Record<string, string> = {
  a: "ए", b: "ब", c: "क", d: "ड", e: "ए", f: "फ़", g: "ग", h: "ह", i: "इ",
  j: "ज", k: "क", l: "ल", m: "म", n: "न", o: "ओ", p: "प", q: "क़", r: "र",
  s: "स", t: "ट", u: "उ", v: "व", w: "व", x: "एक्स", y: "य", z: "ज़",
};

function transliterateWord(word: string): string {
  let out = "";
  for (const ch of word) {
    const lower = ch.toLowerCase();
    out += HI_WORDS[lower] ?? ch;
  }
  return out;
}

export function translateToHindi(text: string): string {
  let out = text;
  for (const [pattern, hi] of HI_PHRASES) out = out.replace(pattern, hi);
  // Transliterate whatever English words remain.
  out = out.replace(/[A-Za-z]{2,}/g, (word) => transliterateWord(word));
  return out;
}

// ---------------------------------------------------------------------------
// Style NL parsing — "make background light green", "change button to dark orange"
// ---------------------------------------------------------------------------

const CSS_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#DC2626",
  crimson: "#DC143C",
  orange: "#F97316",
  amber: "#F59E0B",
  yellow: "#FACC15",
  lime: "#84CC16",
  green: "#16A34A",
  emerald: "#059669",
  teal: "#0D9488",
  cyan: "#06B6D4",
  sky: "#0EA5E9",
  blue: "#2563EB",
  indigo: "#4F46E5",
  violet: "#7C3AED",
  purple: "#9333EA",
  magenta: "#D946EF",
  pink: "#EC4899",
  rose: "#F43F5E",
  brown: "#92400E",
  gray: "#6B7280",
  grey: "#6B7280",
  slate: "#475569",
  mint: "#A7F3D0",
  peach: "#FDBA74",
  lavender: "#C4B5FD",
};

const SHADE_FACTORS: Record<string, number> = {
  light: 1.6,
  soft: 1.35,
  pastel: 1.7,
  dark: 0.55,
  deep: 0.5,
  bright: 1.15,
};

/** Blend a hex color toward white (>1) or black (<1) by `factor`. */
function shade(hex: string, factor: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(full, 16);
  const channel = (shift: number): number => {
    const raw = (num >> shift) & 0xff;
    const next = factor > 1 ? raw + (255 - raw) * (factor - 1) : raw * factor;
    return Math.max(0, Math.min(255, Math.round(next)));
  };
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0").toUpperCase()}`;
}

function isDarkHex(hex: string): boolean {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const num = parseInt(full, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  // Perceived luminance (Rec. 709).
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55;
}

export interface StyleRequest {
  tokens: ElementStyleTokens;
  summary: string;
}

/**
 * Parse a natural-language style request into style tokens. Returns null when
 * the request contains no recognizable color.
 */
export function parseStyleRequest(prompt: string): StyleRequest | null {
  const lower = prompt.toLowerCase();
  const wantsBackground = /background|\bbg\b/.test(lower);

  const shadeWord = Object.keys(SHADE_FACTORS).find((s) =>
    new RegExp(`\\b${s}\\b`).test(lower),
  );
  const baseColor = Object.keys(CSS_COLORS).find((c) =>
    new RegExp(`\\b${c}\\b`).test(lower),
  );
  if (!baseColor) return null;

  let hex = CSS_COLORS[baseColor];
  if (shadeWord) hex = shade(hex, SHADE_FACTORS[shadeWord]);

  const tokens: ElementStyleTokens = {};
  if (wantsBackground) {
    tokens.background = hex;
    tokens.color = isDarkHex(hex) ? "#FFFFFF" : "#0d0f14";
    return {
      tokens,
      summary: `Background set to ${shadeWord ? `${shadeWord} ` : ""}${baseColor}`,
    };
  }
  tokens.color = hex;
  return { tokens, summary: `Color set to ${shadeWord ? `${shadeWord} ` : ""}${baseColor}` };
}

// ---------------------------------------------------------------------------
// Text transform routing
// ---------------------------------------------------------------------------

type TextTransform = (text: string) => string;

const TEXT_CHIP_TRANSFORMS: Record<string, TextTransform> = {
  "Make punchier": makePunchier,
  "Change tone to friendly": makeFriendly,
  "Translate to Hindi": translateToHindi,
};

/** Free-form prompts route to transforms by keyword. */
function transformForPrompt(prompt: string): TextTransform | null {
  const lower = prompt.toLowerCase();
  if (/hindi|translate/.test(lower)) return translateToHindi;
  if (/punch|energy|exciting/.test(lower)) return makePunchier;
  if (/friendly|warm|welcoming/.test(lower)) return makeFriendly;
  return null;
}

// ---------------------------------------------------------------------------
// Section copy regeneration (deterministic "fresh items" rewrites)
// ---------------------------------------------------------------------------

const DISCOUNT_BANNER: Record<string, string> = {
  header: "FLAT 20% OFF — This week only!",
  hero: "Limited-time offer — flat 20% OFF on everything!",
  features: "Why shop with us? Extra 10% OFF your first order",
  pricing: "Bundle & save — up to 30% OFF on combo packs",
  faq: "Have questions about offers? We've answered them all",
  cta: "Grab the deal before it's gone — 20% OFF today",
  footer: "Offers valid this week only. T&C apply.",
};

/** Rewrite one copy-ish string deterministically ("fresh items" feel). */
function freshCopy(value: string, index: number): string {
  const templates = [
    (s: string) => `Fresh pick: ${s.replace(/^(fresh pick|handpicked|today's special)[^:]*:\s*/i, "")}`,
    (s: string) => `Handpicked for you — ${s.replace(/^(fresh pick|handpicked|today's special)[^:]*:\s*/i, "")}`,
    (s: string) => `Today's special: ${s.replace(/^(fresh pick|handpicked|today's special)[^:]*:\s*/i, "")}`,
  ];
  return templates[index % templates.length](value);
}

const COPY_KEYS = new Set([
  "headline", "subheadline", "title", "subtitle", "text", "description", "label",
]);
const LIST_KEYS = new Set(["items", "features", "plans", "faqs", "navLinks"]);

// ---------------------------------------------------------------------------
// Store reads
// ---------------------------------------------------------------------------

function findSection(pageId: string, sectionId: string): BaseSection | null {
  const editor = useEditorStore.getState();
  const page = editor.project.pages.find((p) => p.id === pageId);
  return page?.sections.find((s) => s.id === sectionId) ?? null;
}

// ---------------------------------------------------------------------------
// Section-level application (updateSectionProps — one withHistory entry)
// ---------------------------------------------------------------------------

function applySectionRequest(
  section: BaseSection,
  request: "discount-banner" | "regenerate-copy",
): ContextualActionResult {
  const editor = useEditorStore.getState();

  if (request === "discount-banner") {
    const headline = DISCOUNT_BANNER[section.type] ?? DISCOUNT_BANNER.hero;
    // A banner is copy, not structure — write it into the section's existing
    // secondary copy slot so every section type can carry one.
    const props: Record<string, unknown> =
      typeof section.props.subheadline === "string"
        ? { subheadline: headline }
        : typeof section.props.title === "string"
          ? { title: headline }
          : { badge: headline };
    editor.updateSectionProps(section.id, props);
    return { ok: true, summary: "Discount banner copy added" };
  }

  // regenerate-copy
  const props: Record<string, unknown> = { ...section.props };
  let listIndex = 0;
  let changed = false;
  for (const key of Object.keys(props)) {
    if (COPY_KEYS.has(key) && typeof props[key] === "string" && (props[key] as string).trim()) {
      props[key] = freshCopy(props[key] as string, listIndex++);
      changed = true;
    } else if (LIST_KEYS.has(key) && Array.isArray(props[key])) {
      props[key] = (props[key] as unknown[]).map((entry) => {
        if (entry && typeof entry === "object") {
          const row = { ...(entry as Record<string, unknown>) };
          for (const rowKey of Object.keys(row)) {
            if (COPY_KEYS.has(rowKey) && typeof row[rowKey] === "string" && row[rowKey].trim()) {
              row[rowKey] = freshCopy(row[rowKey], listIndex++);
              changed = true;
            }
          }
          return row;
        }
        if (typeof entry === "string" && entry.trim()) {
          changed = true;
          return freshCopy(entry, listIndex++);
        }
        return entry;
      });
    }
  }
  if (!changed) {
    return { ok: false, error: "Nothing to regenerate in this section" };
  }
  editor.updateSectionProps(section.id, props);
  return { ok: true, summary: "Copy regenerated with fresh items" };
}

// ---------------------------------------------------------------------------
// Element-level application (commitElementTree — one entry)
// ---------------------------------------------------------------------------

function applyElementRequest(
  target: { pageId: string; sectionId: string; elementId: string },
  kind: "text-transform" | "style",
  transform: TextTransform | null,
  style: StyleRequest | null,
): ContextualActionResult {
  const editor = useEditorStore.getState();
  const section = findSection(target.pageId, target.sectionId);
  if (!section) return { ok: false, error: "The selected section no longer exists" };

  // Re-materialize the FRESHEST tree (same discipline as the inspector).
  const freshTree = sectionToElementTree(section);

  let nextTree: ElementTree = freshTree;
  let summary: string;

  if (kind === "style" && style) {
    const result = updateElementStyle(freshTree, target.elementId, style.tokens);
    if (!result.ok) return { ok: false, error: "This element can't be styled right now" };
    nextTree = result.value;
    summary = style.summary;
  } else if (kind === "text-transform" && transform) {
    const node: ElementNode | undefined = freshTree.nodes[target.elementId];
    const current = typeof node?.props.text === "string" ? node.props.text : "";
    if (!current.trim()) {
      return { ok: false, error: "This element has no text to transform" };
    }
    const propsResult = updateElementProps(freshTree, target.elementId, {
      ...node.props,
      text: transform(current),
    });
    if (!propsResult.ok) return { ok: false, error: "This element's text can't be changed" };
    nextTree = propsResult.value;
    summary = "Text updated";
  } else {
    return { ok: false, error: "Unsupported request" };
  }

  const commit = editor.commitElementTree(target.pageId, target.sectionId, nextTree);
  return commit.ok
    ? { ok: true, summary }
    : { ok: false, error: commit.error?.message ?? "The change couldn't be saved" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ContextualTarget {
  pageId: string;
  sectionId: string;
  /** Nested element id when an element is focused; null = section-level. */
  elementId: string | null;
  nodeType: string | null;
}

/** Resolve the current contextual target from live stores (event-safe). */
export function getContextualTarget(): ContextualTarget | null {
  const editor = useEditorStore.getState();
  const page =
    editor.project.pages.find((p) => p.id === editor.selectedPageId) ??
    editor.project.pages[0];
  const section = editor.selectedSectionId
    ? page?.sections.find((s) => s.id === editor.selectedSectionId)
    : null;
  if (!page || !section) return null;

  const interaction = useCanvasInteractionStore.getState();
  const tree = sectionToElementTree(section);
  const nestedId = singleNestedSelectionId(tree, interaction.selection.ids);
  if (nestedId) {
    const node = tree.nodes[nestedId];
    if (node) {
      return {
        pageId: page.id,
        sectionId: section.id,
        elementId: nestedId,
        nodeType: node.type,
      };
    }
  }
  return { pageId: page.id, sectionId: section.id, elementId: null, nodeType: null };
}

/**
 * True when the prompt maps to a deterministic contextual action — callers
 * use this to route quick prompts locally instead of the async AI pipeline.
 */
export function isContextualPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false;
  if (parseStyleRequest(trimmed)) return true;
  if (TEXT_CHIP_TRANSFORMS[trimmed] ?? transformForPrompt(trimmed)) return true;
  return /discount|banner|offer|regenerate|fresh|rewrite/.test(trimmed.toLowerCase());
}

/** The quick chips shown for the current target kind. */
export function contextualChips(target: ContextualTarget | null): string[] {
  if (!target) return [];
  if (target.elementId && target.nodeType) {
    const textBearing = ["heading", "text", "button", "link"].includes(target.nodeType);
    if (textBearing) {
      return ["Make punchier", "Translate to Hindi", "Change tone to friendly"];
    }
    return ["Make background light green", "Change button to dark orange"];
  }
  return ["Add discount banner", "Regenerate copy with fresh items"];
}

/**
 * Run one contextual request. Chips map directly; free-form prompts are
 * parsed (style NL first, then text transforms). ONE history entry per call.
 */
export function runContextualAction(prompt: string): ContextualActionResult {
  const target = getContextualTarget();
  if (!target) {
    return { ok: false, error: "Select a section or element on the canvas first" };
  }

  const trimmed = prompt.trim();
  if (!trimmed) return { ok: false, error: "Type a request first" };
  const lower = trimmed.toLowerCase();

  // Section-level requests.
  if (target.elementId === null) {
    const section = findSection(target.pageId, target.sectionId);
    if (!section) return { ok: false, error: "The selected section no longer exists" };
    if (/discount|banner|offer/.test(lower)) {
      return applySectionRequest(section, "discount-banner");
    }
    if (/regenerate|fresh|rewrite/.test(lower)) {
      return applySectionRequest(section, "regenerate-copy");
    }
    return {
      ok: false,
      error: "Try a style or text request with an element selected, or a section chip",
    };
  }

  // Element-level: style NL wins (background/color requests). The guard
  // above guarantees `elementId` here; assert for the narrowed call shape.
  const style = parseStyleRequest(trimmed);
  if (style) {
    return applyElementRequest(
      { pageId: target.pageId, sectionId: target.sectionId, elementId: target.elementId },
      "style",
      null,
      style,
    );
  }

  // Text transforms — exact chip first, then keyword routing.
  const transform = TEXT_CHIP_TRANSFORMS[trimmed] ?? transformForPrompt(trimmed);
  if (transform) {
    return applyElementRequest(
      { pageId: target.pageId, sectionId: target.sectionId, elementId: target.elementId },
      "text-transform",
      transform,
      null,
    );
  }

  return {
    ok: false,
    error: "I couldn't map that to an action — try one of the suggestions",
  };
}
