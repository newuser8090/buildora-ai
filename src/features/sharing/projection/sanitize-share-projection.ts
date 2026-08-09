// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — sanitized projection builder
//
// Builds the ONLY representation of a project that is ever stored server-side
// for viewers. The projection is Project-shaped so the existing VisitorPageView
// renders it unchanged, but it:
//   - blanks the canonical project id and strips all timestamps
//   - validates every section with the canonical schema and DROPS invalid
//     sections (same stance as the export pipeline)
//   - removes prototype-pollution keys defensively from nested plain objects
//   - excludes anything outside the whitelisted shape (auth, cloud records,
//     deployment data, recovery, Copilot memory, My Blocks, templates,
//     tokens — none of which live inside Project, so the whitelist itself is
//     the boundary)
//   - enforces a hard serialized size cap
//
// Pure and framework-independent.
// ---------------------------------------------------------------------------

import type { Project, Page } from "@/types/project";
import type { BaseSection } from "@/types/section";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import { PROJECTION_MAX_BYTES } from "../constants";
import type { ShareProjection } from "../types";
import { makeShareError, type ShareError } from "../errors";

export type SanitizeProjectionResult =
  | { ok: true; projection: ShareProjection; byteSize: number }
  | { ok: false; error: ShareError };

/** Keys that must never appear as own property names (defense in depth). */
const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Recursively remove prototype-pollution keys from plain objects and arrays.
 * Works on a JSON round-trip clone (own properties only), so removing them is
 * safe and cannot touch prototypes.
 */
function stripPollutionKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripPollutionKeys(item));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (POLLUTION_KEYS.has(key)) continue;
      out[key] = stripPollutionKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Deep-clone a plain JSON value (drops undefined, functions, prototypes). */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sanitize one page: keep identity + validated visible-any sections. */
function sanitizePage(rawPage: unknown): Page | null {
  if (!rawPage || typeof rawPage !== "object") return null;
  const page = rawPage as Record<string, unknown>;
  if (typeof page.id !== "string" || typeof page.title !== "string") return null;
  if (typeof page.slug !== "string") return null;
  if (!Array.isArray(page.sections)) return null;

  const sections: BaseSection[] = [];
  for (const rawSection of page.sections) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const validation = validateSectionSafe(rawSection);
    if (!validation.success) continue; // drop invalid sections silently
    sections.push(validation.data as BaseSection);
  }
  // Preserve section order deterministically.
  const ordered = [...sections].sort((a, b) => a.order - b.order);

  const out: Page = {
    id: page.id,
    title: page.title,
    slug: page.slug,
    sections: ordered,
  };
  if (page.meta && typeof page.meta === "object") {
    out.meta = stripPollutionKeys(page.meta) as Page["meta"];
  }
  return out;
}

/**
 * Build the sanitized projection for a project, or return a structured error
 * when the result would exceed the size cap.
 */
export function buildShareProjection(project: Project): SanitizeProjectionResult {
  const clone = deepClone(project);

  // Page whitelist: only id/title/slug/sections/meta survive; invalid
  // sections are dropped. Pages that fail the basic shape are dropped too.
  const rawPages: unknown[] = Array.isArray(clone.pages) ? clone.pages : [];
  const pages = rawPages
    .map((p) => sanitizePage(p))
    .filter((p): p is Page => p !== null);

  // Theme + siteSettings are public website content (validated by
  // ProjectSchema on save). Defense: strip pollution keys.
  const theme = stripPollutionKeys(clone.theme ?? {}) as Project["theme"];
  const siteSettings =
    clone.siteSettings !== undefined
      ? (stripPollutionKeys(clone.siteSettings) as Project["siteSettings"])
      : undefined;

  // Assets are the user's own site images (data URLs) needed to render the
  // site. Validated at upload; kept as-is but bounded by the size cap below.
  const assets = stripPollutionKeys(clone.assets ?? []) as Project["assets"];

  const projection: ShareProjection = {
    id: "", // canonical id is never public
    name: typeof clone.name === "string" ? clone.name : "Website",
    theme,
    pages,
    assets,
    ...(siteSettings ? { siteSettings } : {}),
  };

  let byteSize = 0;
  try {
    byteSize = new TextEncoder().encode(JSON.stringify(projection)).length;
  } catch {
    byteSize = JSON.stringify(projection).length;
  }

  if (byteSize > PROJECTION_MAX_BYTES) {
    return {
      ok: false,
      error: makeShareError(
        "PROJECTION_TOO_LARGE",
        "This website is too large to share right now. Try removing some large images.",
      ),
    };
  }

  return { ok: true, projection, byteSize };
}

/** Serialize a projection for storage/wire. */
export function serializeProjection(projection: ShareProjection): string {
  return JSON.stringify(projection);
}

/** Parse a stored/wire projection defensively; null on malformed input. */
export function parseProjection(raw: unknown): ShareProjection | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const cleaned = stripPollutionKeys(parsed) as Record<string, unknown>;
    if (typeof cleaned.name !== "string") return null;
    if (!Array.isArray(cleaned.pages)) return null;
    if (!cleaned.theme || typeof cleaned.theme !== "object") return null;
    cleaned.id = "";
    delete cleaned.createdAt;
    delete cleaned.updatedAt;
    return cleaned as unknown as ShareProjection;
  } catch {
    return null;
  }
}
