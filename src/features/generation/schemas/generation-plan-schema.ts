import { z } from "zod";
import { AssetRefSchema } from "@/features/assets/schemas/asset-schema";
import { SiteSettingsSchema } from "@/features/site-settings/schema";

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
});
