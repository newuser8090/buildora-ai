// ---------------------------------------------------------------------------
// SaaS Landing Page template
//
// Header → Hero → Features → Pricing → FAQ → CTA → Footer.
// Deterministic fixture: fresh objects every call, IDs from injected factory.
// ---------------------------------------------------------------------------

import type { BuildoraTemplate } from "../types";
import { createTemplateTheme } from "../utils/template-theme";
import {
  makeSection,
  navLinks,
  featureItem,
  plan,
  faqItem,
} from "../utils/template-section-builders";

export const saasTemplate: BuildoraTemplate = {
  id: "template-saas",
  name: "SaaS Landing Page",
  description:
    "A polished marketing site for a software product with pricing, features, and a conversion-focused FAQ.",
  category: "landing-page",
  tags: ["saas", "software", "product", "marketing", "startup", "landing page"],
  featured: true,
  sortOrder: 10,
  defaultName: "SaaS Landing Page",
  preview: {
    accent: "#7c5cfc",
    background: "#0b0f19",
    badge: "Featured",
    sections: [
      { kind: "header", label: "Header" },
      { kind: "hero", label: "Hero" },
      { kind: "content", label: "Features" },
      { kind: "pricing", label: "Pricing" },
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
        palette: { primary: "#7c5cfc", accent: "#7c5cfc", background: "#ffffff" },
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
                logoText: "Nimbus",
                navLinks: navLinks([
                  ["Features", "#features"],
                  ["Pricing", "#pricing"],
                  ["FAQ", "#faq"],
                ]),
                ctaText: "Start Free",
                ctaHref: "#cta",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "hero", 1),
              "hero",
              2,
              {
                headline: "Ship your next product in days, not months",
                subheadline:
                  "Nimbus gives modern teams the tools to plan, build, and launch with confidence.",
                primaryCta: { text: "Start Free Trial", href: "#cta" },
                secondaryCta: { text: "See how it works", href: "#features" },
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "features", 2),
              "features",
              3,
              {
                title: "Everything you need to move fast",
                subtitle:
                  "Powerful features designed around real workflows — no bloat, just momentum.",
                features: [
                  featureItem(
                    "Lightning deployment",
                    "Publish changes to production in one click with previews on every branch.",
                    "Zap",
                  ),
                  featureItem(
                    "Team workspaces",
                    "Invite your team, set permissions, and keep everyone on the same page.",
                    "Layers",
                  ),
                  featureItem(
                    "Real-time analytics",
                    "Understand usage with clear dashboards that update as your users act.",
                    "BarChart",
                  ),
                  featureItem(
                    "Bank-grade security",
                    "SOC 2 compliant infrastructure with encryption at rest and in transit.",
                    "Shield",
                  ),
                  featureItem(
                    "Global edge network",
                    "Serve your audience from 300+ points of presence around the world.",
                    "Globe",
                  ),
                  featureItem(
                    "Seamless integrations",
                    "Connect the tools you already use through a rich, open API.",
                    "Sparkles",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "pricing", 3),
              "pricing",
              4,
              {
                title: "Simple pricing that scales with you",
                subtitle: "Start free. Upgrade when you're ready. Cancel anytime.",
                plans: [
                  plan(
                    "Starter",
                    "$0",
                    "Start for Free",
                    ["1 project", "Community support", "Basic analytics", "Nimbus.io domain"],
                    "For personal projects and evaluation.",
                  ),
                  plan(
                    "Pro",
                    "$29",
                    "Start 14-day Trial",
                    [
                      "Unlimited projects",
                      "Priority support",
                      "Advanced analytics",
                      "Custom domains",
                      "Team workspaces",
                    ],
                    "For growing teams shipping weekly.",
                    true,
                  ),
                  plan(
                    "Enterprise",
                    "$99",
                    "Contact Sales",
                    [
                      "Everything in Pro",
                      "SSO & SCIM",
                      "Dedicated account manager",
                      "99.99% uptime SLA",
                    ],
                    "For organizations with compliance needs.",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "faq", 4),
              "faq",
              5,
              {
                title: "Frequently asked questions",
                items: [
                  faqItem(
                    "Can I try Nimbus before paying?",
                    "Absolutely. Every plan starts with a 14-day free trial — no credit card required.",
                  ),
                  faqItem(
                    "What happens when my trial ends?",
                    "You simply pick a plan that fits. If you choose not to, your workspace is paused safely with your data intact.",
                  ),
                  faqItem(
                    "Is my data secure?",
                    "Yes. We use encryption in transit and at rest, and our infrastructure is SOC 2 compliant.",
                  ),
                  faqItem(
                    "Can I export my data?",
                    "You own your data. Export everything anytime through the dashboard or our API.",
                  ),
                ],
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "cta", 5),
              "cta",
              6,
              {
                headline: "Ready to build something great?",
                subheadline:
                  "Join thousands of teams already shipping faster with Nimbus.",
                ctaText: "Start Free Trial",
                ctaHref: "#",
              },
            ),
            makeSection(
              context.ids.sectionId(context.templateId, "footer", 6),
              "footer",
              7,
              {
                text: "© 2026 Nimbus, Inc. All rights reserved.",
                links: navLinks([
                  ["Twitter", "#"],
                  ["GitHub", "#"],
                  ["Docs", "#"],
                  ["Privacy", "#"],
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
