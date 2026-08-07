// ---------------------------------------------------------------------------
// Launch readiness — shared test fixtures (Phase P7)
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { Asset } from "@/features/assets/types";

export function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: "a1",
    name: "logo.png",
    type: "image",
    mimeType: "image/png",
    extension: ".png",
    size: 1024,
    source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeTheme(): Project["theme"] {
  return {
    palette: {
      background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
      primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
      muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
      accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#000000",
    },
    typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
    spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
    radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
    shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
  };
}

/** A well-formed, near-perfect project (all readiness checks pass). */
export function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    theme: makeTheme(),
    assets: [
      makeAsset({ id: "favicon", name: "icon.png" }),
      makeAsset({ id: "social", name: "share.png" }),
      makeAsset({ id: "hero-img", name: "hero.png" }),
    ],
    siteSettings: {
      siteName: "Test Site",
      siteDescription: "A short description of the site.",
      language: "en",
      favicon: { assetId: "favicon" },
      seo: {
        title: "Test Site | Home",
        description: "A short description of the site.",
        robotsIndex: true,
      },
      social: {
        title: "Test Site",
        description: "Share me.",
        image: { assetId: "social" },
      },
      appearance: { themeColor: "#7c5cfc" },
    },
    pages: [
      {
        id: "p-home", title: "Home", slug: "/",
        meta: { title: "Home SEO" },
        sections: [
          {
            id: "s-header", type: "header", order: 1, visible: true,
            props: {
              logoText: "Test Site",
              navLinks: [
                { text: "About", href: "/about" },
                { text: "Contact", href: "/contact" },
              ],
              ctaText: "Contact",
              ctaHref: "/contact",
            },
            styles: {},
          },
          {
            id: "s-hero", type: "hero", order: 2, visible: true,
            props: {
              headline: "Welcome to Test Site",
              primaryCta: { text: "Get started", href: "/about" },
              heroImage: { assetId: "hero-img", altText: "Team working" },
            },
            styles: {},
          },
          {
            id: "s-footer", type: "footer", order: 3, visible: true,
            props: {
              text: "© 2026 Test Site",
              links: [{ text: "About", href: "/about" }],
            },
            styles: {},
          },
        ],
      },
      {
        id: "p-about", title: "About", slug: "/about",
        meta: { title: "About SEO" },
        sections: [
          {
            id: "s-about-hero", type: "hero", order: 1, visible: true,
            props: { headline: "About us", primaryCta: { text: "Contact", href: "/contact" } },
            styles: {},
          },
        ],
      },
      {
        id: "p-contact", title: "Contact", slug: "/contact",
        meta: { title: "Contact SEO" },
        sections: [
          {
            id: "s-contact-hero", type: "hero", order: 1, visible: true,
            props: { headline: "Contact us", primaryCta: { text: "Email", href: "mailto:hi@example.com" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Bare project with a single page (minimal schema-valid shape). */
export function makeBareProject(overrides?: Partial<Project>): Project {
  return makeProject({
    siteSettings: undefined,
    assets: [],
    pages: [
      {
        id: "p-home", title: "Home", slug: "/",
        sections: [
          {
            id: "s-hero", type: "hero", order: 1, visible: true,
            props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    ...overrides,
  });
}
