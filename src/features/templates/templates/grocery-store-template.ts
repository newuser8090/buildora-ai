// ---------------------------------------------------------------------------
// Local Grocery Store template
//
// Header → Hero → Category Showcase (features) → Product Grid (pricing) →
// Footer.
//
// Note: like the ecommerce template, the storefront "widgets" are represented
// with supported section types — search / wishlist / account / cart live in
// the header as nav links + CTA, and the product grid uses the `pricing`
// section (plans as product cards with price + features as pack/weight info)
// so no unsupported section type is introduced.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
  plan,
} from "../utils/template-section-builders";

export const groceryStoreTemplate: BuildoraTemplate = {
  id: "template-grocery",
  name: "Local Grocery Store",
  description:
    "A friendly neighborhood grocery storefront with a hero banner, category showcase, and a ready-to-edit product grid.",
  category: "commerce",
  tags: ["grocery", "store", "food", "delivery", "organic", "retail"],
  featured: true,
  sortOrder: 45,
  defaultName: "Local Grocery Store",
  preview: {
    accent: "#16a34a",
    background: "#ffffff",
    badge: "Grocery",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Categories" },
      { kind: "pricing", label: "Products" },
      { kind: "footer", label: "Footer" },
    ],
  },
  createProject(context) {
    const pageId = context.ids.pageId(context.templateId, 0);
    return {
      id: context.projectId,
      name: context.projectName,
      theme: createTemplateTheme({
        palette: { primary: "#16a34a", accent: "#16a34a", background: "#ffffff" },
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
                logoText: "FreshMart",
                navLinks: navLinks([
                  ["Search", "#products"],
                  ["Wishlist", "#products"],
                  ["Account", "#footer"],
                  ["Cart", "#products"],
                ]),
                ctaText: "Shop Now",
                ctaHref: "#products",
                whatsappNumber: "919876543210",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Fresh farm groceries delivered to your door",
                subheadline:
                  "100% organic produce, daily essentials, and pantry staples picked fresh every morning and delivered the same day.",
                primaryCta: { text: "Shop Now", href: "#products" },
                secondaryCta: { text: "Browse Categories", href: "#categories" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "Shop by category",
                subtitle:
                  "Everything you need for the week, organized the way you shop.",
                features: [
                  featureItem(
                    "Fruits & Vegetables",
                    "Farm-fresh picks harvested at peak ripeness.",
                    "Heart",
                  ),
                  featureItem(
                    "Dairy & Bakery",
                    "Milk, cheese, and breads baked daily in-store.",
                    "Star",
                  ),
                  featureItem(
                    "Pantry Essentials",
                    "Rice, grains, spices, and cooking staples.",
                    "Layers",
                  ),
                  featureItem(
                    "Cold Drinks & Juices",
                    "Chilled juices, sodas, and refreshing beverages.",
                    "Zap",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "pricing", 3),
              "pricing",
              4,
              {
                title: "Fresh picks for you",
                subtitle: "Handpicked bestsellers with same-day delivery.",
                plans: [
                  plan(
                    "Organic Hass Avocado",
                    "₹80",
                    "+ Add",
                    ["500 g pack", "Grade A organic"],
                    "Creamy, ripe, and perfect for toast or salads.",
                  ),
                  plan(
                    "Whole Farm Milk",
                    "₹65",
                    "+ Add",
                    ["1 Litre", "Farm fresh, chilled"],
                    "Farm-fresh whole milk delivered cold every morning.",
                  ),
                  plan(
                    "Multigrain Bread Loaf",
                    "₹55",
                    "+ Add",
                    ["400 g loaf", "Baked in-store daily"],
                    "Soft multigrain loaf with seeds and whole wheat.",
                  ),
                  plan(
                    "Farm Fresh Eggs",
                    "₹90",
                    "+ Add",
                    ["Pack of 12", "Free-range"],
                    "Brown free-range eggs collected this morning.",
                  ),
                  plan(
                    "Baby Spinach",
                    "₹40",
                    "+ Add",
                    ["250 g pack", "Hydroponic, pesticide-free"],
                    "Tender baby spinach leaves, triple-washed and ready.",
                  ),
                  plan(
                    "Alphonso Mangoes",
                    "₹350",
                    "+ Add",
                    ["1 kg box", "Naturally ripened"],
                    "Sweet, aromatic Alphonso mangoes from Ratnagiri.",
                    true,
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 4),
              "footer",
              5,
              {
                text: "© 2026 FreshMart · Open daily 7 AM – 10 PM · Delivery guaranteed in 90 minutes · Call or WhatsApp +91 98765 43210",
                links: navLinks([
                  ["Daily 7 AM – 10 PM", "#"],
                  ["Call / WhatsApp", "tel:+919876543210"],
                  ["Delivery Guarantee", "#"],
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
