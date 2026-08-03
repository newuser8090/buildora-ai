// ---------------------------------------------------------------------------
// Features section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const featuresDefinition: SectionLibraryDefinition<"features"> = {
  type: "features",
  name: "Features",
  description:
    "Highlight three key capabilities with titles, descriptions, and icons.",
  category: "content",
  keywords: ["features", "benefits", "grid", "cards", "capabilities", "services"],
  iconKey: "layout-grid",
  recommendedPosition: "middle",
  sortOrder: 30,
  createProps: () => ({
    title: "Everything you need to succeed",
    subtitle:
      "Powerful capabilities designed to help you move faster and ship with confidence.",
    features: [
      {
        title: "Lightning Fast",
        description:
          "Optimized for speed with a sub-second load time on every device.",
        icon: "Zap",
      },
      {
        title: "Secure by Design",
        description:
          "Bank-grade encryption and automatic backups keep your data safe.",
        icon: "Shield",
      },
      {
        title: "Easy to Use",
        description:
          "A clean, intuitive interface anyone can master in minutes.",
        icon: "MousePointerClick",
      },
    ],
  }),
  createStyles: () => ({}),
};
