// ---------------------------------------------------------------------------
// Page structure — pure page-list manipulation helpers
//
// Mirrors the section-structure module conventions: framework-independent,
// NEVER mutate inputs, return either a new array or a structured error. The
// editor store wraps these in a single history entry per logical action.
// ---------------------------------------------------------------------------

import type { Page, PageMeta } from "@/types/project";
import type { BaseSection } from "@/types/section";
import { isReservedSlugSegment } from "@/features/routing/routes";

// ---------------------------------------------------------------------------
// Structured errors
// ---------------------------------------------------------------------------

export type PageStructureErrorCode =
  | "PAGE_NOT_FOUND"
  | "CANNOT_DELETE_LAST_PAGE"
  | "CANNOT_MOVE_OUT_OF_BOUNDS"
  | "INVALID_PAGE_TITLE";

export interface PageStructureError {
  code: PageStructureErrorCode;
  message: string;
}

export type PageStructureResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PageStructureError };

// ---------------------------------------------------------------------------
// Identity — deterministic-ish, collision-resistant (same approach as the
// section ID factory). Page IDs are generated at the orchestration boundary.
// ---------------------------------------------------------------------------

let pageIdCounter = 0;

export function createPageId(): string {
  pageIdCounter += 1;
  const base = Date.now().toString(36);
  return `page-${base}-${pageIdCounter}`;
}

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/**
 * Derive a URL slug from a page title.
 *   - "Home" → "/" (the conventional root path)
 *   - "About Us" → "/about-us"
 *   - "" (or punctuation-only) → "/"
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug === "home") return "/";
  return `/${slug}`;
}

/**
 * Resolve a unique slug for a page with the given title, avoiding conflicts
 * with every other page's slug.
 *
 * Root policy (mirrors the export homepage policy): only the FIRST page may
 * own the root slug "/". For any other page a "Home" title falls back to
 * "/home", "/home-2", … so editor state always exports cleanly.
 *
 * Reserved segments (api, _next, "_"-prefixed, brackets) are auto-avoided by
 * appending a numeric suffix, keeping derived slugs export-valid.
 */
