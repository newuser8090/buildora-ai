import { z } from "zod";
import { AssetRefSchema } from "@/features/assets/schemas/asset-schema";
import { SiteSettingsSchema } from "@/features/site-settings/schema";
import { ResponsiveDecisionsSchema } from "@/features/elements/responsive/decisions";
import { CollectionsSchema } from "@/features/elements/schemas/collection-schema";
import { validateSlug } from "@/features/routing/routes";

// ---------------------------------------------------------------------------
// Planned section schema
// ---------------------------------------------------------------------------

export const PlannedSectionSchema = z.object({
  type: z.string().min(1),
  order: z.number().int().min(1),
  props: z.record(z.string(), z.unknown()).default({}),
});

// ---------------------------------------------------------------------------
// Theme style — validate as string, constrained
// ---------------------------------------------------------------------------

const ThemeStyleEnum = z.string().refine(
  (v) => ["modern", "minimal", "dark", "light", "luxury", "startup"].includes(v),
  { message: "Invalid theme style" },
);

// ---------------------------------------------------------------------------
// Site plan bounds (Phase P22-I) — 2–6 pages, one shared theme
// ---------------------------------------------------------------------------

export const SITE_MIN_PAGES = 2;
export const SITE_MAX_PAGES = 6;

// ---------------------------------------------------------------------------
// Planned page schema (Phase P22-I)
// ---------------------------------------------------------------------------

export const PlannedPageSchema = z.object({
  title: z.string().min(1, "Page title is required").max(80, "Page title too long"),
  slug: z
    .string()
    .min(1)
    .refine((v) => validateSlug(v).valid, { message: "Invalid page slug" }),
  sections: z.array(PlannedSectionSchema).min(1, "At least one section required per page"),
});

export type PlannedPageInput = z.infer<typeof PlannedPageSchema>;

// ---------------------------------------------------------------------------
// Full GenerationPlan schema (what Gemini outputs)
// ---------------------------------------------------------------------------

export const GenerationPlanSchema = z.object({
  websiteType: z
    .string()
    .refine(
      (v) =>
        ["saas", "portfolio", "agency", "restaurant", "ecommerce"].includes(v),
      { message: "Invalid website type" },
    )
    .default("saas"),
  brandName: z.string().min(1, "Brand name is required").default("MyBrand"),
  theme: ThemeStyleEnum.default("modern"),
  sections: z.array(PlannedSectionSchema).min(1, "At least one section required"),
  // Phase P22-I — optional multi-page site plan (2–6 pages). Ordinary
  // single-page create plans omit it entirely.
  pages: z
    .array(PlannedPageSchema)
    .min(SITE_MIN_PAGES, `Site plans need at least ${SITE_MIN_PAGES} pages`)
    .max(SITE_MAX_PAGES, `Site plans are limited to ${SITE_MAX_PAGES} pages`)
    .optional(),
});

export type GeminiPlanInput = z.infer<typeof GenerationPlanSchema>;

// ---------------------------------------------------------------------------
// Project validation schema
// ---------------------------------------------------------------------------

const PalleteSchema = z.object({
  background: z.string(),
  foreground: z.string(),
  primary: z.string(),
  primaryForeground: z.string(),
  secondary: z.string(),
  secondaryForeground: z.string(),
  muted: z.string(),
  mutedForeground: z.string(),
  accent: z.string(),
  accentForeground: z.string(),
  border: z.string(),
  card: z.string(),
  cardForeground: z.string(),
});

export const ThemeSchema = z.object({
  palette: PalleteSchema,
  typography: z.object({
    fontFamily: z.string(),
    headingFont: z.string(),
    baseSize: z.string(),
    scale: z.number(),
  }),
  spacing: z.object({
    sectionPadding: z.string(),
    containerMaxWidth: z.string(),
    gap: z.string(),
  }),
  radius: z.object({
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    xl: z.string(),
    full: z.string(),
  }),
  shadows: z.object({
    sm: z.string(),
    md: z.string(),
    lg: z.string(),
    xl: z.string(),
  }),
});

const AssetSourceSchema = z.object({
  type: z.literal("data-url"),
  value: z.string().min(1),
});

const AssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["image", "logo", "background", "icon", "illustration"]),
  mimeType: z.string().min(1),
  extension: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  source: AssetSourceSchema,
  createdAt: z.string().min(1),
  altText: z.string().optional(),
});

const BaseSectionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  order: z.number().int(),
  visible: z.boolean(),
  props: z.record(z.string(), z.unknown()),
  styles: z.record(z.string(), z.unknown()),
});

const PageMetaSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(500).optional(),
  socialTitle: z.string().max(200).optional(),
  socialDescription: z.string().max(500).optional(),
  socialImage: AssetRefSchema.optional(),
  index: z.boolean().optional(),
  canonicalUrl: z.string().max(500).optional(),
});

const PageSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().min(1),
  sections: z.array(BaseSectionSchema).min(1),
  meta: PageMetaSchema.optional(),
});

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  theme: ThemeSchema,
  pages: z.array(PageSchema).min(1),
  assets: z.array(AssetSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  siteSettings: SiteSettingsSchema.optional(),
  // Phase P22-F — optional persisted responsive decisions (bounded, validated
  // allow-list transformations). Old projects without the field stay valid.
  responsiveDecisions: ResponsiveDecisionsSchema.optional(),
  // Phase P22-J — optional durable collection definitions (id/name/fields,
  // bounded + allow-listed field types). Old projects without the field stay
  // valid; runtime records never enter the document.
  collections: CollectionsSchema.optional(),
});
