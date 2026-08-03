// ---------------------------------------------------------------------------
// Base section — the generic shape the store and renderer work with
// ---------------------------------------------------------------------------

export interface BaseSection {
  id: string;
  type: string;
  order: number;
  visible: boolean;
  props: Record<string, unknown>;
  styles: Record<string, unknown>;
}

import type { AssetRef } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Typed props for each known section type
// Each type is a plain object — no hardcoding into the model.
// ---------------------------------------------------------------------------

export interface HeaderSectionProps {
  logoText: string;
  /** Optional logo image asset */
  logoImage?: AssetRef;
  navLinks: { text: string; href: string }[];
  ctaText?: string;
  ctaHref?: string;
}

export interface HeroSectionProps {
  headline: string;
  subheadline: string;
  primaryCta: { text: string; href: string };
  secondaryCta?: { text: string; href: string };
  /** Hero image (URL string or legacy field) */
  image?: string;
  /** Optional hero image asset */
  heroImage?: AssetRef;
  /** Optional background image asset */
  backgroundImage?: AssetRef;
}

export interface FeaturesSectionProps {
  title: string;
  subtitle?: string;
  features: {
    title: string;
    description: string;
    icon: string;
    /** Optional icon image asset */
    iconImage?: AssetRef;
  }[];
}

export interface PricingSectionProps {
  title: string;
  subtitle?: string;
  plans: {
    name: string;
    price: string;
    description: string;
    features: string[];
    cta: string;
    highlighted?: boolean;
  }[];
}

export interface FaqSectionProps {
  title: string;
  items: {
    question: string;
    answer: string;
  }[];
}

export interface CtaSectionProps {
  headline: string;
  subheadline?: string;
  ctaText: string;
  ctaHref: string;
  /** Optional background image asset */
  backgroundImage?: AssetRef;
}

export interface FooterSectionProps {
  text: string;
  links: { text: string; href: string }[];
  /** Optional footer logo image asset */
  logoImage?: AssetRef;
}

// ---------------------------------------------------------------------------
// Section props map — maps section type strings to their typed props
// ---------------------------------------------------------------------------

export interface SectionPropsMap {
  header: HeaderSectionProps;
  hero: HeroSectionProps;
  features: FeaturesSectionProps;
  pricing: PricingSectionProps;
  faq: FaqSectionProps;
  cta: CtaSectionProps;
  footer: FooterSectionProps;
}

// Convenience type for a section with known typed props
export type TypedSection<T extends keyof SectionPropsMap> = BaseSection & {
  type: T;
  props: SectionPropsMap[T];
};
