// ---------------------------------------------------------------------------
// Hero section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const heroDefinition: SectionLibraryDefinition<"hero"> = {
  type: "hero",
  name: "Hero",
  description:
    "A bold opening section with a headline, supporting text, and two actions.",
  category: "hero",
  keywords: ["hero", "intro", "headline", "landing", "banner", "cover", "welcome"],
  iconKey: "sparkles",
  recommendedPosition: "top",
  sortOrder: 20,
  createProps: () => ({
    headline: "Build something amazing today",
    subheadline:
      "A focused message that tells visitors exactly what you offer and why they should care.",
    primaryCta: { text: "Get Started", href: "#" },
    secondaryCta: { text: "Learn more", href: "#" },
  }),
  createStyles: () => ({}),
};
