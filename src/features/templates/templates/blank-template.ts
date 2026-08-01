// ---------------------------------------------------------------------------
// Blank template — start from scratch
//
// One page, one minimal starter section (the hero) so the project satisfies
// the existing Project schema (pages require at least one section). No
// embedded assets, no shared mutable state, all IDs from the injected factory.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import { makeSection } from "../utils/template-section-builders";

export const blankTemplate: BuildoraTemplate = {
  id: "template-blank",
  name: "Blank Project",
  description:
    "A clean slate with a single page and a minimal starter section. Perfect for building from scratch.",
  category: "blank",
  tags: ["blank", "empty", "minimal", "starter"],
  featured: true,
  sortOrder: 0,
  defaultName: "Untitled Project",
  preview: {
    accent: "#7c5cfc",
    background: "#ffffff",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "footer", label: "Footer" },
    ],
  },
  createProject(context) {
    const pageId = context.ids.pageId(context.templateId, 0);
    return {
      id: context.projectId,
      name: context.projectName,
      theme: createTemplateTheme(),
      assets: [],
      pages: [
        {
          id: pageId,
          title: "Home",
          slug: "/",
          sections: [
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 0),
              "hero",
              1,
              {
                headline: "Your new project",
                subheadline:
                  "Start adding sections to bring your idea to life.",
                primaryCta: { text: "Get Started", href: "#" },
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
