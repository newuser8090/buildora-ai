// ---------------------------------------------------------------------------
// Product Launch / Startup template
//
// Header → Hero → Features → FAQ → CTA → Footer.
// Deterministic fixture: fresh objects every call, IDs from injected factory.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
  faqItem,
} from "../utils/template-section-builders";

export const startupTemplate: BuildoraTemplate = {
  id: "template-startup",
  name: "Product Launch",
  description:
    "A focused launch page for a new product — build anticipation, answer questions, and capture interest.",
  category: "landing-page",
  tags: ["startup", "launch", "product", "waitlist", "landing page"],
  sortOrder: 15,
  defaultName: "Product Launch",
  preview: {
    accent: "#059669",
    background: "#052e16",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Why it's different" },
      { kind: "content", label: "FAQ" },
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
        palette: { primary: "#059669", accent: "#059669", background: "#ffffff" },
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
                logoText: "Ember",
                navLinks: navLinks([
                  ["Why Ember", "#why"],
                  ["FAQ", "#faq"],
                ]),
                ctaText: "Join the Waitlist",
                ctaHref: "#cta",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Meet the product your team has been waiting for",
                subheadline:
                  "Ember brings your scattered tools into one calm, focused workspace. Launching spring 2026.",
                primaryCta: { text: "Join the Waitlist", href: "#cta" },
                secondaryCta: { text: "Learn more", href: "#why" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "Why Ember is different",
                subtitle:
                  "We rebuilt the workflow from the ground up around three ideas.",
                features: [
                  featureItem(
                    "One calm surface",
                    "Every task, note, and deadline in a single workspace — no tab-hopping.",
                    "Layers",
                  ),
                  featureItem(
                    "It thinks ahead",
                    "Smart suggestions surface what matters before you have to ask.",
                    "Sparkles",
                  ),
                  featureItem(
                    "Private by design",
                    "Your data stays yours. End-to-end encryption with a real zero-access policy.",
                    "Shield",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "faq", 3),
              "faq",
              4,
              {
                title: "Frequently asked questions",
                items: [
                  faqItem(
                    "When does Ember launch?",
                    "We're opening the waitlist now and onboarding in waves starting spring 2026.",
                  ),
                  faqItem(
                    "How much will it cost?",
                    "Early waitlist members lock in a founders' rate. We'll publish pricing at launch.",
                  ),
                  faqItem(
                    "Will my data be safe?",
                    "Yes — end-to-end encryption and a zero-access architecture are built in from day one.",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 4),
              "cta",
              5,
              {
                headline: "Get early access",
                subheadline:
                  "Join the waitlist and be first in line when Ember opens its doors.",
                ctaText: "Join the Waitlist",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 5),
              "footer",
              6,
              {
                text: "© 2026 Ember Labs. All rights reserved.",
                links: navLinks([
                  ["Twitter", "#"],
                  ["Privacy", "#"],
                  ["Terms", "#"],
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
