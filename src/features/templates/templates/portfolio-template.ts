// ---------------------------------------------------------------------------
// Portfolio template
//
// Header → Hero → Features (selected work) → CTA → Footer.
// Deterministic fixture: fresh objects every call, IDs from injected factory.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
} from "../utils/template-section-builders";

export const portfolioTemplate: BuildoraTemplate = {
  id: "template-portfolio",
  name: "Portfolio",
  description:
    "A refined portfolio for creatives and makers to showcase selected work and invite new projects.",
  category: "portfolio",
  tags: ["portfolio", "creative", "designer", "photography", "work"],
  featured: true,
  sortOrder: 20,
  defaultName: "Portfolio Website",
  preview: {
    accent: "#0f766e",
    background: "#f8fafc",
    badge: "Featured",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Selected Work" },
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
        palette: { primary: "#0f766e", accent: "#0f766e", background: "#ffffff" },
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
                logoText: "Maya Lin",
                navLinks: navLinks([
                  ["Work", "#work"],
                  ["About", "#about"],
                  ["Contact", "#cta"],
                ]),
                ctaText: "Let's Talk",
                ctaHref: "#cta",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "I design digital experiences that feel human",
                subheadline:
                  "Maya Lin is an independent product designer helping startups turn complex ideas into simple, delightful products.",
                primaryCta: { text: "View Selected Work", href: "#work" },
                secondaryCta: { text: "More about me", href: "#about" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "Selected work",
                subtitle:
                  "A few recent collaborations across product design, branding, and digital art direction.",
                features: [
                  featureItem(
                    "Atlas Finance App",
                    "End-to-end product design for a personal finance platform used by 80k people.",
                    "Layers",
                  ),
                  featureItem(
                    "Field Notes Brand",
                    "Identity and art direction for an outdoor gear company built for the long haul.",
                    "Sparkles",
                  ),
                  featureItem(
                    "Terra CMS",
                    "A content system that helps editorial teams ship stories in record time.",
                    "BarChart",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 3),
              "cta",
              4,
              {
                headline: "Have a project in mind?",
                subheadline:
                  "I partner with a small number of teams each year. Let's see if we're a fit.",
                ctaText: "Start a Conversation",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 4),
              "footer",
              5,
              {
                text: "© 2026 Maya Lin. All rights reserved.",
                links: navLinks([
                  ["Dribbble", "#"],
                  ["LinkedIn", "#"],
                  ["Instagram", "#"],
                  ["Email", "#"],
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
