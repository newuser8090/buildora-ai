// ---------------------------------------------------------------------------
// Section labels — consistent readable labels for the structure panel
//
// Pure, deterministic, no mutation. Malformed props never crash label
// generation — every lookup is defensive and falls back to the section type.
// No objects are ever rendered directly; all output is a plain string.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";

export const SECTION_TYPE_LABELS: Record<string, string> = {
  header: "Header",
  hero: "Hero",
  features: "Features",
  pricing: "Pricing",
  faq: "FAQ",
  cta: "CTA",
  footer: "Footer",
};

export const MAX_LABEL_LENGTH = 48;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function excerpt(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_LABEL_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
}

/** Human-readable name for a section type. */
export function getSectionTypeLabel(type: string): string {
  return SECTION_TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

/**
 * Readable, deterministic label for a section — used in the structure panel.
 *
 *   Header   → logo text            ("Your Brand")
 *   Hero     → headline excerpt
 *   Features → section title
 *   Pricing  → section title
 *   FAQ      → section title
 *   CTA      → headline excerpt
 *   Footer   → copyright excerpt
 *
 * Falls back to the section type label when props are missing or malformed.
 */
export function getSectionLabel(section: Pick<BaseSection, "type" | "props">): string {
  const typeLabel = getSectionTypeLabel(section.type);

  // Defensive: never throw on malformed props.
  if (!section.props || typeof section.props !== "object") return typeLabel;

  const props = section.props as Record<string, unknown>;

  switch (section.type) {
    case "header": {
      const logo = asString(props.logoText);
      return logo ? excerpt(logo) : typeLabel;
    }
    case "hero": {
      const headline = asString(props.headline);
      return headline ? excerpt(headline) : typeLabel;
    }
    case "features": {
      const title = asString(props.title);
      return title ? excerpt(title) : typeLabel;
    }
    case "pricing": {
      const title = asString(props.title);
      return title ? excerpt(title) : typeLabel;
    }
    case "faq": {
      const title = asString(props.title);
      return title ? excerpt(title) : typeLabel;
    }
    case "cta": {
      const headline = asString(props.headline);
      return headline ? excerpt(headline) : typeLabel;
    }
    case "footer": {
      const text = asString(props.text);
      return text ? excerpt(text) : typeLabel;
    }
    default:
      return typeLabel;
  }
}
