import type { WebsiteType, ThemeStyle, GenerationPlan } from "../types/generation-plan";
import { getTemplateSections } from "../templates/templates";
import { getSiteTemplatePages } from "../templates/site-templates";
import { THEME_TOKENS } from "./theme-resolver";

// ---------------------------------------------------------------------------
// Prompt Analyzer — deterministic rule-based parsing
// No AI, no external APIs.
// ---------------------------------------------------------------------------

const WEBSITE_KEYWORDS: Record<string, WebsiteType> = {
  saas: "saas",
  "landing page": "saas",
  software: "saas",
  app: "saas",

  portfolio: "portfolio",
  personal: "portfolio",
  "personal site": "portfolio",

  agency: "agency",
  "creative agency": "agency",
  studio: "agency",

  restaurant: "restaurant",
  cafe: "restaurant",
  "food truck": "restaurant",
  bakery: "restaurant",

  ecommerce: "ecommerce",
  store: "ecommerce",
  shop: "ecommerce",
  "online store": "ecommerce",
};

const THEME_KEYWORDS: Record<string, ThemeStyle> = {
  dark: "dark",
  light: "light",
  minimal: "minimal",
  modern: "modern",
  luxury: "luxury",
  premium: "luxury",
  elegant: "luxury",
  startup: "startup",
  clean: "minimal",
  "bold": "modern",
};

const BRAND_INDICATORS = ["for", "called", "named", "brand"];

// ---------------------------------------------------------------------------
// Parse a prompt string into a GenerationPlan
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Phase P22-I — site/multi-page intent detection + site analysis
//
// Detection is deliberately CONSERVATIVE: ordinary landing-page prompts
// (e.g. "Build a dark SaaS website for Huddle", "Build a restaurant website")
// must keep producing the existing single-page create output. Only clear
// multi-page signals flip a create prompt into site generation.
// ---------------------------------------------------------------------------

/** Explicit "<page> page" hints — the strongest single signal. */
const SITE_PAGE_HINTS = [
  "about page",
  "about us page",
  "pricing page",
  "contact page",
  "contact us page",
  "menu page",
  "shop page",
  "services page",
  "features page",
  "projects page",
  "faq page",
  "blog page",
];

/** "multi-page" / "multipage" / "multi page". */
const SITE_MULTI_PAGE = /\bmulti[- ]?page\b/i;

/** "5 pages", "several pages", "multiple pages", "a few pages". */
const SITE_PAGE_COUNT = /\b(?:\d+|several|multiple|a few|few)\s+pages?\b/i;

/** "website with …" / "site with …". */
const SITE_WITH = /\b(?:website|web\s*site|site)\s+with\b/i;

/** Page-name tokens that make "website with …" a site prompt. */
const SITE_PAGE_TOKENS =
  /\b(?:about|pricing|contact|menu|shop|services|features|projects|faq|blog)\b/i;

/**
 * True when the prompt shows clear multi-page/site intent. Used by the
 * /api/generate route (server-side detection) so the client composer can keep
 * sending the ordinary create request (Phase P22-I, decision D2/D4).
 */
export function detectSiteIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (SITE_MULTI_PAGE.test(lower)) return true;
  if (SITE_PAGE_COUNT.test(lower)) return true;
  if (SITE_WITH.test(lower) && SITE_PAGE_TOKENS.test(lower)) return true;
  return SITE_PAGE_HINTS.some((hint) => lower.includes(hint));
}

/** Detect the website type — first keyword match wins (mirrors create). */
function detectWebsiteType(lower: string): WebsiteType {
  for (const [keyword, type] of Object.entries(WEBSITE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      return type;
    }
  }
  return "saas";
}

/** Detect the theme style — first keyword match wins (mirrors create). */
function detectThemeStyle(lower: string): ThemeStyle {
  for (const [keyword, t] of Object.entries(THEME_KEYWORDS)) {
    if (lower.includes(keyword)) {
      return t;
    }
  }
  return "modern";
}

/** Extract a brand name — "called X"/"named X" first, then first proper noun. */
function extractBrandName(prompt: string, websiteType: WebsiteType): string {
  const words = prompt.split(/\s+/);
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i].toLowerCase();
    if (BRAND_INDICATORS.includes(w) && i + 1 < words.length) {
      const next = words[i + 1].replace(/[^a-zA-Z0-9]/g, "");
      if (next.length >= 2 && next[0] === next[0].toUpperCase()) {
        return next;
      }
    }
  }
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, "");
    if (
      clean.length >= 3 &&
      clean[0] === clean[0].toUpperCase() &&
      !["A", "An", "The", "For", "With", "And", "My", "Our"].includes(clean)
    ) {
      return clean;
    }
  }
  return websiteType.charAt(0).toUpperCase() + websiteType.slice(1);
}

/**
 * Build a deterministic multi-page site plan from the prompt (Phase P22-I).
 * Uses the canonical site templates; every page is schema-valid by
 * construction and shares one theme.
 */
export function analyzeSitePrompt(prompt: string): GenerationPlan {
  const lower = prompt.toLowerCase().trim();
  const websiteType = detectWebsiteType(lower);
  const theme = detectThemeStyle(lower);
  const brandName = extractBrandName(prompt, websiteType);
  const pages = getSiteTemplatePages(websiteType, brandName);
  return {
    websiteType,
    brandName,
    theme,
    sections: pages[0].sections,
    pages,
  };
}

export function analyzePrompt(prompt: string): GenerationPlan {
  const lower = prompt.toLowerCase().trim();

  // 1. Detect website type
  let websiteType: WebsiteType = "saas"; // default fallback
  for (const [keyword, type] of Object.entries(WEBSITE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      websiteType = type;
      break;
    }
  }

  // 2. Detect theme
  let theme: ThemeStyle = "modern"; // default fallback
  for (const [keyword, t] of Object.entries(THEME_KEYWORDS)) {
    if (lower.includes(keyword)) {
      theme = t;
      break;
    }
  }

  // 3. Extract brand name — look for capitalized words after "for"/"called"
  const words = prompt.split(/\s+/);
  let brandName = "";

  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (BRAND_INDICATORS.includes(w) && i + 1 < words.length) {
      const next = words[i + 1].replace(/[^a-zA-Z0-9]/g, "");
      if (next.length >= 2 && next[0] === next[0].toUpperCase()) {
        brandName = next;
        break;
      }
    }
  }

  // If no brand found, try the first capitalized word that isn't a keyword
  if (!brandName) {
    for (const word of words) {
      const clean = word.replace(/[^a-zA-Z0-9]/g, "");
      if (
        clean.length >= 3 &&
        clean[0] === clean[0].toUpperCase() &&
        !["A", "An", "The", "For", "With", "And", "My", "Our"].includes(clean)
      ) {
        brandName = clean;
        break;
      }
    }
  }

  if (!brandName) {
    // Generate a name from the website type
    brandName = websiteType.charAt(0).toUpperCase() + websiteType.slice(1);
  }

  // 4. Get template sections
  const sections = getTemplateSections(websiteType, brandName, theme);

  return {
    websiteType,
    brandName,
    theme,
    sections,
  };
}

export { THEME_TOKENS };
