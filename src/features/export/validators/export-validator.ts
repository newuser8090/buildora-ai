import type { Project } from "@/types/project";
import { AnySectionSchema } from "@/features/editor/schemas/section-schemas";
import { ProjectSchema, ThemeSchema } from "@/features/generation/schemas/generation-plan-schema";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import type { ExportValidation } from "../pipeline/types";

// ---------------------------------------------------------------------------
// Project export validator
//
// Runs before ZIP generation to catch:
//   - Missing or invalid project structure
//   - Invalid section schemas
//   - Unsupported section types
//   - Missing required props on sections
//   - Malformed theme
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateProjectForExport(project: Project): ExportValidation {
  const errors: string[] = [];

  // 0. Read known types from the singleton registry
  //    Fall back to a hardcoded list if the registry is empty
  //    (e.g. in test environments where section registration hasn't run)
  const KNOWN_TYPES_FALLBACK = [
    "header", "hero", "features", "pricing", "faq", "cta", "footer",
  ];
  const knownTypes = sectionRegistry.types.length > 0
    ? sectionRegistry.types
    : KNOWN_TYPES_FALLBACK;

  // 1. Project level — full structural validation via ProjectSchema
  const projectSchemaResult = ProjectSchema.safeParse(project);
  if (!projectSchemaResult.success) {
    for (const issue of projectSchemaResult.error.issues) {
      errors.push(`Project structure: ${issue.path.join(".")} — ${issue.message}`);
    }
  }

  // 1b. Validate theme structure
  if (!project.theme) {
    errors.push("Project theme is required");
  } else {
    const themeResult = ThemeSchema.safeParse(project.theme);
    if (!themeResult.success) {
      for (const issue of themeResult.error.issues) {
        errors.push(`Theme: ${issue.path.join(".")} — ${issue.message}`);
      }
    }
  }

  // 2. Pages
  if (!project.pages || project.pages.length === 0) {
    errors.push("Project must have at least one page");
    return { valid: false, errors };
  }

  for (const page of project.pages) {
    if (!page.id) errors.push("Each page must have an id");
    if (!page.title) errors.push("Each page must have a title");
    if (!page.slug) errors.push(`Page "${page.id}" must have a slug`);

    if (!page.sections || page.sections.length === 0) {
      errors.push(`Page "${page.id}" must have at least one section`);
      continue;
    }

    // 3. Sections
    for (const section of page.sections) {
      if (!knownTypes.includes(section.type)) {
        errors.push(
          `Section "${section.id}" has unsupported type "${section.type}". Known types: ${knownTypes.join(", ")}`,
        );
        continue;
      }

      // Validate against Zod schema
      const result = AnySectionSchema.safeParse(section);
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push(
            `Section "${section.id}" (${section.type}): ${issue.path.join(".")} — ${issue.message}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
