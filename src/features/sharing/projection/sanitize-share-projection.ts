// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — sanitized projection builder
// ---------------------------------------------------------------------------

import type { Project, Page } from "@/types/project";
import type { BaseSection } from "@/types/section";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import { stripCustomCodeFromProject } from "@/features/code-import/services/strip-custom-code";
import { PROJECTION_MAX_BYTES } from "../constants";
import type { ShareProjection } from "../types";
import { makeShareError, type ShareError } from "../errors";

export type SanitizeProjectionResult =
  | { ok: true; projection: ShareProjection; byteSize: number }
  | { ok: false; error: ShareError };

const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function stripPollutionKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripPollutionKeys(item));
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

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sanitizePage(rawPage: unknown): Page | null {
  if (!rawPage || typeof rawPage !== "object") return null;
  const page = rawPage as Record<string, unknown>;
  if (typeof page.id !== "string" || typeof page.title !== "string") return null;
  if (typeof page.slug !== "string" || !Array.isArray(page.sections)) return null;

  const sections: BaseSection[] = [];
  for (const rawSection of page.sections) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const validation = validateSectionSafe(rawSection);
    if (!validation.success) continue;
    sections.push(validation.data as BaseSection);
  }

  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    sections: [...sections].sort((a, b) => a.order - b.order),
    ...(page.meta && typeof page.meta === "object"
      ? { meta: stripPollutionKeys(page.meta) as Page["meta"] }
      : {}),
  };
}

export function buildShareProjection(project: Project): SanitizeProjectionResult {
  // P23-E: sharing is a public/distributed artifact, never an execution
  // transport. Strip custom code before canonical section validation so an
  // enabled editor node can never reach a shared viewer payload.
  const clone = stripCustomCodeFromProject(deepClone(project));

  const rawPages: unknown[] = Array.isArray(clone.pages) ? clone.pages : [];
  const pages = rawPages
    .map((p) => sanitizePage(p))
    .filter((p): p is Page => p !== null);

  const theme = stripPollutionKeys(clone.theme ?? {}) as Project["theme"];
  const siteSettings = clone.siteSettings !== undefined
    ? (stripPollutionKeys(clone.siteSettings) as Project["siteSettings"])
    : undefined;
  const assets = stripPollutionKeys(clone.assets ?? []) as Project["assets"];

  const projection: ShareProjection = {
    id: "",
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

export function serializeProjection(projection: ShareProjection): string {
  return JSON.stringify(projection);
}

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
