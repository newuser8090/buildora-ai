import type { WebsiteType, ThemeStyle, GenerationPlan } from "../types/generation-plan";
import { getTemplateSections } from "../templates/templates";
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