export function resolveUniqueSlug(
  pages: Page[],
  title: string,
  excludePageId?: string,
): string {
  const indexOfPage = excludePageId
    ? pages.findIndex((p) => p.id === excludePageId)
    : -1;
  const isFirstPage = pages.length === 0 || indexOfPage === 0;
  const taken = new Set(
    pages.filter((p) => p.id !== excludePageId).map((p) => p.slug),
  );
  const base = slugifyTitle(title);

  // The root slug is only available to the first (home) page.
  const canUseRoot = isFirstPage && base === "/" && !taken.has("/");
  if (canUseRoot) return "/";

  if (base === "/") {
    let n = 1;
    while (taken.has(n === 1 ? "/home" : `/home-${n}`)) n += 1;
    return n === 1 ? "/home" : `/home-${n}`;
  }

  // Avoid reserved segments (e.g. a page titled "API").
  const baseReserved = base
    .slice(1)
    .split("/")
    .some((segment) => isReservedSlugSegment(segment));
  if (!baseReserved && !taken.has(base)) return base;

  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ---------------------------------------------------------------------------
// Title validation
// ---------------------------------------------------------------------------

export interface PageTitleValidation {
  valid: boolean;
  error?: string;
}

export function validatePageTitle(title: unknown): PageTitleValidation {
  if (typeof title !== "string" || title.trim().length === 0) {
    return { valid: false, error: "Page name cannot be empty." };
  }
  if (title.trim().length > 60) {
    return { valid: false, error: "Page name must be 60 characters or fewer." };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Page construction
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Page metadata
// ---------------------------------------------------------------------------

export interface PageMetaInput {
  title?: unknown;
  description?: unknown;
}

/**
 * Sanitize page metadata for storage: trim, enforce length caps, and drop
 * empty values (empty strings become undefined so stale keys are removed).
 */
export function sanitizePageMeta(input: PageMetaInput | undefined): PageMeta {
  const result: PageMeta = {};
  if (input && typeof input.title === "string" && input.title.trim().length > 0) {
    result.title = input.title.trim().slice(0, 200);
  }
  if (
    input &&
    typeof input.description === "string" &&
    input.description.trim().length > 0
  ) {
    result.description = input.description.trim().slice(0, 500);
  }
  return result;
}

export interface BuildPageInput {
  pageId: string;
  sectionId: string;
  title: string;
  slug: string;
}

/**
 * Build a fresh Page with a single starter hero section so the result always
 * satisfies the Project schema (pages require at least one section).
 */
export function buildPage(input: BuildPageInput): Page {
  const starterSection: BaseSection = {
    id: input.sectionId,
    type: "hero",
    order: 1,
    visible: true,
    props: {
      headline: "New page",
      subheadline: "Start building this page by adding sections.",
      primaryCta: { text: "Get Started", href: "#" },
    },
    styles: {},
  };
  return {
    id: input.pageId,
    title: input.title,
    slug: input.slug,
    sections: [starterSection],
  };
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

/** Append a page to the end of the list. Never mutates the input. */
export function addPageToList(pages: Page[], page: Page): Page[] {
  return [...pages, page];
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export interface RenamePageInput {
  pages: Page[];
  pageId: string;
  title: string;
}

export interface RenamePageOutput {
  pages: Page[];
  /** True when the title or slug actually changed. */
  changed: boolean;
}

/**
 * Rename a page and re-derive its slug (unique against the other pages).
 * Returns changed:false when the title and slug are both unchanged (the
 * caller skips the history entry for no-ops).
 */
export function renamePageInList(
  input: RenamePageInput,
): PageStructureResult<RenamePageOutput> {
  const { pages, pageId, title } = input;

  const index = pages.findIndex((p) => p.id === pageId);
  if (index === -1) {
    return {
      ok: false,
      error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
    };
  }

  const validation = validatePageTitle(title);
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: "INVALID_PAGE_TITLE",
        message: validation.error ?? "Invalid page name.",
      },
    };
  }

  const trimmed = title.trim();
  const slug = resolveUniqueSlug(pages, trimmed, pageId);
  const existing = pages[index];
  if (existing.title === trimmed && existing.slug === slug) {
    return { ok: true, value: { pages, changed: false } };
  }

  const next = [...pages];
  next[index] = { ...existing, title: trimmed, slug };
  return { ok: true, value: { pages: next, changed: true } };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export interface DeletePageOutput {
  pages: Page[];
  /** Id of the page that should be selected next, or null. */
  nextSelection: string | null;
}

/**
 * Remove a page. Refuses to delete the final page (Project schema requires
 * ≥ 1 page). Selection policy mirrors sections: nearest next, else previous.
 */
export function deletePageFromList(
  pages: Page[],
  pageId: string,
): PageStructureResult<DeletePageOutput> {
  const index = pages.findIndex((p) => p.id === pageId);
  if (index === -1) {
    return {
      ok: false,
      error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
    };
  }

  if (pages.length <= 1) {
    return {
      ok: false,
      error: {
        code: "CANNOT_DELETE_LAST_PAGE",
        message: "A project must keep at least one page.",
      },
    };
  }

  const remaining = pages.filter((p) => p.id !== pageId);
  const nextSelection = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
  return { ok: true, value: { pages: remaining, nextSelection } };
}

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export interface MovePageOutput {
  pages: Page[];
  /** True when the order actually changed (false for no-ops). */
  changed: boolean;
  /** Index of the moved page in the new array. */
  activeIndex: number;
}

/** Move a page to an absolute index (0-based). No-op when already there. */
export function movePageToIndex(
  pages: Page[],
  pageId: string,
  targetIndex: number,
): PageStructureResult<MovePageOutput> {
  const fromIndex = pages.findIndex((p) => p.id === pageId);
  if (fromIndex === -1) {
    return {
      ok: false,
      error: { code: "PAGE_NOT_FOUND", message: `Page "${pageId}" does not exist.` },
    };
  }

  if (targetIndex < 0 || targetIndex >= pages.length) {
    return {
      ok: false,
      error: {
        code: "CANNOT_MOVE_OUT_OF_BOUNDS",
        message: `Target index ${targetIndex} is out of bounds (0–${pages.length - 1}).`,
      },
    };
  }

  if (targetIndex === fromIndex) {
    return { ok: true, value: { pages, changed: false, activeIndex: fromIndex } };
  }

  const next = [...pages];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, moved);
  return { ok: true, value: { pages: next, changed: true, activeIndex: targetIndex } };
}
