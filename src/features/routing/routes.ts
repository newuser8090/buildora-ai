// ---------------------------------------------------------------------------
// Routing — slug validation, route resolution, and cross-page link handling
//
// Shared by the editor (slug auto-derivation policy), the export pipeline
// (route files + link resolution), and the export validator.
//
// Homepage policy:
//   The FIRST page in project.pages is the homepage. It is always exported at
//   the root route "/" (app/page.tsx), regardless of its slug value. Every
//   other page is exported at its slug route (app/<slug>/page.tsx). Slugs of
//   non-home pages must be valid, unique, non-root, and non-reserved.
// ---------------------------------------------------------------------------

import type { Page } from "@/types/project";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical root slug — reserved for the homepage. */
export const ROOT_SLUG = "/";

/** Slug segments that collide with Next.js App Router conventions. */
export const RESERVED_SLUG_SEGMENTS = new Set(["api", "_next"]);

// ---------------------------------------------------------------------------
// Slug validation
// ---------------------------------------------------------------------------

export interface SlugValidation {
  valid: boolean;
  error?: string;
}

/**
 * True when a single slug segment cannot be used as a route segment.
 *   - reserved names (api, _next)
 *   - private folders ("_"-prefixed)
 *   - dynamic segments / route groups / catch-alls ("[", "]", "(", ")")
 */
export function isReservedSlugSegment(segment: string): boolean {
  return (
    RESERVED_SLUG_SEGMENTS.has(segment) ||
    segment.startsWith("_") ||
    /[\[\]()]/.test(segment)
  );
}

/**
 * Validate a page slug for use as an exported route.
 *
 * Rules:
 *   - non-empty string, starts with "/"
 *   - root "/" is always valid
 *   - segments: lowercase letters, numbers, hyphens only
 *   - no "//", no trailing slash, no "." / ".." segments
 *   - no reserved segments
 */
