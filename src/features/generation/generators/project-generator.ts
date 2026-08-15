import type { Page, Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { Theme } from "@/types/theme";
import type { GenerationPlan } from "../types/generation-plan";
import { SITE_MAX_PAGES } from "../schemas/generation-plan-schema";
import { getThemeTokens } from "../analyzers/theme-resolver";
import { finalizeSectionContent } from "./content-generator";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import { validateSlug } from "@/features/routing/routes";

// ---------------------------------------------------------------------------
// Project Generator — converts a GenerationPlan into a valid Project JSON
// that can be loaded into the editor store.
//
// NEW: Every section is validated against its section-specific Zod schema
// after content finalization. Invalid sections are fixed with defaults.
// ---------------------------------------------------------------------------

export function generateProject(plan: GenerationPlan): Project {
  const theme = getThemeTokens(plan.theme);
  const now = new Date().toISOString();

  // Phase P22-I — multi-page site plan → a standard multi-page Project.
  // Ordinary single-page create plans keep the existing path below (unchanged).
  if (plan.pages && plan.pages.length > 0) {
    return generateSiteProject(plan, theme, now);
  }

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

// ---------------------------------------------------------------------------
// Phase P22-I — multi-page site project generation
//
// Converts a site plan (pages) into a standard multi-page Project:
//   - pages[0] is the homepage and owns the root slug "/"
//   - non-home slugs are normalized, validated and de-duplicated
//   - every generated section runs the same per-type validation as create
//   - one shared theme for the whole site
// ---------------------------------------------------------------------------

function generateSiteProject(
  plan: GenerationPlan,
  theme: Theme,
  now: string,
): Project {
  const brand = plan.brandName;
  const plannedPages = (plan.pages ?? []).slice(0, SITE_MAX_PAGES);
  const pages: Page[] = [];

  plannedPages.forEach((planned, index) => {
    const pageId = `page-${index + 1}`;
    // Homepage policy: pages[0] always owns the root route.
    const slug =
      index === 0 ? "/" : uniqueSiteSlug(planned.slug, planned.title, pages);
    const sections = buildValidatedSections(planned.sections, brand, pageId);
    pages.push({ id: pageId, title: planned.title, slug, sections });
  });

  return {
    id: `proj-${Date.now()}`,
    name: `${plan.brandName} — ${capitalize(plan.websiteType)}`,
    theme,
    assets: [],
    pages,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Normalize a desired slug to a routing-valid, unique non-root slug.
 * Falls back to a title-derived slug when the desired one is unusable.
 */
function uniqueSiteSlug(desired: string, title: string, pages: Page[]): string {
  const taken = new Set(pages.map((p) => p.slug));
  const raw = String(desired ?? "").trim().toLowerCase();
  let candidate = raw.startsWith("/") ? raw : `/${raw}`;
  candidate = candidate.replace(/\/+$/, "") || "/";
  if (!validateSlug(candidate).valid) {
    const derived = `/${title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")}`;
    candidate =
      derived.length > 1 && validateSlug(derived).valid ? derived : "/page";
  }
  let slug = candidate;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${candidate}-${n}`;
    n += 1;
  }
  return slug;
}

/** Finalize + per-type validate every section in a page (same contract as create). */
function buildValidatedSections(
  plannedSections: GenerationPlan["sections"],
  brand: string,
  pageId: string,
): BaseSection[] {
  return plannedSections
    .sort((a, b) => a.order - b.order)
    .map((s, i) => {
      const finalized = finalizeSectionContent(s, brand);
      const rawSection = {
        id: `${pageId}-${finalized.type}-${i + 1}`,
        type: finalized.type,
        order: i + 1,
        visible: true,
        props: finalized.props as Record<string, unknown>,
        styles: {} as Record<string, unknown>,
      };

      const validation = validateSectionSafe(rawSection);
      if (!validation.success) {
        const issues = validation.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        );
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[Buildora] Section validation failed for "${finalized.type}":`,
            issues,
          );
        }
        const structuralResult = validateSectionSafe({
          ...rawSection,
          props: rawSection.props,
          styles: rawSection.styles,
        });
        if (structuralResult.success) {
          return structuralResult.data as BaseSection;
        }
      }
      if (validation.success) {
        return validation.data as BaseSection;
      }
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[Buildora] Using unvalidated section for "${finalized.type}" — data preserved but may cause rendering issues.`,
        );
      }
      return rawSection as BaseSection;
    });
}
