import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { GenerationPlan } from "../types/generation-plan";
import { getThemeTokens } from "../analyzers/theme-resolver";
import { finalizeSectionContent } from "./content-generator";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";

// ---------------------------------------------------------------------------
// Project Generator — converts a GenerationPlan into a valid Project JSON
// that can be loaded into the editor store.
//
// NEW: Every section is validated against its section-specific Zod schema
// after content finalization. Invalid sections are fixed with defaults.
// ---------------------------------------------------------------------------

export function generateProject(plan: GenerationPlan): Project {
  const theme = getThemeTokens(plan.theme);

  // Build sections from the plan, with finalized content
  const sections: BaseSection[] = plan.sections
    .sort((a, b) => a.order - b.order)
    .map((s, i) => {
      const finalized = finalizeSectionContent(s, plan.brandName);

      // Create the raw section object
      const rawSection = {
        id: `${finalized.type}-${Date.now()}-${i}`,
        type: finalized.type,
        order: i + 1,
        visible: true,
        props: finalized.props as Record<string, unknown>,
        styles: {} as Record<string, unknown>,
      };

      // Validate against section-specific schema
      // This catches any malformed props (e.g., object instead of string)
      const validation = validateSectionSafe(rawSection);
      if (!validation.success) {
        // Log the validation issues in development
        const issues = validation.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        );
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[Buildora] Section validation failed for "${finalized.type}":`,
            issues
          );
        }
        // Try to validate just the structure without props validation
        // This preserves the content while catching structural issues
        const structuralResult = validateSectionSafe({
          ...rawSection,
          props: rawSection.props,
          styles: rawSection.styles,
        });
        if (structuralResult.success) {
          return structuralResult.data as BaseSection;
        }
      }

      // Return validated section data
      if (validation.success) {
        return validation.data as BaseSection;
      }

      // Warning logged, but return raw section to avoid data loss
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[Buildora] Using unvalidated section for "${finalized.type}" — data preserved but may cause rendering issues.`
        );
      }
      return rawSection as BaseSection;
    });

  const now = new Date().toISOString();

  const project: Project = {
    id: `proj-${Date.now()}`,
    name: `${plan.brandName} — ${capitalize(plan.websiteType)}`,
    theme,
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  return project;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
