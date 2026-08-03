import type { Project } from "@/types/project";

export const MOCK_PROJECT: Project = {
  id: "proj-1",
  name: "SaaS Landing Page",
  theme: {
    palette: {
      background: "#ffffff",
      foreground: "#0a0a0a",
      primary: "#7c5cfc",
      primaryForeground: "#ffffff",
      secondary: "#f5f5f5",
      secondaryForeground: "#0a0a0a",
      muted: "#f5f5f5",
      mutedForeground: "#737373",
      accent: "#7c5cfc",
      accentForeground: "#ffffff",
      border: "#e5e5e5",
      card: "#ffffff",
      cardForeground: "#0a0a0a",
    },
    typography: {
      fontFamily: "Geist, system-ui, sans-serif",
      headingFont: "Geist, system-ui, sans-serif",
      baseSize: "16px",
      scale: 1.25,
    },
    spacing: {
      sectionPadding: "5rem 0",
      containerMaxWidth: "1120px",
      gap: "1.5rem",
    },
    radius: {
      sm: "0.375rem",
      md: "0.5rem",
      lg: "0.75rem",
      xl: "1rem",
      full: "9999px",
    },
    shadows: {
      sm: "0 1px 2px rgba(0,0,0,0.05)",
      md: "0 4px 6px rgba(0,0,0,0.07)",
      lg: "0 10px 15px rgba(0,0,0,0.1)",
      xl: "0 20px 25px rgba(0,0,0,0.15)",
    },
  },
  assets: [],
  pages: [
    {
      id: "page-1",
      title: "Home",
      slug: "/",
      sections: [
        {
          id: "s-header",
          type: "header",
          order: 1,
          visible: true,
          props: {
            logoText: "Buildora",
            navLinks: [
              { text: "Features", href: "#features" },
              { text: "Pricing", href: "#pricing" },
              { text: "FAQ", href: "#faq" },
            ],
            ctaText: "Get Started",
            ctaHref: "#cta",
          },
          styles: {},
        },
        {
          id: "s-hero",
          type: "hero",
          order: 2,
          visible: true,
          props: {
            headline: "Build beautiful websites\nwith AI assistance",
            subheadline:
              "Describe your dream site in plain English, and watch as Buildora generates a fully functional, ready-to-publish website in seconds.",
            primaryCta: { text: "Start Building Free", href: "#" },
            secondaryCta: { text: "See how it works →", href: "#" },
          },
          styles: {},
        },
        {
          id: "s-features",
          type: "features",
          order: 3,
          visible: true,
          props: {
            title: "Everything you need to ship fast",
            subtitle:
              "From idea to published website in minutes, not days.",
            features: [
              {
                title: "AI-Powered Generation",
                description:
                  "Describe what you want and let AI handle the heavy lifting — layouts, copy, and styling out of the box.",
                icon: "Zap",
              },
              {
                title: "Fully Customizable",
                description:
                  "Every generated section is fully editable. Change colors, fonts, spacing, and content with a visual editor.",
                icon: "Layers",
              },
              {
                title: "Responsive by Default",
                description:
                  "Every site looks stunning on desktop, tablet, and mobile — no manual tweaking required.",
                icon: "Globe",
              },
              {
                title: "Dark Mode Ready",
                description:
                  "Built-in dark mode support. Let your visitors choose their preferred viewing experience.",
                icon: "Star",
              },
              {
                title: "SEO Optimized",
                description:
                  "Clean semantic HTML, fast loading times, and proper meta tags out of the box.",
                icon: "BarChart",
              },
              {
                title: "One-Click Export",
                description:
                  "Export your site as clean code, ready to deploy anywhere — Vercel, Netlify, or your own server.",
                icon: "Shield",
              },
            ],
          },
          styles: {},
        },
        {
          id: "s-pricing",
          type: "pricing",
          order: 4,
          visible: true,
          props: {
            title: "Simple, transparent pricing",
            subtitle: "No hidden fees. No surprises. Upgrade anytime.",
            plans: [
              {
                name: "Free",
                price: "$0",
                description: "Perfect for trying out Buildora.",
                features: [
                  "1 project",
                  "Basic AI generation",
                  "Landing page templates",
                  "Community support",
                ],
                cta: "Get Started",
              },
              {
                name: "Pro",
                price: "$19",
                description: "For professionals building at scale.",
                features: [
                  "Unlimited projects",
                  "Advanced AI & custom prompts",
                  "All templates & sections",
                  "Custom domains",
                  "Priority support",
                ],
                cta: "Start Free Trial",
                highlighted: true,
              },
              {
                name: "Team",
                price: "$49",
                description: "For teams collaborating on websites.",
                features: [
                  "Everything in Pro",
                  "Team collaboration",
                  "Shared asset library",
                  "API access",
                  "Dedicated support",
                ],
                cta: "Contact Sales",
              },
            ],
          },
          styles: {},
        },
        {
          id: "s-faq",
          type: "faq",
          order: 5,
          visible: true,
          props: {
            title: "Frequently asked questions",
            items: [
              {
                question: "How does the AI generation work?",
                answer:
                  "Simply describe the website you want in plain English, and our AI generates a fully structured landing page with sections, copy, and styling. You can then refine it further with follow-up prompts.",
              },
              {
                question: "Can I customize the generated sites?",
                answer:
                  "Absolutely. Every section, color, font, and piece of content is fully editable through the visual editor. You have complete control over the final result.",
              },
              {
                question: "Do I need coding experience?",
                answer:
                  "No. Buildora is designed for everyone. Describe what you want, and the AI handles the code. If you're a developer, you can also dive into the generated code directly.",
              },
              {
                question: "Can I export my site?",
                answer:
                  "Yes. You can export your site as clean, production-ready code at any time. Deploy it to Vercel, Netlify, GitHub Pages, or your own hosting.",
              },
            ],
          },
          styles: {},
        },
        {
          id: "s-cta",
          type: "cta",
          order: 6,
          visible: true,
          props: {
            headline: "Ready to build your next website?",
            subheadline:
              "Join thousands of creators using Buildora to ship beautiful sites faster.",
            ctaText: "Start Building Free",
            ctaHref: "#",
          },
          styles: {},
        },
        {
          id: "s-footer",
          type: "footer",
          order: 7,
          visible: true,
          props: {
            text: "© 2026 Buildora. All rights reserved.",
            links: [
              { text: "Twitter", href: "#" },
              { text: "GitHub", href: "#" },
              { text: "Docs", href: "#" },
              { text: "Privacy", href: "#" },
            ],
          },
          styles: {},
        },
      ],
    },
  ],
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};
