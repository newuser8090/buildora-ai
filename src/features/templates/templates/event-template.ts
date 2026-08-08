// ---------------------------------------------------------------------------
// Event template (Phase P9)
//
// Header → Hero → Details → Schedule → RSVP CTA → Footer.
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

export const eventTemplate: BuildoraTemplate = {
  id: "template-event",
  name: "Event Page",
  description:
    "A friendly page for your event — share the details, the schedule, and a simple RSVP button.",
  category: "event",
  tags: ["event", "conference", "wedding", "meetup", "rsvp", "schedule"],
  featured: true,
  sortOrder: 20,
  defaultName: "My Event",
  difficulty: "beginner",
  preview: {
    accent: "#e0533d",
    background: "#170d0b",
    badge: "Featured",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Event" },
      { kind: "content", label: "Details" },
      { kind: "content", label: "Schedule" },
      { kind: "content", label: "FAQ" },
      { kind: "cta", label: "RSVP" },
      { kind: "footer", label: "Footer" },
    ],
  },
  createProject(context) {
    const pageId = context.ids.pageId(context.templateId, 0);
    return {
      id: context.projectId,
      name: context.projectName,
      theme: createTemplateTheme({
        palette: { primary: "#e0533d", accent: "#e0533d", background: "#ffffff" },
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
                logoText: "Summer Meetup",
                navLinks: navLinks([
                  ["Details", "#details"],
                  ["Schedule", "#schedule"],
                  ["FAQ", "#faq"],
                ]),
                ctaText: "RSVP",
                ctaHref: "#rsvp",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Join us for an afternoon of ideas and friends",
                subheadline:
                  "Saturday, September 14 · 2:00 PM · The Garden Hall",
                primaryCta: { text: "Save my spot", href: "#rsvp" },
                secondaryCta: { text: "See the schedule", href: "#schedule" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "Everything you need to know",
                subtitle: "A relaxed afternoon, thoughtfully planned.",
                features: [
                  featureItem(
                    "Where",
                    "The Garden Hall, 12 Maple Street — easy parking and a tram stop right outside.",
                    "MapPin",
                  ),
                  featureItem(
                    "When",
                    "Saturday, September 14, 2:00–6:00 PM. Doors open at 1:30.",
                    "Calendar",
                  ),
                  featureItem(
                    "Bring",
                    "Just yourself. Snacks and drinks are on us.",
                    "Coffee",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "faq", 3),
              "faq",
              4,
              {
                title: "The schedule",
                items: [
                  faqItem(
                    "2:00 — Welcome & intro",
                    "A quick hello from the organizers and what to expect this afternoon.",
                  ),
                  faqItem(
                    "2:30 — Talks",
                    "Three short talks on things we're all curious about.",
                  ),
                  faqItem(
                    "4:00 — Break with snacks",
                    "Coffee, tea, and time to chat with new people.",
                  ),
                  faqItem(
                    "4:30 — Workshop & wrap-up",
                    "Hands-on fun, then a friendly goodbye before 6 PM.",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 4),
              "cta",
              5,
              {
                headline: "Come say hi",
                subheadline: "It's free, it's friendly, and we'd love to see you.",
                ctaText: "RSVP now",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 5),
              "footer",
              6,
              {
                text: "© 2026 Summer Meetup. Made with Buildora.",
                links: navLinks([
                  ["Details", "#details"],
                  ["Schedule", "#schedule"],
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
