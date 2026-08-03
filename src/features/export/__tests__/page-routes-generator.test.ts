// ---------------------------------------------------------------------------
// Multi-page route generation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import {
  generatePageRoutes,
  generatePageFile,
} from "../generators/page-generator";
import { generateExportProject } from "../generators/project-generator";
import { validateProjectForExport } from "../validators/export-validator";
import { computePageRoutes } from "@/features/routing/routes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTwoPageProject(): Project {
  return {
    ...MOCK_PROJECT,
    pages: [
      {
        id: "home",
        title: "Home",
        slug: "/",
        meta: { title: "Buildora — Home", description: "Welcome to Buildora." },
        sections: [
          {
            id: "s-header",
            type: "header",
            order: 1,
            visible: true,
            props: {
              logoText: "Buildora",
              navLinks: [
                { text: "About", href: "/about" },
                { text: "Pricing", href: "/pricing" },
                { text: "External", href: "https://example.com" },
              ],
            },
            styles: {},
          },
          {
            id: "s-hero",
            type: "hero",
            order: 2,
            visible: true,
            props: {
              headline: "Build beautiful websites",
              subheadline: "Fast and free",
              primaryCta: { text: "Get Started", href: "/pricing" },
              secondaryCta: { text: "Learn more", href: "#features" },
            },
            styles: {},
          },
        ],
      },
      {
        id: "about",
        title: "About",
        slug: "/about",
        sections: [
          {
            id: "s-about-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: {
              headline: "About us",
              subheadline: "Our story",
              primaryCta: { text: "Home", href: "/" },
            },
            styles: {},
          },
        ],
      },
      {
        id: "pricing",
        title: "Pricing",
        slug: "/pricing",
        sections: [
          {
            id: "s-pricing",
            type: "pricing",
            order: 1,
            visible: true,
            props: {
              title: "Pricing",
              plans: [{ name: "Pro", price: "$10", cta: "Start", features: [] }],
            },
            styles: {},
          },
          {
            id: "s-hidden",
            type: "cta",
            order: 2,
            visible: false,
            props: { headline: "Hidden", ctaText: "Go", ctaHref: "/about" },
            styles: {},
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route file generation
// ---------------------------------------------------------------------------

describe("generatePageRoutes", () => {
  it("emits one route file per page with correct paths", () => {
    const files = generatePageRoutes(makeTwoPageProject());
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([
      "app/page.tsx",
      "app/about/page.tsx",
      "app/pricing/page.tsx",
    ]);
  });

  it("exports the homepage at the root route with per-page metadata", () => {
    const [home] = generatePageRoutes(makeTwoPageProject());
    expect(home.path).toBe("app/page.tsx");
    expect(home.content).toContain('export const metadata: Metadata = {');
    expect(home.content).toContain('title: "Buildora — Home"');
    expect(home.content).toContain('description: "Welcome to Buildora."');
    expect(home.content).toContain("export default function HomePage()");
  });

  it("falls back to the page title for metadata", () => {
    const [, about] = generatePageRoutes(makeTwoPageProject());
    expect(about.content).toContain('title: "About"');
    // No description — the About page has none
    expect(about.content).not.toContain("description:");
  });

  it("names route components from their slug", () => {
    const [, about, pricing] = generatePageRoutes(makeTwoPageProject());
    expect(about.content).toContain("export default function AboutPage()");
    expect(pricing.content).toContain("export default function PricingPage()");
  });

  it("excludes invisible sections per page", () => {
    const [, , pricing] = generatePageRoutes(makeTwoPageProject());
    expect(pricing.content).toContain("<Pricing");
    expect(pricing.content).not.toContain("Hidden");
    expect(pricing.content).not.toContain("<Cta");
  });

  it("resolves cross-page internal links in serialized props", () => {
    const [home] = generatePageRoutes(makeTwoPageProject());
    // navLinks and CTAs referencing other pages keep their routes
    expect(home.content).toContain('"href":"/about"');
    expect(home.content).toContain('"href":"/pricing"');
    // External links are preserved untouched
    expect(home.content).toContain('"href":"https://example.com"');
    // Anchor links are preserved
    expect(home.content).toContain('"href":"#features"');
  });

  it("resolves links back to the homepage root", () => {
    const [, about] = generatePageRoutes(makeTwoPageProject());
    expect(about.content).toContain('primaryCta={{"text":"Home","href":"/"}}');
  });

  it("keeps unknown internal paths unchanged", () => {
    const project = makeTwoPageProject();
    const home = project.pages[0];
    home.sections[0].props = {
      logoText: "Buildora",
      navLinks: [{ text: "Blog", href: "/blog" }],
    };
    const [file] = generatePageRoutes(project);
    expect(file.content).toContain('"href":"/blog"');
  });

  it("escapes adversarial metadata in generated route files", () => {
    const project = makeTwoPageProject();
    project.pages[0].meta = {
      title: 'Say "hi" now',
      description: "Line one\nLine two",
    };
    const [home] = generatePageRoutes(project);
    // Quotes in the title are escaped inside the string literal
    expect(home.content).toContain('title: "Say \\"hi\\" now",');
    // Newlines inside the description are escaped so the file stays valid JS
    expect(home.content).toContain('description: "Line one\\nLine two",');
    expect(home.content).not.toContain('description: "Line one\nLine two"');
  });
});

// ---------------------------------------------------------------------------
// Homepage root policy with a renamed home page
// ---------------------------------------------------------------------------

describe("homepage root policy", () => {
  it("exports a renamed home page at the root and rewrites its slug links", () => {
    const project = makeTwoPageProject();
    // User renamed the home page — its slug is no longer "/"
    project.pages[0].slug = "/landing";
    project.pages[0].meta = { title: "Landing" };

    const files = generatePageRoutes(project);
    const home = files.find((f) => f.path === "app/page.tsx")!;
    const about = files.find((f) => f.path === "app/about/page.tsx")!;

    // Home still exports at the root
    expect(home).toBeTruthy();
    expect(home.content).toContain("export default function HomePage()");
    // A link to the old home slug resolves to the root route
    expect(about.content).toContain('primaryCta={{"text":"Home","href":"/"}}');

    // Validator still accepts this state (home slug is valid, non-home slugs unique)
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generatePageFile + computePageRoutes integration
// ---------------------------------------------------------------------------

describe("generatePageFile / computePageRoutes", () => {
  it("generatePageFile writes to the route's file path", () => {
    const project = makeTwoPageProject();
    const routes = computePageRoutes(project.pages);
    const about = project.pages.find((p) => p.id === "about")!;
    const file = generatePageFile(project, about, routes);
    expect(file.path).toBe("app/about/page.tsx");
    expect(file.content).toContain("About us");
  });
});

// ---------------------------------------------------------------------------
// Project orchestrator — multi-page ZIP file set
// ---------------------------------------------------------------------------

describe("Project orchestrator multi-page", () => {
  it("includes every page route in the exported file set", () => {
    const { files } = generateExportProject(makeTwoPageProject());
    const paths = files.map((f) => f.path);
    expect(paths).toContain("app/page.tsx");
    expect(paths).toContain("app/about/page.tsx");
    expect(paths).toContain("app/pricing/page.tsx");
    // One route file per page
    const routeFiles = paths.filter((p) => /^app\/.*page\.tsx$/.test(p));
    expect(routeFiles).toHaveLength(3);
  });

  it("validator rejects a non-home page owning the root slug", () => {
    const project = makeTwoPageProject();
    project.pages[1].slug = "/";
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((e) => e.includes("root slug")),
    ).toBe(true);
  });

  it("validator rejects duplicate routes", () => {
    const project = makeTwoPageProject();
    project.pages[2].slug = "/about";
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(false);
    expect(
      validation.errors.some((e) => e.includes("share the route")),
    ).toBe(true);
  });

  it("validator rejects reserved slugs", () => {
    const project = makeTwoPageProject();
    project.pages[1].slug = "/api";
    const validation = validateProjectForExport(project);
    expect(validation.valid).toBe(false);
  });
});