export function validateSlug(value: unknown): SlugValidation {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { valid: false, error: "Slug must be a non-empty string." };
  }

  const slug = value.trim();

  if (!slug.startsWith("/")) {
    return { valid: false, error: 'Slug must start with "/".' };
  }

  if (slug === ROOT_SLUG) return { valid: true };

  if (slug.endsWith("/")) {
    return {
      valid: false,
      error: 'Slug must not end with "/" (only the root slug "/" may).',
    };
  }

  const segments = slug.slice(1).split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return { valid: false, error: 'Slug must not contain "//".' };
    }
    if (segment === "." || segment === "..") {
      return { valid: false, error: `Slug segment "${segment}" is not allowed.` };
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment)) {
      return {
        valid: false,
        error:
          `Slug segment "${segment}" may only contain lowercase letters, ` +
          `numbers and hyphens.`,
      };
    }
    if (isReservedSlugSegment(segment)) {
      return {
        valid: false,
        error: `Slug segment "${segment}" is a reserved path and cannot be used.`,
      };
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Slug → route mapping
// ---------------------------------------------------------------------------

/** Map a slug to its browser URL (trailing-slash-free; root stays "/"). */
export function slugToRouteUrl(slug: string): string {
  if (!slug || slug === ROOT_SLUG) return ROOT_SLUG;
  return slug.replace(/\/+$/, "");
}

/** Map a slug to its Next.js App Router file path. */
export function slugToRoutePath(slug: string): string {
  const route = slugToRouteUrl(slug);
  return route === ROOT_SLUG ? "app/page.tsx" : `app${route}/page.tsx`;
}

// ---------------------------------------------------------------------------
// Project route table
// ---------------------------------------------------------------------------

export interface PageRoute {
  page: Page;
  /** Canonical browser route, e.g. "/" or "/about". */
  routeUrl: string;
  /** Route file path inside the exported project, e.g. "app/about/page.tsx". */
  filePath: string;
  /** True for the first page (the homepage). */
  isHome: boolean;
}

/**
 * Compute the export route table for a project.
 *
 * Homepage policy: index 0 is the homepage and always owns "/". Non-home
 * pages are exported at their slug routes. The input is expected to pass
 * validateRoutingForExport (non-home slugs valid, unique, non-root).
 */
export function computePageRoutes(pages: Page[]): PageRoute[] {
  return pages.map((page, index) => {
    if (index === 0) {
      return {
        page,
        routeUrl: ROOT_SLUG,
        filePath: "app/page.tsx",
        isHome: true,
      };
    }
    const slug = page.slug || ROOT_SLUG;
    return {
      page,
      routeUrl: slugToRouteUrl(slug),
      filePath: slugToRoutePath(slug),
      isHome: false,
    };
  });
}

// ---------------------------------------------------------------------------
// Cross-page internal link resolution
// ---------------------------------------------------------------------------

function findPageBySlug(path: string, routes: PageRoute[]): PageRoute | null {
  const normalized = slugToRouteUrl(path);
  if (normalized === ROOT_SLUG) {
    // The root route always resolves to the homepage (even when the
    // homepage's own slug differs from "/").
    return routes.find((r) => r.isHome) ?? null;
  }
  // Exact slug match first (the homepage's slug also resolves to "/").
  const exact = routes.find((r) => r.page.slug === normalized);
  if (exact) return exact;
  // Fall back to matching the canonical route URL.
  return routes.find((r) => r.routeUrl === normalized) ?? null;
}

/**
 * Resolve a user-authored href against the project's page routes.
 *
 *   - external protocols (http/https/mailto/tel/data) → unchanged
 *   - "#anchor" and empty → unchanged
 *   - "/" → homepage route
 *   - slug-matching paths → the target page's canonical route
 *   - unknown internal paths → unchanged (may be an external future route)
 *
 * Query strings and hash fragments are preserved.
 */
export function resolveInternalHref(
  href: unknown,
  pageRoutes: PageRoute[],
): string {
  if (typeof href !== "string" || href.trim().length === 0) return "#";

  const value = href.trim();

  // External or special protocols are never rewritten.
  if (/^(?:https?:|mailto:|tel:|ftp:|data:|\/\/|#)/i.test(value)) {
    return value;
  }

  // Bare paths without a leading slash (e.g. "about") match page slugs too.
  const withSlash = value.startsWith("/") ? value : `/${value}`;

  // Split off the query/hash suffix so matching compares pathnames only.
  const suffixIndex = withSlash.search(/[?#]/);
  const path = suffixIndex === -1 ? withSlash : withSlash.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : withSlash.slice(suffixIndex);

  const match = findPageBySlug(path, pageRoutes);
  if (match) return `${match.routeUrl}${suffix}`;

  return value;
}

// ---------------------------------------------------------------------------
// Export validation — routing rules
// ---------------------------------------------------------------------------

/**
 * Collect routing errors for export:
 *   - homepage slug must be valid (format)
 *   - non-home pages: valid slug, non-root, unique, not shadowing the
 *     homepage slug, no reserved segments
 */
export function validateRoutingForExport(pages: Page[]): string[] {
  const errors: string[] = [];
  if (pages.length === 0) return errors;

  const home = pages[0];
  const homeSlugResult = validateSlug(home.slug);
  if (!homeSlugResult.valid) {
    errors.push(`Homepage slug "${home.slug}" is invalid: ${homeSlugResult.error}`);
  }

  const seenRoutes = new Map<string, number>();

  pages.forEach((page, index) => {
    if (index === 0) return;

    const slugResult = validateSlug(page.slug);
    if (!slugResult.valid) {
      errors.push(
        `Page "${page.id}" (${page.title}) has an invalid slug "${page.slug}": ${slugResult.error}`,
      );
      return;
    }

    if (page.slug === ROOT_SLUG) {
      errors.push(
        `Page "${page.id}" (${page.title}) uses the root slug "/" — only the first page (the homepage) may own the root route.`,
      );
      return;
    }

    if (page.slug === home.slug) {
      errors.push(
        `Page "${page.id}" (${page.title}) has the same slug as the homepage ("${page.slug}") — page slugs must be unique.`,
      );
      return;
    }

    const route = slugToRouteUrl(page.slug);
    const previous = seenRoutes.get(route);
    if (previous !== undefined) {
      errors.push(
        `Pages "${pages[previous].id}" and "${page.id}" share the route "${route}" — page slugs must be unique.`,
      );
    } else {
      seenRoutes.set(route, index);
    }
  });

  return errors;
}
