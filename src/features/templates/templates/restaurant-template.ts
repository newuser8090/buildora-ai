// ---------------------------------------------------------------------------
// Restaurant template
//
// Header → Hero → Features (menu highlights) → CTA → Footer.
// Deterministic fixture: fresh objects every call, IDs from injected factory.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
} from "../utils/template-section-builders";

export const restaurantTemplate: BuildoraTemplate = {
  id: "template-restaurant",
  name: "Restaurant",
  description:
    "An appetizing site for a restaurant — highlights of the kitchen, a warm hero, and an easy reservation call-to-action.",
  category: "food",
  tags: ["restaurant", "cafe", "menu", "food", "hospitality"],
  sortOrder: 40,
  defaultName: "Restaurant Website",
  preview: {
    accent: "#b45309",
    background: "#1c1917",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "From the Kitchen" },
      { kind: "cta", label: "CTA" },
      { kind: "footer", label: "Footer" },
    ],
  },
  createProject(context) {
    const pageId = context.ids.pageId(context.templateId, 0);
    return {
      id: context.projectId,
      name: context.projectName,
      theme: createTemplateTheme({
        palette: { primary: "#b45309", accent: "#b45309", background: "#fffdf9" },
      }),
      assets: [],
      pages: [
        {
          id: pageId,
          title: "Home",
          slug: "/",
          sections: [
            makeSection(
              context.ids.sectionId(context.templateId, "header", 0),
              "header",
              1,
              {
                logoText: "Olive & Ash",
                navLinks: navLinks([
                  ["Menu", "#menu"],
                  ["About", "#about"],
                  ["Visit Us", "#cta"],
                ]),
                ctaText: "Reserve a Table",
                ctaHref: "#cta",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Seasonal dishes, fire and care",
                subheadline:
                  "Olive & Ash is a neighborhood kitchen cooking with local produce and open flames, seven nights a week.",
                primaryCta: { text: "Reserve a Table", href: "#cta" },
                secondaryCta: { text: "View the menu", href: "#menu" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "From the kitchen",
                subtitle:
                  "A rotating menu shaped by the season — here's what our regulars keep coming back for.",
                features: [
                  featureItem(
                    "Wood-fired sourdough",
                    "Slow-fermented overnight, baked fresh in our stone oven every morning.",
                    "Star",
                  ),
                  featureItem(
                    "Market vegetable plate",
                    "Whatever's at its peak from our growers, roasted over the coals.",
                    "Heart",
                  ),
                  featureItem(
                    "Heritage grain pasta",
                    "Rolled by hand daily and tossed with just two or three perfect ingredients.",
                    "Sparkles",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 3),
              "cta",
              4,
              {
                headline: "Come hungry, leave happy",
                subheadline:
                  "Open Tuesday through Sunday. Walk-ins welcome, reservations recommended on weekends.",
                ctaText: "Reserve a Table",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 4),
              "footer",
              5,
              {
                text: "© 2026 Olive & Ash. All rights reserved.",
                links: navLinks([
                  ["Instagram", "#"],
                  ["Menu", "#"],
                  ["Gift Cards", "#"],
                  ["Contact", "#"],
                ]),
              },
            ),
          ],
        },
      ],
      createdAt: context.createdAt,
      updatedAt: context.updatedAt,
    };
  },
};
