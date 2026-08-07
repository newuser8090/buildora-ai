// ---------------------------------------------------------------------------
// Launch readiness — link/action collection (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  collectSectionLinks,
  collectCustomBlockLinks,
  collectProjectLinks,
  collectProjectButtons,
  asString,
} from "../engine/links";
import type { BaseSection } from "@/types/section";
import { makeProject } from "./helpers";

function section(type: string, props: Record<string, unknown> = {}): BaseSection {
  return { id: `s-${type}`, type, order: 1, visible: true, props, styles: {} } as unknown as BaseSection;
}

describe("asString", () => {
  it("trims strings and returns '' for non-strings", () => {
    expect(asString("  hi  ")).toBe("hi");
    expect(asString(42)).toBe("");
    expect(asString(null)).toBe("");
    expect(asString(undefined)).toBe("");
  });
});

describe("collectSectionLinks", () => {
  it("collects header nav links and CTA", () => {
    const links = collectSectionLinks(
      section("header", {
        navLinks: [
          { text: "About", href: "/about" },
          { text: "", href: "/contact" },
        ],
        ctaHref: "/contact",
        ctaText: "Contact",
      }),
    );
    expect(links.map((l) => l.href)).toEqual(["/about", "/contact", "/contact"]);
    expect(links[0].label).toBe("About");
    expect(links[0].field).toBe("navLinks[0].href");
    expect(links[1].label).toBeUndefined();
    expect(links[2].field).toBe("ctaHref");
  });

  it("collects hero primary and secondary CTAs", () => {
    const links = collectSectionLinks(
      section("hero", {
        headline: "Hi",
        primaryCta: { text: "Go", href: "/about" },
        secondaryCta: { text: "Email", href: "mailto:a@b.com" },
      }),
    );
    expect(links.map((l) => l.href)).toEqual(["/about", "mailto:a@b.com"]);
    expect(links[0].field).toBe("primaryCta.href");
  });

  it("collects cta section and footer links", () => {
    const ctaLinks = collectSectionLinks(section("cta", { ctaText: "Go", ctaHref: "#pricing" }));
    expect(ctaLinks).toHaveLength(1);
    expect(ctaLinks[0].href).toBe("#pricing");

    const footerLinks = collectSectionLinks(
      section("footer", {
        text: "© 2026",
        links: [{ text: "Privacy", href: "/privacy" }],
      }),
    );
    expect(footerLinks).toHaveLength(1);
    expect(footerLinks[0].href).toBe("/privacy");
  });

  it("collects feature links", () => {
    const links = collectSectionLinks(
      section("features", {
        title: "Feat",
        features: [
          { title: "One", link: { text: "More", href: "/about" } },
          { title: "Two" },
        ],
      }),
    );
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe("/about");
    expect(links[0].label).toBe("More");
  });

  it("ignores sections with no link fields", () => {
    expect(collectSectionLinks(section("faq", { items: [] }))).toEqual([]);
  });

  it("skips empty hrefs", () => {
    const links = collectSectionLinks(
      section("header", { navLinks: [{ text: "X", href: "   " }], ctaHref: "" }),
    );
    expect(links).toEqual([]);
  });
});

describe("collectCustomBlockLinks", () => {
  it("deep-scans block tree node props for link-like values", () => {
    const links = collectCustomBlockLinks(
      section("custom-block", {
        tree: {
          nodes: {
            n1: { props: { href: "/about" } },
            n2: { props: { url: "https://example.com" } },
            n3: { props: { href: "mailto:hi@example.com" } },
            n4: { props: { href: "#section" } },
            n5: { props: { href: "just-text" } }, // not link-like — skipped
            n6: { props: { label: "/also-not-a-link-key" } }, // wrong key — skipped
          },
        },
      }),
    );
    expect(links.map((l) => l.href).sort()).toEqual([
      "#section",
      "/about",
      "https://example.com",
      "mailto:hi@example.com",
    ]);
    expect(links[0].field).toMatch(/^block:n\d+\.(href|url)$/);
  });

  it("handles missing tree gracefully", () => {
    expect(collectCustomBlockLinks(section("custom-block", {}))).toEqual([]);
  });
});

describe("collectProjectLinks", () => {
  it("merges all pages and annotates pageId", () => {
    const project = makeProject();
    const links = collectProjectLinks(project);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.pageId).toBeDefined();
      expect(link.sectionId).toBeDefined();
    }
    const about = links.filter((l) => l.href === "/about");
    expect(about.length).toBeGreaterThan(0);
  });
});

describe("collectProjectButtons", () => {
  it("collects actionable buttons from header, hero, and cta sections", () => {
    const project = makeProject();
    const buttons = collectProjectButtons(project);
    expect(buttons.length).toBeGreaterThan(0);
    const targets = buttons.map((b) => b.href);
    expect(targets).toContain("/contact"); // header CTA
    expect(targets).toContain("/about"); // hero primary CTA
  });

  it("includes buttons with placeholder targets", () => {
    const buttons = collectProjectButtons(
      makeProject({
        pages: [
          {
            id: "p1", title: "Home", slug: "/",
            sections: [
              {
                id: "s1", type: "hero", order: 1, visible: true,
                props: { headline: "Hi", primaryCta: { text: "Go", href: "#" } },
                styles: {},
              },
            ],
          },
        ],
      }),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0].href).toBe("#");
  });
});
