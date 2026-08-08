// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — BuildoraTemplate converter
//
// Wraps a stored PersonalTemplateRecord as a BuildoraTemplate so the ENTIRE
// existing template pipeline (gallery, card, preview dialog, factory) works
// unchanged for personal templates. The createProject() contract is the same
// as built-ins: fresh IDs from the injected factory, fresh timestamps, no
// shared mutable references, and a schema-valid Project result.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate, TemplatePreviewSection } from "@/features/templates/types";
import { TemplateCategory } from "@/features/templates/types";
import type { PersonalTemplateRecord } from "../types";

const SECTION_KIND_HINTS: Record<string, "header" | "hero" | "content" | "pricing" | "cta" | "footer"> = {
  header: "header",
  hero: "hero",
  features: "content",
  content: "content",
  about: "content",
  skills: "content",
  experience: "content",
  pricing: "pricing",
  plans: "pricing",
  cta: "cta",
  footer: "footer",
};

function labelForType(type: string): string {
  if (!type) return "Section";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Deterministic TemplatePreview derived from the stored project snapshot. */
export function derivePreviewFromProject(record: PersonalTemplateRecord) {
  const theme = record.project.theme;
  const firstPage = record.project.pages[0];
  const sections: TemplatePreviewSection[] = (firstPage?.sections ?? [])
    .slice(0, 12)
    .map((section) => ({
      kind: SECTION_KIND_HINTS[section.type] ?? "content",
      label: labelForType(section.type),
    }));

  return {
    accent: theme.palette.primary ?? "#7c5cfc",
    background: theme.palette.background ?? "#ffffff",
    badge: "Yours",
    sections,
  };
}

/**
 * Wrap a personal template record as a BuildoraTemplate.
 *
 * createProject(context) deep-clones the stored snapshot, assigns fresh
 * project/page/section IDs from the injected factory, sets the project name
 * and timestamps from the context, and returns a schema-valid Project. The
 * caller (TemplateProjectFactory) deep-clones + validates again as its
 * standard contract.
 */
export function personalTemplateToBuildoraTemplate(
  record: PersonalTemplateRecord,
): BuildoraTemplate {
  return {
    id: record.id,
    name: record.name,
    description:
      record.description ||
      `Your saved template — start a new project from "${record.name}".`,
    category: record.category,
    tags: record.tags,
    source: "personal",
    defaultName: record.name,
    preview: derivePreviewFromProject(record),
    createProject(context) {
      const built = JSON.parse(
        JSON.stringify(record.project),
      ) as PersonalTemplateRecord["project"];

      built.id = context.projectId;
      built.name = context.projectName;
      built.createdAt = context.createdAt;
      built.updatedAt = context.updatedAt;
      built.pages = built.pages.map((page, pageIndex) => {
        const freshPage = {
          ...page,
          id: context.ids.pageId(context.templateId, pageIndex),
        };
        freshPage.sections = page.sections.map((section, sectionIndex) => ({
          ...section,
          id: context.ids.sectionId(
            context.templateId,
            section.type,
            sectionIndex,
          ),
        }));
        return freshPage;
      });

      return built;
    },
  };
}

// Keep the category type import meaningful for the label helper.
export type { TemplateCategory };
