import type { Project } from "@/types/project";
import type { GenerationPlan, WebsiteType, ThemeStyle } from "../types/generation-plan";

// ---------------------------------------------------------------------------
// Generation stage — 7-stage enriched lifecycle
// ---------------------------------------------------------------------------

export type GenerationStage =
  | "idle"
  | "understanding"
  | "brand"
  | "direction"
  | "structure"
  | "content"
  | "building"
  | "finalizing"
  | "done"
  | "error";

export interface StageInfo {
  label: string;
  detail?: string;
}

export const STAGE_INFO: Record<Exclude<GenerationStage, "idle" | "done" | "error">, StageInfo> = {
  understanding: {
    label: "Understanding your request",
  },
  brand: {
    label: "Identifying your brand",
  },
  direction: {
    label: "Choosing a visual direction",
  },
  structure: {
    label: "Planning the page structure",
  },
  content: {
    label: "Writing website content",
  },
  building: {
    label: "Building editable sections",
  },
  finalizing: {
    label: "Finalizing your website",
  },
};

export const STAGE_ORDER: GenerationStage[] = [
  "understanding",
  "brand",
  "direction",
  "structure",
  "content",
  "building",
  "finalizing",
  "done",
];

export interface GenerationResult {
  project: Project;
  plan: GenerationPlan;
  source: "gemini" | "rule-based";
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Build a final assistant summary message
// ---------------------------------------------------------------------------

const THEME_ADJECTIVES: Record<string, string> = {
  dark: "dark",
  light: "clean, light",
  modern: "modern",
  minimal: "minimal",
  luxury: "luxury",
  startup: "startup",
};

export function buildSummary(
  plan: GenerationPlan,
  source: "gemini" | "rule-based",
): string {
  const { brandName, websiteType, theme, sections } = plan;
  const sectionCount = sections.length;
  const typeLabel = websiteType.charAt(0).toUpperCase() + websiteType.slice(1);

  const sectionNames = sections.map((s) => {
    const map: Record<string, string> = {
      header: "Header",
      hero: "Hero",
      features: "Features",
      pricing: "Pricing",
      faq: "FAQ",
      cta: "CTA",
      footer: "Footer",
    };
    return map[s.type] ?? s.type.charAt(0).toUpperCase() + s.type.slice(1);
  });

  const last = sectionNames.pop();
  const sectionList =
    sectionNames.length > 0
      ? sectionNames.join(", ") + ", and " + last
      : last ?? "";

  const adj = THEME_ADJECTIVES[theme] ?? "";
  const themeDesc = adj ? `${adj}, ` : "";

  const typeStr = `${themeDesc}${typeLabel.toLowerCase()}`;

  if (source === "gemini") {
    return `I created a ${typeStr} landing page for ${brandName} with ${sectionCount} editable sections: ${sectionList}. Select any section in the preview to customize its content and spacing.`;
  }

  return `I created your ${typeStr} website using Buildora's local generation engine because Gemini was unavailable. The result is still fully editable with ${sectionCount} sections: ${sectionList}.`;
}

// ---------------------------------------------------------------------------
// Run generation — calls POST /api/generate
// ---------------------------------------------------------------------------

export async function runGeneration(
  prompt: string,
  onStage: (stage: GenerationStage) => void,
): Promise<GenerationResult> {
  if (!prompt.trim()) {
    throw new Error("Prompt cannot be empty");
  }

  // 7-stage lifecycle with minimal delays to avoid flashing
  onStage("understanding");
  await sleep(150);

  onStage("brand");
  await sleep(120);

  onStage("direction");
  await sleep(100);

  // API call happens during "structure" stage
  onStage("structure");
  await sleep(80);

  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, mode: "create" }),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error?.message || "Generation failed");
  }

  onStage("content");
  await sleep(120);

  onStage("building");
  await sleep(100);

  onStage("finalizing");
  await sleep(80);

  return {
    project: data.project as Project,
    plan: {
      websiteType: (data.source === "gemini" ? inferType(data.project) : "saas") as WebsiteType,
      brandName: data.project.name.split(" — ")[0] || "MyBrand",
      theme: inferTheme(data.project) as ThemeStyle,
      sections: data.project.pages[0]?.sections ?? [],
    },
    source: data.source as "gemini" | "rule-based",
    warnings: data.warnings as string[],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inferType(project: Project): string {
  const name = project.name.toLowerCase();
  if (name.includes("saas")) return "saas";
  if (name.includes("portfolio")) return "portfolio";
  if (name.includes("agency")) return "agency";
  if (name.includes("restaurant")) return "restaurant";
  if (name.includes("ecommerce") || name.includes("store")) return "ecommerce";
  return "saas";
}

function inferTheme(project: Project): string {
  const bg = project.theme.palette.background;
  if (bg === "#0a0a0a" || bg === "#000000") return "dark";
  if (bg === "#fafafa") return "minimal";
  if (project.theme.palette.primary === "#2563eb") return "light";
  if (project.theme.palette.primary === "#b8860b") return "luxury";
  if (project.theme.palette.accent === "#10b981") return "startup";
  return "modern";
}
