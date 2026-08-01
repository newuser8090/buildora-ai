import { z } from "zod";
import { AssetRefSchema } from "@/features/assets/schemas/asset-schema";

// ---------------------------------------------------------------------------
// Canonical link item schema
// ---------------------------------------------------------------------------

export const LinkItemSchema = z.object({
  text: z.string().min(1, "Link text is required"),
  href: z.string().min(1, "Link href is required"),
});

// ---------------------------------------------------------------------------
// Feature item schema (used in Features section)
// ---------------------------------------------------------------------------

export const FeatureItemSchema = z.object({
  title: z.string().min(1, "Feature title is required"),
  description: z.string().min(1, "Feature description is required"),
  icon: z.string().default("Zap"),
});

// Extended feature item with optional asset reference
export const FeatureItemWithAssetSchema = FeatureItemSchema.extend({
  iconImage: AssetRefSchema.optional(),
});

// ---------------------------------------------------------------------------
// Pricing plan schema
// ---------------------------------------------------------------------------

export const PricingPlanSchema = z.object({
  name: z.string().min(1, "Plan name is required"),
  price: z.string().min(1, "Plan price is required"),
  description: z.string().optional().default(""),
  features: z.array(z.string()).default([]),
  cta: z.string().min(1, "Plan CTA label is required"),
  highlighted: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// FAQ item schema
// ---------------------------------------------------------------------------

export const FaqItemSchema = z.object({
  question: z.string().min(1, "Question is required"),
  answer: z.string().min(1, "Answer is required"),
});

// ---------------------------------------------------------------------------
// Section-specific props schemas
// ---------------------------------------------------------------------------

export const HeaderSectionPropsSchema = z.object({
  logoText: z.string().default("Brand"),
  logoImage: AssetRefSchema.optional(),
  navLinks: z.array(LinkItemSchema).default([]),
  ctaText: z.string().optional(),
  ctaHref: z.string().optional(),
});

export const HeroSectionPropsSchema = z.object({
  headline: z.string().default("Welcome"),
  subheadline: z.string().default(""),
  primaryCta: LinkItemSchema.default({ text: "Get Started", href: "#" }),
  secondaryCta: LinkItemSchema.optional(),
  image: z.string().optional(),
  heroImage: AssetRefSchema.optional(),
  backgroundImage: AssetRefSchema.optional(),
});

export const FeaturesSectionPropsSchema = z.object({
  title: z.string().default("Features"),
  subtitle: z.string().optional(),
  features: z.array(FeatureItemWithAssetSchema).default([]),
});

export const PricingSectionPropsSchema = z.object({
  title: z.string().default("Pricing"),
  subtitle: z.string().optional(),
  plans: z.array(PricingPlanSchema).default([]),
});

export const FaqSectionPropsSchema = z.object({
  title: z.string().default("FAQ"),
  items: z.array(FaqItemSchema).default([]),
});

export const CtaSectionPropsSchema = z.object({
  headline: z.string().default("Get Started"),
  subheadline: z.string().optional(),
  ctaText: z.string().default("Get Started"),
  ctaHref: z.string().default("#"),
  backgroundImage: AssetRefSchema.optional(),
});

export const FooterSectionPropsSchema = z.object({
  text: z.string().default("© All rights reserved."),
  links: z.array(LinkItemSchema).default([]),
  logoImage: AssetRefSchema.optional(),
});

// ---------------------------------------------------------------------------
// Section schema — discriminated union by type
// ---------------------------------------------------------------------------

export const BaseSectionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  order: z.number().int(),
  visible: z.boolean().default(true),
  styles: z.record(z.string(), z.unknown()).default({}),
});

export const HeaderSectionSchema = BaseSectionSchema.extend({
  type: z.literal("header"),
  props: HeaderSectionPropsSchema,
});

export const HeroSectionSchema = BaseSectionSchema.extend({
  type: z.literal("hero"),
  props: HeroSectionPropsSchema,
});

export const FeaturesSectionSchema = BaseSectionSchema.extend({
  type: z.literal("features"),
  props: FeaturesSectionPropsSchema,
});

export const PricingSectionSchema = BaseSectionSchema.extend({
  type: z.literal("pricing"),
  props: PricingSectionPropsSchema,
});

export const FaqSectionSchema = BaseSectionSchema.extend({
  type: z.literal("faq"),
  props: FaqSectionPropsSchema,
});

export const CtaSectionSchema = BaseSectionSchema.extend({
  type: z.literal("cta"),
  props: CtaSectionPropsSchema,
});

export const FooterSectionSchema = BaseSectionSchema.extend({
  type: z.literal("footer"),
  props: FooterSectionPropsSchema,
});

// ---------------------------------------------------------------------------
// Discriminated union — the canonical validation for all section types
// ---------------------------------------------------------------------------

export const AnySectionSchema = z.discriminatedUnion("type", [
  HeaderSectionSchema,
  HeroSectionSchema,
  FeaturesSectionSchema,
  PricingSectionSchema,
  FaqSectionSchema,
  CtaSectionSchema,
  FooterSectionSchema,
]);

// ---------------------------------------------------------------------------
// Styles schema for section styles
// ---------------------------------------------------------------------------

export const SectionStylesSchema = z.object({
  textAlign: z.string().optional(),
  padding: z.string().optional(),
  background: z.string().optional(),
  color: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Validate and normalize a section — returns validated section or throws
// ---------------------------------------------------------------------------

export function validateSection(section: unknown) {
  return AnySectionSchema.parse(section);
}

export function validateSectionSafe(section: unknown) {
  return AnySectionSchema.safeParse(section);
}

// ---------------------------------------------------------------------------
// Infer types for use in renderers
// ---------------------------------------------------------------------------

export type ValidatedHeaderSection = z.infer<typeof HeaderSectionSchema>;
export type ValidatedHeroSection = z.infer<typeof HeroSectionSchema>;
export type ValidatedFeaturesSection = z.infer<typeof FeaturesSectionSchema>;
export type ValidatedPricingSection = z.infer<typeof PricingSectionSchema>;
export type ValidatedFaqSection = z.infer<typeof FaqSectionSchema>;
export type ValidatedCtaSection = z.infer<typeof CtaSectionSchema>;
export type ValidatedFooterSection = z.infer<typeof FooterSectionSchema>;
export type ValidatedAnySection = z.infer<typeof AnySectionSchema>;
