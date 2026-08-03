// ---------------------------------------------------------------------------
// Footer section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const footerDefinition: SectionLibraryDefinition<"footer"> = {
  type: "footer",
  name: "Footer",
  description:
    "Closing section with copyright text and useful links.",
  category: "footer",
  keywords: ["footer", "copyright", "links", "bottom", "contact", "legal"],
  iconKey: "panel-bottom",
  recommendedPosition: "bottom",
  singleton: true,
  sortOrder: 70,
  createProps: () => ({
    text: "© 2026 Your Brand. All rights reserved.",
    links: [
      { text: "Privacy", href: "#" },
      { text: "Terms", href: "#" },
      { text: "Contact", href: "#" },
    ],
  }),
  createStyles: () => ({}),
};
