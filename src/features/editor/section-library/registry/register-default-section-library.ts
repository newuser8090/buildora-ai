// ---------------------------------------------------------------------------
// register-default-section-library — registers all built-in definitions
//
// Idempotent: safe to call multiple times. Mirrors registerDefaultTemplates.
// ---------------------------------------------------------------------------

import { sectionLibraryRegistry } from "./section-library-registry";
import { headerDefinition } from "../definitions/header-definition";
import { heroDefinition } from "../definitions/hero-definition";
import { featuresDefinition } from "../definitions/features-definition";
import { pricingDefinition } from "../definitions/pricing-definition";
import { faqDefinition } from "../definitions/faq-definition";
import { ctaDefinition } from "../definitions/cta-definition";
import { footerDefinition } from "../definitions/footer-definition";

const DEFAULT_DEFINITIONS = [
  headerDefinition,
  heroDefinition,
  featuresDefinition,
  pricingDefinition,
  faqDefinition,
  ctaDefinition,
  footerDefinition,
] as const;

let registered = false;

/**
 * Register the default section library exactly once. Safe to call repeatedly —
 * subsequent calls are no-ops (idempotent).
 */
export function registerDefaultSectionLibrary(): void {
  if (registered) return;
  for (const definition of DEFAULT_DEFINITIONS) {
    sectionLibraryRegistry.register(definition);
  }
  registered = true;
}

/** Test-only: reset the idempotency guard. */
export function resetSectionLibraryRegistration(): void {
  registered = false;
}
