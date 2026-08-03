// ---------------------------------------------------------------------------
// Header section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const headerDefinition: SectionLibraryDefinition<"header"> = {
  type: "header",
  name: "Header",
  description:
    "Top navigation with your brand, menu links, and a call-to-action button.",
  category: "navigation",
  keywords: ["nav", "menu", "brand", "logo", "navigation", "top bar", "navbar"],
  iconKey: "menu",
  recommendedPosition: "top",
  singleton: true,
  sortOrder: 10,
  createProps: () => ({
    logoText: "Your Brand",
    navLinks: [
      { text: "Home", href: "#" },
      { text: "Features", href: "#features" },
      { text: "Pricing", href: "#pricing" },
    ],
    ctaText: "Get Started",
    ctaHref: "#",
  }),
  createStyles: () => ({}),
};
