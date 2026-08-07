// ---------------------------------------------------------------------------
// Project Normalizer
//
// Normalizes an unknown project-like structure into a valid Project object.
// Never mutates input. Runs after migration and before schema validation.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { ProjectNormalizationResult } from "../types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize an unknown project-like value into a valid Project.
 *
 * Normalization steps:
 * 1. Ensure the value is a non-null object
 * 2. Ensure required string fields are present
 * 3. Normalize assets to an array
 * 4. Ensure theme structure is minimally present
 * 5. Ensure pages and sections are arrays
 * 6. Ensure all sections have required base fields
 *
 * Does NOT run Zod validation — that is a separate step after normalization.
 * Never mutates the input.
 */
export function normalizeProject(input: unknown): ProjectNormalizationResult {
  if (!input || typeof input !== "object") {
    return {
      success: false,
      error: {
        code: "PROJECT_VALIDATION_FAILED",
        message: "Expected a project object, but the value was not an object.",
      },
    };
  }

  const raw = input as Record<string, unknown>;

  try {
    const project = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

    // Ensure id
    if (!project.id || typeof project.id !== "string") {
      project.id = generateId();
    }

    // Ensure name
    if (!project.name || typeof project.name !== "string") {
      project.name = "Untitled Project";
    }

    // Ensure createdAt and updatedAt
    if (!project.createdAt || typeof project.createdAt !== "string") {
      project.createdAt = new Date().toISOString();
    }
    if (!project.updatedAt || typeof project.updatedAt !== "string") {
      project.updatedAt = new Date().toISOString();
    }

    // Normalize assets to array
    if (!Array.isArray(project.assets)) {
      project.assets = [];
    }

    // Phase P7: siteSettings is optional content — preserved as-is when
    // present (schema validation downstream strips invalid shapes).
    if (
      project.siteSettings &&
      (typeof project.siteSettings !== "object" ||
        Array.isArray(project.siteSettings))
    ) {
      delete project.siteSettings;
    }

    // Ensure theme is at least a minimal object
    if (!project.theme || typeof project.theme !== "object") {
      project.theme = createMinimalTheme();
    }

    // Ensure pages is an array
    if (!Array.isArray(project.pages)) {
      project.pages = [];
    }

    // Normalize each page
    (project.pages as Record<string, unknown>[]).forEach((page, index) => {
      if (!page.id || typeof page.id !== "string") page.id = generateId();
      if (!page.title || typeof page.title !== "string") page.title = "Untitled";
      if (!page.slug || typeof page.slug !== "string") {
        // Only the first page defaults to the root slug. Non-home pages get a
        // slug derived from their title so legacy imports never collide with
        // the homepage route (the export validator would reject them).
        page.slug = index === 0 ? "/" : fallbackSlugFromTitle(page.title as string, index);
      }

      // Ensure sections is an array
      if (!Array.isArray(page.sections)) {
        page.sections = [];
      }

      // Normalize each section
      for (const section of page.sections as Record<string, unknown>[]) {
        if (!section.id || typeof section.id !== "string") section.id = generateId();
        if (!section.type || typeof section.type !== "string") section.type = "hero";
        if (typeof section.order !== "number") section.order = 1;
        if (typeof section.visible !== "boolean") section.visible = true;
        if (!section.props || typeof section.props !== "object") section.props = {};
        if (!section.styles || typeof section.styles !== "object") section.styles = {};
      }
    });

    // Remove transient/undefined fields that are not part of Project
    const allowedKeys = [
      "id", "name", "theme", "pages", "assets", "createdAt", "updatedAt",
      "siteSettings",
    ];
    for (const key of Object.keys(project)) {
      if (!allowedKeys.includes(key)) {
        delete project[key];
      }
    }

    return {
      success: true,
      project: project as unknown as Project,
      warnings: [],
    };
  } catch (err) {
    return {
      success: false,
      error: {
        code: "PROJECT_VALIDATION_FAILED",
        message: "Failed to normalize project structure.",
        cause: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Derive a fallback slug for a non-home page missing one. Mirrors the editor's
 * title-to-slug policy ("About" → "/about"); a title that would resolve to
 * the root (e.g. "Home") becomes "/home" instead so it never shadows the
 * homepage route.
 */
function fallbackSlugFromTitle(title: string, index: number): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return `page-${index + 1}`;
  return slug === "home" ? "/home" : `/${slug}`;
}

function createMinimalTheme() {
  return {
    palette: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      primary: "#7c5cfc",
      primaryForeground: "#ffffff",
      secondary: "#f5f5f5",
      secondaryForeground: "#0a0a0a",
      muted: "#f5f5f5",
      mutedForeground: "#737373",
      accent: "#7c5cfc",
      accentForeground: "#ffffff",
      border: "#e5e5e5",
      card: "#ffffff",
      cardForeground: "#000000",
    },
    typography: {
      fontFamily: "Geist, system-ui, sans-serif",
      headingFont: "Geist, system-ui, sans-serif",
      baseSize: "16px",
      scale: 1.25,
    },
    spacing: {
      sectionPadding: "5rem 0",
      containerMaxWidth: "1120px",
      gap: "1.5rem",
    },
    radius: {
      sm: "0.375rem",
      md: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
      full: "9999px",
    },
    shadows: {
      sm: "0 1px 2px rgba(0,0,0,0.05)",
      md: "0 4px 6px rgba(0,0,0,0.07)",
      lg: "0 10px 15px rgba(0,0,0,0.1)",
      xl: "0 20px 25px rgba(0,0,0,0.15)",
    },
  };
}
