// ---------------------------------------------------------------------------
// Site Settings — zod schema (Phase P7)
//
// Validates `Project.siteSettings`. Kept in its own module so the main
// ProjectSchema (generation-plan-schema) can import it without cycles.
//
// Design rules:
//   - ALL fields optional except siteName (which can be empty-string during
//     editing; the READINESS engine treats a blank siteName as a finding)
//   - max-length caps match the serializer/exporter limits
//   - robotsIndex/robotsFollow default true when absent (via defaults in
//     helpers, not forced into storage)
// ---------------------------------------------------------------------------

import { z } from "zod";
import { AssetRefSchema } from "@/features/assets/schemas/asset-schema";

export const SiteSeoSettingsSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  keywords: z.array(z.string().max(100)).max(30).optional(),
  canonicalUrl: z.string().max(500).optional(),
  robotsIndex: z.boolean().optional(),
  robotsFollow: z.boolean().optional(),
});

export const SiteSocialSettingsSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  image: AssetRefSchema.optional(),
});

export const SiteAppearanceSettingsSchema = z.object({
  themeColor: z.string().max(50).optional(),
});

export const SiteSettingsSchema = z.object({
  siteName: z.string().max(120),
  siteDescription: z.string().max(500).optional(),
  language: z.string().max(20).optional(),
  favicon: AssetRefSchema.optional(),
  seo: SiteSeoSettingsSchema.optional(),
  social: SiteSocialSettingsSchema.optional(),
  appearance: SiteAppearanceSettingsSchema.optional(),
});

export type SiteSettingsZod = z.infer<typeof SiteSettingsSchema>;

// ---------------------------------------------------------------------------
// Sanitization — trim + drop empties so storage stays clean
// ---------------------------------------------------------------------------

/**
 * Sanitize partial site-settings input for storage. Empty strings become
 * undefined so stale keys are dropped. Never mutates the input.
 */
export function sanitizeSiteSettings(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};

  const out: Record<string, unknown> = {};

  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const siteName = str(input.siteName);
  if (siteName) out.siteName = siteName;

  const siteDescription = str(input.siteDescription);
  if (siteDescription) out.siteDescription = siteDescription;

  const language = str(input.language);
  if (language) out.language = language;

  const favicon =
    input.favicon && typeof input.favicon === "object"
      ? sanitizeAssetRef(input.favicon)
      : undefined;
  if (favicon) out.favicon = favicon;

  const seo =
    input.seo && typeof input.seo === "object"
      ? sanitizeSeo(input.seo)
      : undefined;
  if (seo && Object.keys(seo).length > 0) out.seo = seo;

  const social =
    input.social && typeof input.social === "object"
      ? sanitizeSocial(input.social)
      : undefined;
  if (social && Object.keys(social).length > 0) out.social = social;

  const appearance =
    input.appearance && typeof input.appearance === "object"
      ? sanitizeAppearance(input.appearance)
      : undefined;
  if (appearance && Object.keys(appearance).length > 0) {
    out.appearance = appearance;
  }

  return out;
}

function sanitizeAssetRef(ref: unknown): { assetId: string; altText?: string } | undefined {
  const r = ref as { assetId?: unknown; altText?: unknown };
  if (!r || typeof r.assetId !== "string" || r.assetId.trim().length === 0) {
    return undefined;
  }
  const out: { assetId: string; altText?: string } = { assetId: r.assetId.trim() };
  if (typeof r.altText === "string" && r.altText.trim().length > 0) {
    out.altText = r.altText.trim();
  }
  return out;
}

function sanitizeSeo(seo: unknown): Record<string, unknown> {
  const s = seo as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;

  const title = str(s.title);
  if (title) out.title = title;
  const description = str(s.description);
  if (description) out.description = description;
  const canonicalUrl = str(s.canonicalUrl);
  if (canonicalUrl) out.canonicalUrl = canonicalUrl;
  if (Array.isArray(s.keywords)) {
    const keywords = s.keywords
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter((k) => k.length > 0)
      .slice(0, 30);
    if (keywords.length > 0) out.keywords = keywords;
  }
  if (typeof s.robotsIndex === "boolean") out.robotsIndex = s.robotsIndex;
  if (typeof s.robotsFollow === "boolean") out.robotsFollow = s.robotsFollow;
  return out;
}

function sanitizeSocial(social: unknown): Record<string, unknown> {
  const s = social as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const title = str(s.title);
  if (title) out.title = title;
  const description = str(s.description);
  if (description) out.description = description;
  const image =
    s.image && typeof s.image === "object"
      ? sanitizeAssetRef(s.image)
      : undefined;
  if (image) out.image = image;
  return out;
}

function sanitizeAppearance(appearance: unknown): Record<string, unknown> {
  const a = appearance as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const themeColor = str(a.themeColor);
  if (themeColor) out.themeColor = themeColor;
  return out;
}
