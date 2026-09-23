// ---------------------------------------------------------------------------
// Modern Bakery template
//
// Header → Hero → Features (what we bake) → CTA (custom orders) → Footer.
//
// Uses only supported section types, following the same convention as the
// restaurant and grocery templates.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
} from "../utils/template-section-builders";

export const modernBakeryTemplate: BuildoraTemplate = {
  id: "template-bakery",
  name: "Modern Bakery",
  description:
    "A warm, modern bakery site with a hero banner, fresh-baked highlights, and a custom-order call to action.",
  category: "food",
  tags: ["bakery", "cafe", "food", "cakes", "artisan"],
  featured: true,
  sortOrder: 46,
  defaultName: "Modern Bakery",
  preview: {
    accent: "#d97706",
    background: "#fffbf5",
    badge: "Bakery",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Fresh Daily" },
      { kind: "cta", label: "Custom Orders" },
      { kind: "footer", label: "Footer" },
    ],
  },
  createProject(context) {
    const pageId = context.ids.pageId(context.templateId, 0);
    return {
      id: context.projectId,
      name: context.projectName,
      theme: createTemplateTheme({
        palette: { primary: "#d97706", accent: "#d97706", background: "#ffffff" },
      }),
      assets: [],
      pages: [
        {
          id: pageId,
          title: "Home",
          slug: "/",
          sections: [
            makeSection(
              context.ids.sectionId(context.templateId, "header", 1),
              "header",
              1,
              {
                logoText: "Golden Crumb",
                navLinks: navLinks([
                  ["Menu", "#fresh"],
                  ["Custom Orders", "#orders"],
                  ["Visit Us", "#footer"],
                ]),
                ctaText: "Order Now",
                ctaHref: "#orders",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Baked fresh at sunrise, gone by sundown",
                subheadline:
                  "Small-batch sourdough, seasonal tarts, and celebration cakes made with stone-milled flour and real butter.",
                primaryCta: { text: "See Today's Bakes", href: "#fresh" },
                secondaryCta: { text: "Custom Orders", href: "#orders" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "From the oven, every morning",
                subtitle: "A short menu done properly — everything baked in-house daily.",
                features: [
                  featureItem(
                    "Sourdough Loaves",
                    "Slow-fermented for 24 hours with a crisp crust and open crumb.",
                    "Star",
                  ),
                  featureItem(
                    "Seasonal Tarts",
                    "Fruit tarts layered with vanilla custard on buttery pastry.",
                    "Heart",
                  ),
                  featureItem(
                    "Celebration Cakes",
                    "Custom cakes for birthdays and weddings, designed with you.",
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
                headline: "Planning something special?",
                subheadline:
                  "Tell us about your event and we'll design a cake (and dessert table) to match.",
                ctaText: "Request a Custom Order",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 4),
              "footer",
              5,
              {
                text: "© 2026 Golden Crumb Bakery · Open Tue–Sun, 7 AM – 6 PM · 12 Flour Lane",
                links: navLinks([
                  ["Menu", "#fresh"],
                  ["Custom Orders", "#orders"],
                  ["Contact", "tel:+15550122334"],
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
