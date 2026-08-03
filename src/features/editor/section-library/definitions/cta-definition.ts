// ---------------------------------------------------------------------------
// CTA section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const ctaDefinition: SectionLibraryDefinition<"cta"> = {
  type: "cta",
  name: "Call to Action",
  description:
    "A focused banner that drives visitors to take the next step.",
  category: "conversion",
  keywords: ["cta", "call to action", "button", "signup", "conversion", "banner"],
  iconKey: "megaphone",
  recommendedPosition: "bottom",
  sortOrder: 60,
  createProps: () => ({
    headline: "Ready to get started?",
    subheadline:
      "Join thousands of happy customers and start building today.",
    ctaText: "Get Started",
    ctaHref: "#",
  }),
  createStyles: () => ({}),
};
