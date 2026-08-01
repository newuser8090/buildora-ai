// ---------------------------------------------------------------------------
// Ecommerce Store template
//
// Header → Hero → Features (why shop) → Pricing (featured collections) →
// CTA → Footer.
//
// Note: the storefront "collections" are represented with the supported
// `pricing` section type (plans as featured bundles) so no unsupported
// section type is introduced.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
  plan,
} from "../utils/template-section-builders";

export const ecommerceTemplate: BuildoraTemplate = {
  id: "template-ecommerce",
  name: "Ecommerce Store",
  description:
    "A clean storefront to introduce your shop, highlight why to buy, and showcase featured collections.",
  category: "commerce",
  tags: ["ecommerce", "store", "shop", "retail", "products"],
  sortOrder: 50,
  defaultName: "Online Store",
  preview: {
    accent: "#2563eb",
    background: "#0b0f19",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Why Shop With Us" },
      { kind: "pricing", label: "Featured Collections" },
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
        palette: { primary: "#2563eb", accent: "#2563eb", background: "#ffffff" },
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
                logoText: "Harbor Goods",
                navLinks: navLinks([
                  ["Shop", "#collections"],
                  ["About", "#about"],
                  ["Contact", "#cta"],
                ]),
                ctaText: "Shop Now",
                ctaHref: "#collections",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Considered goods for everyday life",
                subheadline:
                  "Harbor Goods is a small online store curating durable, well-designed products you'll keep for years.",
                primaryCta: { text: "Shop the Collection", href: "#collections" },
                secondaryCta: { text: "Why Harbor", href: "#why" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "Why shop with us",
                subtitle:
                  "We sweat the details so you can shop with confidence.",
                features: [
                  featureItem(
                    "Free returns",
                    "Changed your mind? Send it back within 30 days, no questions asked.",
                    "Shield",
                  ),
                  featureItem(
                    "Fast, tracked shipping",
                    "Orders ship within 24 hours with tracking on every parcel.",
                    "Zap",
                  ),
                  featureItem(
                    "Built to last",
                    "We test every product for years of use — not just months.",
                    "Heart",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "pricing", 3),
              "pricing",
              4,
              {
                title: "Featured collections",
                subtitle: "Three favorites from the shop — each with free shipping.",
                plans: [
                  plan(
                    "The Desk",
                    "$120",
                    "Shop the Desk",
                    ["Walnut desk mat", "Mechanical pencil", "Canvas notebook", "Free shipping"],
                    "Everything you need for a tidy workspace.",
                  ),
                  plan(
                    "The Weekend",
                    "$85",
                    "Shop the Weekend",
                    ["Camp mug set", "Beeswax wrap trio", "Tote bag", "Free shipping"],
                    "Upgrade the everyday carry.",
                    true,
                  ),
                  plan(
                    "The Pantry",
                    "$65",
                    "Shop the Pantry",
                    ["Stoneware bowls", "Olive oil tin", "Linen napkins", "Free shipping"],
                    "Thoughtful details for the kitchen.",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 4),
              "cta",
              5,
              {
                headline: "New arrivals drop every Friday",
                subheadline:
                  "Join the list and be first in line for the next small-batch run.",
                ctaText: "Get Notified",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 5),
              "footer",
              6,
              {
                text: "© 2026 Harbor Goods. All rights reserved.",
                links: navLinks([
                  ["Shop", "#"],
                  ["Shipping", "#"],
                  ["Returns", "#"],
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
