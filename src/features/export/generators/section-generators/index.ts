import type { OutputFile } from "../../pipeline/types";
import { generateHeaderComponent } from "./header-generator";
import { generateHeroComponent } from "./hero-generator";
import { generateFeaturesComponent } from "./features-generator";
import { generatePricingComponent } from "./pricing-generator";
import { generateFaqComponent } from "./faq-generator";
import { generateCtaComponent } from "./cta-generator";
import { generateFooterComponent } from "./footer-generator";

// ---------------------------------------------------------------------------
// Section generator registry — maps type string to generator function
//
// Each generator produces an OutputFile (a reusable React component)
// that the page.tsx imports and renders with per-section props.
// ---------------------------------------------------------------------------

export type SectionGenerator = () => OutputFile;

const sectionGenerators: Record<string, SectionGenerator> = {
  header: generateHeaderComponent,
  hero: generateHeroComponent,
  features: generateFeaturesComponent,
  pricing: generatePricingComponent,
  faq: generateFaqComponent,
  cta: generateCtaComponent,
  footer: generateFooterComponent,
};

export { generateHeaderComponent, generateHeroComponent, generateFeaturesComponent, generatePricingComponent, generateFaqComponent, generateCtaComponent, generateFooterComponent };

/** Get a section generator by type. Returns undefined for unknown types. */
export function getSectionGenerator(type: string): SectionGenerator | undefined {
  return sectionGenerators[type];
}

/** Get all registered section generator types. */
export function getSectionGeneratorTypes(): string[] {
  return Object.keys(sectionGenerators);
}

/** Generate all registered section components. */
export function generateAllSectionComponents(): OutputFile[] {
  return Object.values(sectionGenerators).map((gen) => gen());
}
