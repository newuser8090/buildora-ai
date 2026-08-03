// ---------------------------------------------------------------------------
// Creative Agency template
//
// Header → Hero → Features (services) → FAQ → CTA → Footer.
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

export const agencyTemplate: BuildoraTemplate = {
  id: "template-agency",
  name: "Creative Agency",
  description:
    "A bold site for an agency to present services, answer questions, and win new clients.",
  category: "business",
  tags: ["agency", "studio", "services", "business", "consulting"],
  sortOrder: 30,
  defaultName: "Creative Agency",
  preview: {
    accent: "#e11d48",
    background: "#0b0f19",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Services" },
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
        palette: { primary: "#e11d48", accent: "#e11d48", background: "#ffffff" },
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
                logoText: "Northstar Studio",
                navLinks: navLinks([
                  ["Services", "#services"],
                  ["Process", "#process"],
                  ["FAQ", "#faq"],
                ]),
                ctaText: "Start a Project",
                ctaHref: "#cta",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "We build brands people remember",
                subheadline:
                  "Northstar is a full-service creative studio partnering with ambitious companies to craft strategy, identity, and digital experiences.",
                primaryCta: { text: "Start a Project", href: "#cta" },
                secondaryCta: { text: "Explore services", href: "#services" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "What we do",
                subtitle:
                  "Strategy, design, and engineering under one roof — so nothing gets lost in translation.",
                features: [
                  featureItem(
                    "Brand strategy",
                    "Positioning, messaging, and visual identity built on research, not guesswork.",
                    "Sparkles",
                  ),
                  featureItem(
                    "Product design",
                    "Interfaces and systems that are as useful as they are beautiful.",
                    "Layers",
                  ),
                  featureItem(
                    "Web development",
                    "Fast, accessible, and maintainable builds that ship on time.",
                    "Zap",
                  ),
                  featureItem(
                    "Motion & 3D",
                    "Interactions and visuals that bring your story to life.",
                    "Star",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "faq", 3),
              "faq",
              4,
              {
                title: "Working with us",
                items: [
                  faqItem(
                    "How do projects get started?",
                    "We begin with a free discovery call to understand your goals, then scope a proposal with a fixed timeline and budget.",
                  ),
                  faqItem(
                    "How long does a typical project take?",
                    "Most brand and web projects run 6–10 weeks, depending on scope. We share a clear timeline up front.",
                  ),
                  faqItem(
                    "Who will I work with?",
                    "A senior team of strategists, designers, and developers — the people who actually do the work.",
                  ),
                  faqItem(
                    "What does it cost?",
                    "Every project is scoped individually. We'll give you a transparent estimate before you commit.",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 4),
              "cta",
              5,
              {
                headline: "Let's build something bold together",
                subheadline:
                  "Tell us about your project and we'll get back within two business days.",
                ctaText: "Start a Project",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 5),
              "footer",
              6,
              {
                text: "© 2026 Northstar Studio. All rights reserved.",
                links: navLinks([
                  ["Instagram", "#"],
                  ["Behance", "#"],
                  ["LinkedIn", "#"],
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
