// ---------------------------------------------------------------------------
// Personal Profile template (Phase P9)
//
// Header → Hero (intro) → About → Skills → Experience → Contact CTA → Footer.
// Deterministic fixture: fresh objects every call, IDs from injected factory.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
} from "../utils/template-section-builders";

export const personalProfileTemplate: BuildoraTemplate = {
  id: "template-personal",
  name: "Personal Profile",
  description:
    "A warm personal page to introduce yourself — what you do, what you love, and how to reach you.",
  category: "personal",
  tags: ["personal", "profile", "about me", "resume", "contact", "portfolio"],
  featured: true,
  sortOrder: 21,
  defaultName: "My Personal Page",
  difficulty: "beginner",
  preview: {
    accent: "#0f9d8f",
    background: "#0b1513",
    badge: "Featured",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Intro" },
      { kind: "content", label: "About" },
      { kind: "content", label: "Skills" },
      { kind: "content", label: "Experience" },
      { kind: "cta", label: "Contact" },
      { kind: "footer", label: "Footer" },
    ],
  },
  createProject(context) {
    const pageId = context.ids.pageId(context.templateId, 0);
    return {
      id: context.projectId,
      name: context.projectName,
      theme: createTemplateTheme({
        palette: { primary: "#0f9d8f", accent: "#0f9d8f", background: "#ffffff" },
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
                logoText: "Hi, I'm Alex",
                navLinks: navLinks([
                  ["About", "#about"],
                  ["Skills", "#skills"],
                  ["Contact", "#contact"],
                ]),
                ctaText: "Say hello",
                ctaHref: "#contact",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "I make friendly websites for small teams",
                subheadline:
                  "Designer and builder based in Portland. I love clean layouts and clear words.",
                primaryCta: { text: "Get in touch", href: "#contact" },
                secondaryCta: { text: "What I do", href: "#about" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "A few things about me",
                subtitle: "Simple, honest, and useful — that's the goal.",
                features: [
                  featureItem(
                    "What I do",
                    "I design and build websites for small businesses, schools, and creators.",
                    "Heart",
                  ),
                  featureItem(
                    "How I work",
                    "I listen first, then sketch, then build. You see progress at every step.",
                    "Handshake",
                  ),
                  featureItem(
                    "What I love",
                    "Good coffee, clear writing, and interfaces that feel obvious.",
                    "Coffee",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 3),
              "features",
              4,
              {
                title: "Skills",
                subtitle: "Tools I reach for every day.",
                features: [
                  featureItem("Design", "Layout, color, typography, and brand basics.", "Palette"),
                  featureItem("Building", "Websites with modern, friendly tools.", "Code"),
                  featureItem("Writing", "Plain-language copy that explains things well.", "PenTool"),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 4),
              "features",
              5,
              {
                title: "Recent experience",
                subtitle: "A few places I've helped along the way.",
                features: [
                  featureItem(
                    "Studio North — Designer",
                    "2022–now · Brand and web work for local clients.",
                    "Briefcase",
                  ),
                  featureItem(
                    "Harbor School — Website lead",
                    "2020–2022 · Rebuilt the school site parents actually use.",
                    "GraduationCap",
                  ),
                  featureItem(
                    "Open-source contributor",
                    "Ongoing · Little fixes and docs for friendly projects.",
                    "Github",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 5),
              "cta",
              6,
              {
                headline: "Want to work together?",
                subheadline: "Send a note — I reply within a day or two.",
                ctaText: "Say hello",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 6),
              "footer",
              7,
              {
                text: "© 2026 Alex. Made with Buildora.",
                links: navLinks([
                  ["Email", "#"],
                  ["LinkedIn", "#"],
                  ["GitHub", "#"],
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
