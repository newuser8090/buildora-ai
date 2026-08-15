import type { GenerationPlan } from "../types/generation-plan";

// ---------------------------------------------------------------------------
// Supported section types — single source of truth
// ---------------------------------------------------------------------------

export const SUPPORTED_SECTION_TYPES = [
  "header",
  "hero",
  "features",
  "pricing",
  "faq",
  "cta",
  "footer",
] as const;

// ---------------------------------------------------------------------------
// Input for any generation provider
// ---------------------------------------------------------------------------

export interface GenerationProviderInput {
  prompt: string;
  mode?: "create" | "modify" | "site";
  currentProjectSummary?: object;
}

// ---------------------------------------------------------------------------
// Generation result
// ---------------------------------------------------------------------------

export interface GenerationProviderResult {
  plan: GenerationPlan;
  source: "gemini" | "rule-based";
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Provider interface — all providers implement this
// ---------------------------------------------------------------------------

export interface GenerationProvider {
  readonly id: string;
  generatePlan(input: GenerationProviderInput): Promise<GenerationProviderResult>;
}

// ---------------------------------------------------------------------------
// Section normalization map — unsupported types → nearest supported
// ---------------------------------------------------------------------------

export const SECTION_NORMALIZATION: Record<string, string> = {
  services: "features",
  products: "features",
  testimonials: "features",
  about: "features",
  contact: "cta",
  menu: "pricing",
  projects: "features",
  gallery: "features",
  team: "features",
  stats: "features",
  blog: "features",
  skills: "features",
  process: "features",
  reviews: "features",
  partners: "features",
};

export function normalizeSectionType(type: string): string {
  const lower = type.toLowerCase().trim();
  if ((SUPPORTED_SECTION_TYPES as readonly string[]).includes(lower)) return lower;
  return SECTION_NORMALIZATION[lower] ?? "features";
}
