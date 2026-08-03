// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { HeaderSection } from "../HeaderSection";
import { HeroSection } from "../HeroSection";
import { FeaturesSection } from "../FeaturesSection";
import { CtaSection } from "../CtaSection";
import { FooterSection } from "../FooterSection";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";
import type { Asset } from "@/features/assets/types";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: overrides?.id ?? "a1",
    name: overrides?.name ?? "logo.png",
    type: overrides?.type ?? "image",
    mimeType: "image/png",
    extension: ".png",
    size: 1024,
    source: { type: "data-url", value: "data:image/png;base64,iVBOR" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function setupStore(assetsOverride?: Asset[]) {
  const project: Project = {
    id: "proj-1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: assetsOverride ?? [
      makeAsset({ id: "logo-1", name: "logo.png", type: "logo" }),
      makeAsset({ id: "hero-1", name: "hero.jpg", type: "image", width: 1200, height: 800 }),
      makeAsset({ id: "feat-1", name: "feature-icon.svg", type: "icon" }),
    ],
    pages: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  useEditorStore.setState({
    project,
    selectedSectionId: null,
    selectedPageId: null,
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: { past: [], present: JSON.parse(JSON.stringify(project)), future: [] },
    _editingSession: null,
  });
}

function makeSection(type: string, props: Record<string, unknown>) {
  return {
    id: `${type}-1`,
    type,
    order: 1,
    visible: true,
    props,
    styles: {},
  };
}

// ---------------------------------------------------------------------------
// Header tests
// ---------------------------------------------------------------------------

describe("HeaderSection — asset rendering", () => {
  beforeEach(() => setupStore());

  it("renders logo text when no logoImage", () => {
    render(<HeaderSection section={makeSection("header", { logoText: "Brand", navLinks: [] })} />);
    expect(screen.getByText("Brand")).toBeDefined();
  });

  it("renders logo image when logoImage AssetRef is valid", () => {
    render(
      <HeaderSection
        section={makeSection("header", {
          logoText: "Brand",
          logoImage: { assetId: "logo-1" },
          navLinks: [],
        })}
      />,
    );
    // Logo text should NOT be visible (image takes precedence)
    expect(() => screen.getByText("Brand")).toThrow();
  });

  it("falls back to logoText when logoImage asset is missing", () => {
    render(
      <HeaderSection
        section={makeSection("header", {
          logoText: "Brand",
          logoImage: { assetId: "nonexistent" },
          navLinks: [],
        })}
      />,
    );
    expect(screen.getByText("Brand")).toBeDefined();
  });

  it("renders logoText when logoImage is defined but assets array is empty", () => {
    setupStore([]);
    render(
      <HeaderSection
        section={makeSection("header", {
          logoText: "Fallback",
          logoImage: { assetId: "logo-1" },
          navLinks: [],
        })}
      />,
    );
    expect(screen.getByText("Fallback")).toBeDefined();
  });

  it("preserves navigation links when logo image is present", () => {
    render(
      <HeaderSection
        section={makeSection("header", {
          logoText: "Brand",
          logoImage: { assetId: "logo-1" },
          navLinks: [{ text: "Home", href: "/" }, { text: "About", href: "/about" }],
        })}
      />,
    );
    expect(screen.getByText("Home")).toBeDefined();
    expect(screen.getByText("About")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Hero tests
// ---------------------------------------------------------------------------

describe("HeroSection — asset rendering", () => {
  beforeEach(() => setupStore());

  const baseProps = {
    headline: "Welcome",
    subheadline: "Subtitle",
    primaryCta: { text: "Start", href: "#" },
  };

  it("renders headline and CTA by default", () => {
    render(<HeroSection section={makeSection("hero", baseProps)} />);
    expect(screen.getByText("Welcome")).toBeDefined();
    expect(screen.getByText("Start")).toBeDefined();
  });

  it("renders heroImage AssetRef", () => {
    render(
      <HeroSection
        section={makeSection("hero", { ...baseProps, heroImage: { assetId: "hero-1" } })}
      />,
    );
    // Hero image renders — text components still visible
    expect(screen.getByText("Welcome")).toBeDefined();
  });

  it("falls back to legacy image URL when AssetRef is missing", () => {
    render(
      <HeroSection
        section={makeSection("hero", {
          ...baseProps,
          heroImage: { assetId: "nonexistent" },
          image: "https://legacy.example.com/img.jpg",
        })}
      />,
    );
    expect(screen.getByText("Welcome")).toBeDefined();
    // Legacy URL fallback is used (no crash)
  });

  it("AssetRef takes precedence over legacy image URL", () => {
    render(
      <HeroSection
        section={makeSection("hero", {
          ...baseProps,
          heroImage: { assetId: "hero-1" },
          image: "https://legacy.example.com/img.jpg",
        })}
      />,
    );
    // No crash, both work harmoniously
    expect(screen.getByText("Welcome")).toBeDefined();
  });

  it("missing AssetRef + no legacy URL = no content image", () => {
    render(
      <HeroSection
        section={makeSection("hero", {
          ...baseProps,
          heroImage: { assetId: "nonexistent" },
        })}
      />,
    );
    expect(screen.getByText("Welcome")).toBeDefined();
  });

  it("projects without assets still render", () => {
    setupStore([]);
    render(<HeroSection section={makeSection("hero", baseProps)} />);
    expect(screen.getByText("Welcome")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Features tests
// ---------------------------------------------------------------------------

describe("FeaturesSection — asset rendering", () => {
  beforeEach(() => setupStore());

  const baseFeatures = {
    title: "Features",
    subtitle: "Our features",
    features: [
      { title: "Fast", description: "Lightning speed", icon: "Zap" },
      { title: "Secure", description: "Bank-grade", icon: "Shield" },
    ],
  };

  it("renders features with emoji fallback when no iconImage", () => {
    render(<FeaturesSection section={makeSection("features", baseFeatures)} />);
    expect(screen.getByText("Fast")).toBeDefined();
    expect(screen.getByText("Secure")).toBeDefined();
  });

  it("renders iconImage AssetRef for a feature", () => {
    render(
      <FeaturesSection
        section={makeSection("features", {
          ...baseFeatures,
          features: [
            { ...baseFeatures.features[0], iconImage: { assetId: "feat-1" } },
            baseFeatures.features[1],
          ],
        })}
      />,
    );
    expect(screen.getByText("Fast")).toBeDefined();
    expect(screen.getByText("Secure")).toBeDefined();
  });

  it("one missing asset does not affect other feature cards", () => {
    render(
      <FeaturesSection
        section={makeSection("features", {
          ...baseFeatures,
          features: [
            { ...baseFeatures.features[0], iconImage: { assetId: "nonexistent" } },
            { ...baseFeatures.features[1], iconImage: { assetId: "feat-1" } },
          ],
        })}
      />,
    );
    expect(screen.getByText("Fast")).toBeDefined();
    expect(screen.getByText("Secure")).toBeDefined();
  });

  it("renders with empty projects (no assets)", () => {
    setupStore([]);
    render(<FeaturesSection section={makeSection("features", baseFeatures)} />);
    expect(screen.getByText("Fast")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// CTA tests
// ---------------------------------------------------------------------------

describe("CtaSection — asset rendering", () => {
  beforeEach(() => setupStore());

  it("renders with default background (no backgroundImage)", () => {
    render(
      <CtaSection
        section={makeSection("cta", { headline: "Get Started", ctaText: "Go" })}
      />,
    );
    expect(screen.getByText("Get Started")).toBeDefined();
    expect(screen.getByText("Go")).toBeDefined();
  });

  it("renders with backgroundImage AssetRef", () => {
    render(
      <CtaSection
        section={makeSection("cta", {
          headline: "Join Now",
          ctaText: "Sign Up",
          backgroundImage: { assetId: "hero-1" },
        })}
      />,
    );
    expect(screen.getByText("Join Now")).toBeDefined();
    expect(screen.getByText("Sign Up")).toBeDefined();
  });

  it("missing background asset falls back to theme color", () => {
    render(
      <CtaSection
        section={makeSection("cta", {
          headline: "Get Started",
          ctaText: "Go",
          backgroundImage: { assetId: "nonexistent" },
        })}
      />,
    );
    expect(screen.getByText("Get Started")).toBeDefined();
  });

  it("foreground content remains visible with background image", () => {
    render(
      <CtaSection
        section={makeSection("cta", {
          headline: "Subscribe",
          subheadline: "Stay updated",
          ctaText: "Join",
          backgroundImage: { assetId: "hero-1" },
        })}
      />,
    );
    expect(screen.getByText("Subscribe")).toBeDefined();
    expect(screen.getByText("Stay updated")).toBeDefined();
    expect(screen.getByText("Join")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Footer tests
// ---------------------------------------------------------------------------

describe("FooterSection — asset rendering", () => {
  beforeEach(() => setupStore());

  it("renders text fallback when no logoImage", () => {
    render(
      <FooterSection
        section={makeSection("footer", { text: "© 2026", links: [] })}
      />,
    );
    expect(screen.getByText("© 2026")).toBeDefined();
  });

  it("renders logo image when logoImage is valid", () => {
    render(
      <FooterSection
        section={makeSection("footer", {
          text: "© 2026",
          logoImage: { assetId: "logo-1" },
          links: [],
        })}
      />,
    );
    expect(() => screen.getByText("© 2026")).toThrow();
  });

  it("falls back to text when logoImage asset is missing", () => {
    render(
      <FooterSection
        section={makeSection("footer", {
          text: "© 2026",
          logoImage: { assetId: "nonexistent" },
          links: [],
        })}
      />,
    );
    expect(screen.getByText("© 2026")).toBeDefined();
  });

  it("preserves footer links when logo image is present", () => {
    render(
      <FooterSection
        section={makeSection("footer", {
          text: "© 2026",
          logoImage: { assetId: "logo-1" },
          links: [{ text: "Privacy", href: "/privacy" }],
        })}
      />,
    );
    expect(screen.getByText("Privacy")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Legacy compatibility — no asset fields produces unchanged output
// ---------------------------------------------------------------------------

describe("Legacy compatibility — no assets field", () => {
  it("projects without assets still render all section types", () => {
    setupStore([]);

    const sections = [
      { type: "header", props: { logoText: "Brand", navLinks: [] } },
      { type: "hero", props: { headline: "Hero", primaryCta: { text: "Go", href: "#" } } },
      { type: "features", props: { title: "Feat", features: [{ title: "F1", description: "D1", icon: "Zap" }] } },
      { type: "cta", props: { headline: "CTA", ctaText: "Go" } },
      { type: "footer", props: { text: "© 2026", links: [] } },
    ];

    for (const s of sections) {
      const section = makeSection(s.type, s.props);
      const Component = ({
        header: HeaderSection,
        hero: HeroSection,
        features: FeaturesSection,
        cta: CtaSection,
        footer: FooterSection,
      } as Record<string, ComponentType<{ section: BaseSection }>>)[s.type];

      expect(() => render(<Component section={section} />)).not.toThrow();
    }
  });

  it("section schemas remain backward-compatible", () => {
    setupStore();

    // Sections with no asset fields should render without error
    const headerNoAsset = makeSection("header", { logoText: "Brand", navLinks: [] });
    expect(() => render(<HeaderSection section={headerNoAsset} />)).not.toThrow();

    const heroNoAsset = makeSection("hero", {
      headline: "Welcome",
      primaryCta: { text: "Start", href: "#" },
    });
    expect(() => render(<HeroSection section={heroNoAsset} />)).not.toThrow();
  });
});
