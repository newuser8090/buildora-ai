// ---------------------------------------------------------------------------
// Pricing section definition
// ---------------------------------------------------------------------------

import type { SectionLibraryDefinition } from "../types";

export const pricingDefinition: SectionLibraryDefinition<"pricing"> = {
  type: "pricing",
  name: "Pricing",
  description:
    "Three pricing plans with a highlighted recommended tier for maximum clarity.",
  category: "commerce",
  keywords: ["pricing", "plans", "tiers", "subscription", "billing", "payment"],
  iconKey: "tag",
  recommendedPosition: "middle",
  sortOrder: 40,
  createProps: () => ({
    title: "Simple, transparent pricing",
    subtitle: "Choose the plan that fits you. Upgrade or cancel anytime.",
    plans: [
      {
        name: "Starter",
        price: "$0",
        description: "For individuals getting started.",
        features: [
          "1 project",
          "Basic AI generation",
          "Landing page templates",
          "Community support",
        ],
        cta: "Start Free",
      },
      {
        name: "Pro",
        price: "$19",
        description: "For professionals who need more power.",
        features: [
          "Unlimited projects",
          "Advanced AI & custom prompts",
          "All templates & sections",
          "Custom domains",
          "Priority support",
        ],
        cta: "Start Free Trial",
        highlighted: true,
      },
      {
        name: "Enterprise",
        price: "Custom",
        description: "For teams and organizations at scale.",
        features: [
          "Everything in Pro",
          "Team collaboration",
          "Shared asset library",
          "Dedicated support",
        ],
        cta: "Contact Sales",
      },
    ],
  }),
  createStyles: () => ({}),
};
