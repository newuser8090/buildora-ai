// ---------------------------------------------------------------------------
// registerDefaultTemplates — registers the built-in template set once
//
// Idempotent and Strict-Mode safe: repeated calls are no-ops, so a double
// effect invocation can never throw DUPLICATE_TEMPLATE_ID or duplicate
// registrations.
// ---------------------------------------------------------------------------

import { templateRegistry } from "./template-registry";
import { blankTemplate } from "../templates/blank-template";
import { saasTemplate } from "../templates/saas-template";
import { portfolioTemplate } from "../templates/portfolio-template";
import { agencyTemplate } from "../templates/agency-template";
import { restaurantTemplate } from "../templates/restaurant-template";
import { ecommerceTemplate } from "../templates/ecommerce-template";
import { startupTemplate } from "../templates/startup-template";
import type { BuildoraTemplate } from "../types";

const DEFAULT_TEMPLATES: BuildoraTemplate[] = [
  blankTemplate,
  saasTemplate,
  startupTemplate,
  portfolioTemplate,
  agencyTemplate,
  restaurantTemplate,
  ecommerceTemplate,
];

let registered = false;

/**
 * Register all default templates exactly once. Safe to call from effects in
 * React Strict Mode and from tests (after clear(), set registered = false
 * via resetTemplateRegistration()).
 */
export function registerDefaultTemplates(): void {
  if (registered) return;
  registered = true;
  for (const template of DEFAULT_TEMPLATES) {
    templateRegistry.register(template);
  }
}

/** Test helper — allow re-registration after templateRegistry.clear(). */
export function resetTemplateRegistration(): void {
  registered = false;
}
