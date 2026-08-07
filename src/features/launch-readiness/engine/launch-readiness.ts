// ---------------------------------------------------------------------------
// Launch readiness — canonical deterministic engine (Phase P7)
//
// Pure function of the project (plus optional session flags). Returns a
// 0–100 score with per-check deductions. No AI, no side effects, no
// persistence. Used by Launch Center and (indirectly) the guided builder.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import {
  validateProjectForExport,
} from "@/features/export/validators/export-validator";
import { validateRoutingForExport } from "@/features/routing/routes";
import {
  resolveSiteName,
  resolveSeoTitle,
  resolveSeoDescription,
  resolveLanguage,
} from "@/features/site-settings/types";
import { resolveAsset } from "@/features/assets/services/asset-resolver";
import {
  collectProjectLinks,
  collectProjectButtons,
  asString,
} from "./links";
import {
  earnedWeight,
  LAUNCH_CATEGORY_LABELS,
  type LaunchCheck,
  type LaunchCategoryId,
  type LaunchCategorySummary,
  type LaunchReadinessReport,
  type LaunchSeverity,
} from "../types";
import { isUnsafeHref } from "@/features/preview/engine/navigation";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface LaunchReadinessContext {
  /** Session flags (not derived from the project) — optional. */
  hasPreviewedMobile?: boolean;
}

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /\b(?:your|insert|add) (?:text|content|image|heading|title) (?:here|goes here)?\b/i,
  /\bcoming soon\b/i,
  /\bplaceholder\b/i,
  /\btbd\b/i,
  /\[.*\]/,
];

function isPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((p) => p.test(text));
}

function sectionHeadline(section: { type: string; props: Record<string, unknown> }): string {
  const h = asString(section.props.headline);
  if (h) return h;
  const t = asString(section.props.title);
  if (t) return t;
  return "";
}

// ---------------------------------------------------------------------------
// Check builders
// ---------------------------------------------------------------------------

function check(
  id: string,
  category: LaunchCategoryId,
  status: LaunchCheck["status"],
  title: string,
  explanation: string,
  suggestedAction: string,
  options: {
    severity?: LaunchSeverity;
    weight?: number;
    fixActionId?: LaunchCheck["fixActionId"];
    affected?: string;
  } = {},
): LaunchCheck {
  return {
    id,
    category,
    status,
    title,
    explanation,
    suggestedAction,
    severity: options.severity ?? (status === "fail" ? "major" : "minor"),
    weight: options.weight ?? (status === "pass" ? 1 : 0),
    fixActionId: options.fixActionId,
    affected: options.affected,
  };
}

// ---------------------------------------------------------------------------
// Site basics
// ---------------------------------------------------------------------------

function siteBasicsChecks(project: Project): LaunchCheck[] {
  const s = project.siteSettings;
  const checks: LaunchCheck[] = [];

  const siteName = s?.siteName?.trim();
  if (siteName) {
    checks.push(
      check(
        "site-name",
        "site-basics",
        "pass",
        "Your site has a name",
        `Visitors see "${siteName}" in their browser tab and in search results.`,
        "Nothing to do.",
        { weight: 3 },
      ),
    );
  } else {
    checks.push(
      check(
        "site-name",
        "site-basics",
        "fail",
        "Give your site a name",
        "A clear site name helps visitors and search engines understand what your site is.",
        "Open Site settings and add a site name.",
        { weight: 4, fixActionId: "open-site-settings", severity: "major" },
      ),
    );
  }

  const description = s?.siteDescription?.trim() || s?.seo?.description?.trim();
  if (description) {
    checks.push(
      check(
        "site-description",
        "site-basics",
        "pass",
        "Your site has a description",
        "A short description tells people and search engines what your site is about.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "site-description",
        "site-basics",
        "warning",
        "Add a short description",
        "A one-line description helps search results and social posts look complete.",
        "Open Site settings and describe what your site is about.",
        { weight: 2, fixActionId: "open-site-settings" },
      ),
    );
  }

  const favicon = s?.favicon;
  const faviconValid = favicon?.assetId
    ? resolveAsset(favicon, project.assets).src
    : undefined;
  if (faviconValid) {
    checks.push(
      check(
        "site-favicon",
        "site-basics",
        "pass",
        "Your site has an icon",
        "A site icon appears in browser tabs and bookmarks.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "site-favicon",
        "site-basics",
        "warning",
        "Add a site icon",
        "A small square icon makes your site look finished in browser tabs.",
        "Open Site settings and choose an icon.",
        { weight: 1, fixActionId: "open-site-settings" },
      ),
    );
  }

  if (resolveLanguage(s) && s?.language) {
    checks.push(
      check(
        "site-language",
        "site-basics",
        "pass",
        "Your site language is set",
        "The exported site declares its language, which helps search engines.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "site-language",
        "site-basics",
        "info",
        "Language defaults to English",
        "Your site will use English unless you choose another language.",
        "Open Site settings to change it.",
        { weight: 0, fixActionId: "open-site-settings" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function pagesChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  const pages = project.pages ?? [];

  if (pages.length > 0) {
    checks.push(
      check(
        "home-page",
        "pages",
        "pass",
        "Your homepage is ready",
        `"${pages[0].title}" is your homepage — the first page visitors see.`,
        "Nothing to do.",
        { weight: 4 },
      ),
    );
  } else {
    checks.push(
      check(
        "home-page",
        "pages",
        "fail",
        "Add a homepage",
        "Your site needs at least one page before it can be published.",
        "Add a page in the Pages tab.",
        { weight: 5, severity: "critical" },
      ),
    );
  }

  // Duplicate slugs / invalid routes via the canonical export routing rules.
  const routingErrors = validateRoutingForExport(pages);
  if (routingErrors.length > 0) {
    checks.push(
      check(
        "page-routes",
        "pages",
        "fail",
        "Fix a page address problem",
        "Some page addresses conflict or can't be used. This can break links on your published site.",
        routingErrors[0],
        { weight: 5, fixActionId: "open-page-settings", severity: "critical" },
      ),
    );
  } else {
    checks.push(
      check(
        "page-routes",
        "pages",
        "pass",
        "Page addresses are unique",
        "Every page has its own working address.",
        "Nothing to do.",
        { weight: 3 },
      ),
    );
  }

  // Empty pages — a page with no visible content (all sections hidden).
  const emptyPages = pages.filter(
    (p) => !p.sections.some((s) => s.visible !== false),
  );
  if (emptyPages.length === 0) {
    checks.push(
      check(
        "empty-pages",
        "pages",
        "pass",
        "Every page has content",
        "No page is completely empty.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "empty-pages",
        "pages",
        "warning",
        emptyPages.length === 1
          ? `"${emptyPages[0].title}" has no visible content`
          : `${emptyPages.length} pages have no visible content`,
        "Visitors who open an empty page will see nothing.",
        "Add sections to the empty page" +
          (emptyPages.length === 1 ? " or hide it." : "s."),
        { weight: 2, fixActionId: "open-page-settings" },
      ),
    );
  }

  // Page titles
  const untitled = pages.filter((p) => !p.title.trim());
  if (untitled.length === 0) {
    checks.push(
      check(
        "page-titles",
        "pages",
        "pass",
        "Every page has a name",
        "Page names help visitors and search engines understand your site structure.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "page-titles",
        "pages",
        "warning",
        "Name your pages",
        "Some pages don't have a name yet.",
        "Rename the untitled pages.",
        { weight: 1, fixActionId: "open-page-settings" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function navigationChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  const pages = project.pages ?? [];

  // Does any visible page have a header with nav links?
  const headerLinks = project.pages.flatMap((p) =>
    p.sections
      .filter((s) => s.visible !== false && s.type === "header")
      .flatMap((s) => {
        const links = (s.props?.navLinks ?? []) as Array<{ href?: string }>;
        return links.map((l) => ({ href: l.href ?? "", page: p }));
      }),
  );

  const multiPage = pages.length > 1;

  if (!multiPage) {
    checks.push(
      check(
        "nav-exists",
        "navigation",
        "info",
        "One page — navigation optional",
        "Single-page sites don't need a menu, but a footer with links still helps.",
        "Nothing to do yet.",
        { weight: 0 },
      ),
    );
  } else if (headerLinks.length > 0) {
    checks.push(
      check(
        "nav-exists",
        "navigation",
        "pass",
        "Your menu is set up",
        "Visitors can navigate between your pages from the top menu.",
        "Nothing to do.",
        { weight: 3 },
      ),
    );
  } else {
    checks.push(
      check(
        "nav-exists",
        "navigation",
        "warning",
        "Add a menu so visitors can move around",
        "Your site has multiple pages but no top menu pointing to them.",
        "Add a header with menu links to every important page.",
        { weight: 2, fixActionId: "select-section" },
      ),
    );
  }

  // Menu links pointing to valid internal routes.
  const routes = new Set(
    pages.map((p, i) => (i === 0 ? "/" : (p.slug ?? "").replace(/\/+$/, "") || "/")),
  );
  const brokenNav = headerLinks.filter(
    (l) => l.href.startsWith("/") && !routes.has(l.href.replace(/\/+$/, "") || "/"),
  );
  if (brokenNav.length === 0) {
    checks.push(
      check(
        "nav-routes",
        "navigation",
        "pass",
        "Menu links work",
        "Every menu item points to a real page.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "nav-routes",
        "navigation",
        "warning",
        "Fix a menu link",
        "A menu item points to a page that doesn't exist.",
        `Update the menu link "${brokenNav[0].href}".`,
        { weight: 2, fixActionId: "open-broken-link" },
      ),
    );
  }

  // Orphan pages (multi-page, no nav link to them, not home).
  if (multiPage) {
    const linked = new Set(
      headerLinks
        .map((l) => l.href.replace(/\/+$/, "") || "/")
        .filter((h) => routes.has(h)),
    );
    const orphans = pages
      .filter((p, i) => i !== 0)
      .filter((p) => {
        const route = (p.slug ?? "").replace(/\/+$/, "") || "/";
        return !linked.has(route);
      });
    if (orphans.length === 0) {
      checks.push(
        check(
          "nav-orphans",
          "navigation",
          "pass",
          "Every page is reachable",
          "Visitors can reach every page from your menu.",
          "Nothing to do.",
          { weight: 1 },
        ),
      );
    } else {
      checks.push(
        check(
          "nav-orphans",
          "navigation",
          "info",
          orphans.length === 1
            ? `"${orphans[0].title}" isn't in your menu`
            : `${orphans.length} pages aren't in your menu`,
          "Pages without a menu link can still be opened by address, but visitors may not find them.",
          "Add them to your menu, or link to them from your content.",
          { weight: 0 },
        ),
      );
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function contentChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  const allSections = project.pages.flatMap((p) =>
    p.sections.filter((s) => s.visible !== false).map((s) => ({ s, page: p })),
  );

  // Placeholder text
  const placeholders = allSections
    .flatMap(({ s }) => {
      const texts = Object.entries(s.props ?? {})
        .filter(([, v]) => typeof v === "string" && isPlaceholder(v))
        .map(([k]) => `${s.type}.${k}`);
      return texts;
    })
    .slice(0, 3);

  if (placeholders.length === 0) {
    checks.push(
      check(
        "placeholder-text",
        "content",
        "pass",
        "No placeholder text found",
        "Your content reads like a finished site, not a draft.",
        "Nothing to do.",
        { weight: 3 },
      ),
    );
  } else {
    checks.push(
      check(
        "placeholder-text",
        "content",
        "warning",
        "Replace placeholder text",
        "Some text still looks like a draft (for example “lorem ipsum” or “Your text here”).",
        "Update the highlighted sections with real content.",
        { weight: 3, fixActionId: "select-section", severity: "minor" },
      ),
    );
  }

  // Empty headings (hero headline / section titles). Structural sections
  // (header/footer) don't need a headline — they are chrome, not content.
  const emptyHeadings = allSections.filter(
    ({ s }) =>
      s.type !== "header" &&
      s.type !== "footer" &&
      !sectionHeadline(s).length,
  );
  if (emptyHeadings.length === 0) {
    checks.push(
      check(
        "empty-headings",
        "content",
        "pass",
        "Headings are filled in",
        "Every section has a heading.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "empty-headings",
        "content",
        "warning",
        "Add headings to your sections",
        "Some sections have no heading, so visitors can't quickly scan your page.",
        "Add a heading to the highlighted sections.",
        { weight: 2, fixActionId: "select-section" },
      ),
    );
  }

  // Missing important CTA on commercial site types is not statically reliable
  // from the template; check that at least one cta/hero primaryCta exists
  // across the project.
  const buttons = collectProjectButtons(project);
  const hasCta =
    buttons.length > 0 ||
    allSections.some(({ s }) => s.type === "cta");
  if (hasCta) {
    checks.push(
      check(
        "cta-exists",
        "content",
        "pass",
        "Visitors have a clear next step",
        "Your site includes buttons that invite visitors to take action.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "cta-exists",
        "content",
        "info",
        "Consider a call-to-action button",
        "A button like “Contact us” or “Get started” helps visitors know what to do next.",
        "Add a button or a call-to-action section.",
        { weight: 0, fixActionId: "select-section" },
      ),
    );
  }

  // Duplicate headings
  const headingCounts = new Map<string, number>();
  for (const { s } of allSections) {
    const h = sectionHeadline(s).toLowerCase();
    if (h) headingCounts.set(h, (headingCounts.get(h) ?? 0) + 1);
  }
  const dupes = [...headingCounts.entries()].filter(([, n]) => n >= 3);
  if (dupes.length === 0) {
    checks.push(
      check(
        "duplicate-headings",
        "content",
        "pass",
        "Headings are distinct",
        "Each section has its own heading.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "duplicate-headings",
        "content",
        "info",
        `"${dupes[0][0]}" appears ${dupes[0][1]} times`,
        "Repeated headings make pages feel repetitive.",
        "Vary the headings on your sections.",
        { weight: 0, fixActionId: "select-section" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

function mobileChecks(project: Project, ctx: LaunchReadinessContext): LaunchCheck[] {
  const checks: LaunchCheck[] = [];

  // Fixed widths and min-widths are the strongest statically-detectable
  // overflow risk.
  const riskyStyles: string[] = [];
  for (const page of project.pages ?? []) {
    for (const section of page.sections ?? []) {
      const styles = section.styles ?? {};
      for (const value of Object.values(styles)) {
        if (typeof value !== "string") continue;
        const lower = value.toLowerCase();
        if (
          /(^|;|:)\s*(min-)?width\s*:\s*\d{4,}px/.test(lower) ||
          /(^|;|:)\s*width\s*:\s*\d{4,}px/.test(lower)
        ) {
          riskyStyles.push(`${section.type} (${page.title})`);
        }
      }
    }
  }

  if (riskyStyles.length === 0) {
    checks.push(
      check(
        "mobile-overflow",
        "mobile",
        "pass",
        "No obvious overflow risk detected",
        "Nothing looks like it would force sideways scrolling on a phone.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "mobile-overflow",
        "mobile",
        "warning",
        "A style may overflow on small screens",
        `"${riskyStyles[0]}" has a very wide width which can force horizontal scrolling on phones.`,
        "Open the mobile preview and check that section.",
        { weight: 2, fixActionId: "open-mobile-preview" },
      ),
    );
  }

  // Tiny touch targets — buttons with very short labels are still tappable;
  // the model can't measure size. We surface a friendly hint instead.
  if (ctx.hasPreviewedMobile) {
    checks.push(
      check(
        "mobile-preview",
        "mobile",
        "pass",
        "You checked the phone view",
        "Previewing on a phone helps catch layout issues before visitors do.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "mobile-preview",
        "mobile",
        "info",
        "Preview on a phone",
        "A quick phone preview can catch layout surprises.",
        "Open the preview and switch to Phone.",
        { weight: 0, fixActionId: "open-mobile-preview" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

function accessibilityChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  const allSections = project.pages.flatMap((p) =>
    p.sections.filter((s) => s.visible !== false),
  );

  // Images without alt text (AssetRefs without altText or altText empty).
  const missingAlt: string[] = [];
  for (const section of allSections) {
    const props = section.props ?? {};
    for (const [key, value] of Object.entries(props)) {
      if (
        value &&
        typeof value === "object" &&
        "assetId" in (value as Record<string, unknown>)
      ) {
        const ref = value as { assetId: string; altText?: string };
        if (!ref.altText?.trim()) {
          missingAlt.push(`${section.type}.${key}`);
        }
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (
            item &&
            typeof item === "object" &&
            "assetId" in (item as Record<string, unknown>)
          ) {
            const ref = item as { assetId: string; altText?: string };
            if (!ref.altText?.trim()) {
              missingAlt.push(`${section.type}.${key}[]`);
            }
          }
        }
      }
    }
  }

  if (missingAlt.length === 0) {
    checks.push(
      check(
        "image-alt",
        "accessibility",
        "pass",
        "Images have descriptions",
        "Screen readers can describe your images to visitors who can't see them.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "image-alt",
        "accessibility",
        "warning",
        "Describe your images",
        "Some images have no text description, so screen readers can't explain them.",
        `Add descriptions to ${missingAlt.length} image${missingAlt.length > 1 ? "s" : ""}.`,
        { weight: 2, fixActionId: "select-section" },
      ),
    );
  }

  // Empty links
  const links = collectProjectLinks(project);
  const emptyLabelLinks = links.filter(
    (l) => !l.label && !l.href.startsWith("#") && !/^(mailto:|tel:)/i.test(l.href),
  );
  if (emptyLabelLinks.length === 0) {
    checks.push(
      check(
        "link-labels",
        "accessibility",
        "pass",
        "Links have text",
        "Every link has readable text describing where it goes.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "link-labels",
        "accessibility",
        "warning",
        "Label your links",
        "Some links have no text, so visitors (and screen readers) can't tell where they go.",
        "Add text to the links.",
        { weight: 1, fixActionId: "select-section" },
      ),
    );
  }

  // Heading hierarchy hint — only when a page has a subheading but no hero
  // headline, etc. Keep it simple: warn when a page has headings but none
  // starts with H1-like prominence (hero absent).
  const pagesWithoutHero = project.pages.filter(
    (p) =>
      p.sections.filter((s) => s.visible !== false && s.type === "hero").length === 0,
  );
  if (pagesWithoutHero.length === 0) {
    checks.push(
      check(
        "heading-hierarchy",
        "accessibility",
        "pass",
        "Each page has a main heading",
        "Every page has a hero heading that introduces the page.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "heading-hierarchy",
        "accessibility",
        "info",
        "Add a main heading to some pages",
        "Pages without a main heading can be harder to scan for visitors and screen readers.",
        "Add a hero section to the page" +
          (pagesWithoutHero.length > 1 ? "s" : "") + ".",
        { weight: 0, fixActionId: "select-section" },
      ),
    );
  }

  // Accessibility disclaimer (info).
  checks.push(
    check(
      "a11y-disclaimer",
      "accessibility",
      "info",
      "Automated checks can't catch everything",
      "Buildora catches common issues, but a human review is still the best accessibility test.",
      "Ask someone to try your site, or test with a screen reader.",
      { weight: 0 },
    ),
  );

  return checks;
}

// ---------------------------------------------------------------------------
// Search & sharing
// ---------------------------------------------------------------------------

function searchSharingChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  const s = project.siteSettings;
  const name = resolveSiteName(s, project.name);

  const seoTitle = resolveSeoTitle(s, project.name);
  if (seoTitle && seoTitle !== name) {
    checks.push(
      check(
        "seo-title",
        "search-sharing",
        "pass",
        "Your search title is set",
        `Search results will show "${seoTitle}".`,
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "seo-title",
        "search-sharing",
        "warning",
        "Set a search title",
        "A clear search title helps people choose your site over others.",
        "Open Site settings → Search & sharing and add a Google title.",
        { weight: 2, fixActionId: "open-seo-settings" },
      ),
    );
  }

  const description = resolveSeoDescription(s);
  if (description) {
    checks.push(
      check(
        "seo-description",
        "search-sharing",
        "pass",
        "Your search description is set",
        "Search results will show a short summary of your site.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "seo-description",
        "search-sharing",
        "warning",
        "Set a search description",
        "Without a description, search engines pick their own (often worse) text.",
        "Open Site settings → Search & sharing and add a Google description.",
        { weight: 2, fixActionId: "open-seo-settings" },
      ),
    );
  }

  const socialImage = s?.social?.image?.assetId
    ? resolveAsset(s.social.image, project.assets).src
    : undefined;
  if (socialImage) {
    checks.push(
      check(
        "social-image",
        "search-sharing",
        "pass",
        "Shared links have an image",
        "Your site will look great when shared on social apps.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "social-image",
        "search-sharing",
        "info",
        "Add a share image",
        "Shared links without an image look plain in social feeds.",
        "Open Site settings → Search & sharing and choose a share image.",
        { weight: 0, fixActionId: "open-seo-settings" },
      ),
    );
  }

  // Page metadata completeness
  const pagesWithoutMeta = project.pages.filter(
    (p) => !(p.meta?.title?.trim() || p.meta?.seoTitle?.trim()),
  );
  if (pagesWithoutMeta.length === 0) {
    checks.push(
      check(
        "page-meta",
        "search-sharing",
        "pass",
        "Every page has a search title",
        "Each page has its own title for search results.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "page-meta",
        "search-sharing",
        "info",
        `Add search titles to ${pagesWithoutMeta.length} page${pagesWithoutMeta.length > 1 ? "s" : ""}`,
        "Pages without a search title fall back to their page name.",
        "Open Page settings for each page and set a Google title.",
        { weight: 0, fixActionId: "open-page-settings" },
      ),
    );
  }

  // Noindex awareness
  if (s?.seo?.robotsIndex === false) {
    checks.push(
      check(
        "noindex",
        "search-sharing",
        "warning",
        "Your site is hidden from search engines",
        "Search engines are currently told not to list your site.",
        "If you want to be found on Google, enable “Show this site in search engines”.",
        { weight: 2, fixActionId: "open-seo-settings", severity: "minor" },
      ),
    );
  } else {
    checks.push(
      check(
        "noindex",
        "search-sharing",
        "pass",
        "Your site is findable",
        "Search engines are allowed to list your site.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Links & actions
// ---------------------------------------------------------------------------

function linksChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];
  const pages = project.pages ?? [];
  const routes = new Set(
    pages.map((p, i) => (i === 0 ? "/" : (p.slug ?? "").replace(/\/+$/, "") || "/")),
  );

  const links = collectProjectLinks(project);

  // Unsafe hrefs — hard fail (security).
  const unsafe = links.filter((l) => isUnsafeHref(l.href));
  if (unsafe.length === 0) {
    checks.push(
      check(
        "unsafe-hrefs",
        "links-actions",
        "pass",
        "No unsafe links detected",
        "No links use dangerous addresses that could harm visitors.",
        "Nothing to do.",
        { weight: 3 },
      ),
    );
  } else {
    checks.push(
      check(
        "unsafe-hrefs",
        "links-actions",
        "fail",
        "Remove an unsafe link",
        "A link uses a blocked address scheme. It won't work on your published site and could be a security risk.",
        `Fix the link starting with "${unsafe[0].href.slice(0, 40)}".`,
        { weight: 5, fixActionId: "open-broken-link", severity: "critical" },
      ),
    );
  }

  // Invalid internal links (internal paths that don't match a page route).
  const invalidInternal = links.filter(
    (l) =>
      l.href.startsWith("/") &&
      !l.href.startsWith("//") &&
      !routes.has(l.href.split(/[?#]/)[0].replace(/\/+$/, "") || "/"),
  );
  if (invalidInternal.length === 0) {
    checks.push(
      check(
        "internal-links",
        "links-actions",
        "pass",
        "Links point to real pages",
        "Every internal link points to a page that exists.",
        "Nothing to do.",
        { weight: 3 },
      ),
    );
  } else {
    checks.push(
      check(
        "internal-links",
        "links-actions",
        "warning",
        "Fix a link that goes nowhere",
        `"${invalidInternal[0].href}" doesn't match any page on your site.`,
        "Point the link to a real page, or remove it.",
        { weight: 3, fixActionId: "open-broken-link" },
      ),
    );
  }

  // Empty hrefs ("#" or missing) on buttons — no meaningful target.
  const buttons = collectProjectButtons(project);
  const noTarget = buttons.filter(
    (b) => !b.href || b.href === "#" || b.href.trim() === "",
  );
  if (noTarget.length === 0) {
    checks.push(
      check(
        "button-targets",
        "links-actions",
        "pass",
        "Buttons do something",
        "Every button has a destination or action.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "button-targets",
        "links-actions",
        "warning",
        noTarget.length === 1
          ? "One button doesn't do anything yet"
          : `${noTarget.length} buttons don't do anything yet`,
        "A button with no destination confuses visitors when nothing happens.",
        "Choose what the button should do (page, link, email, or phone).",
        { weight: 2, fixActionId: "open-broken-link" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Performance hints
// ---------------------------------------------------------------------------

function performanceChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];

  const oversized = project.assets.filter((a) => a.size > 2 * 1024 * 1024);
  if (oversized.length === 0) {
    checks.push(
      check(
        "image-sizes",
        "performance",
        "pass",
        "Images are reasonably sized",
        "Large images are the most common cause of slow websites.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "image-sizes",
        "performance",
        "warning",
        `${oversized.length} image${oversized.length > 1 ? "s are" : " is"} larger than 2 MB`,
        "Large images make your site slower to load, especially on phones.",
        `Consider replacing "${oversized[0].name}" with a smaller image.`,
        { weight: 2, fixActionId: "open-site-settings", severity: "minor" },
      ),
    );
  }

  const sectionCount = project.pages.reduce(
    (n, p) => n + p.sections.filter((s) => s.visible !== false).length,
    0,
  );
  if (sectionCount <= 40) {
    checks.push(
      check(
        "section-count",
        "performance",
        "pass",
        "Your site has a healthy number of sections",
        "Too many sections can slow down rendering.",
        "Nothing to do.",
        { weight: 1 },
      ),
    );
  } else {
    checks.push(
      check(
        "section-count",
        "performance",
        "info",
        `Your site has ${sectionCount} sections`,
        "That's a lot — consider trimming to keep pages snappy.",
        "Remove sections you don't need.",
        { weight: 0, fixActionId: "select-section" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Publish readiness
// ---------------------------------------------------------------------------

function publishChecks(project: Project): LaunchCheck[] {
  const checks: LaunchCheck[] = [];

  const validation = validateProjectForExport(project);
  if (validation.valid) {
    checks.push(
      check(
        "export-valid",
        "publish",
        "pass",
        "Your site passes the final check",
        "Buildora checked your site's structure and everything looks publishable.",
        "Nothing to do.",
        { weight: 5 },
      ),
    );
  } else {
    const first = validation.errors[0] ?? "Something isn't quite right.";
    checks.push(
      check(
        "export-valid",
        "publish",
        "fail",
        "One thing needs fixing before publishing",
        "Buildora found a problem that would break the published site.",
        first,
        { weight: 5, severity: "critical", fixActionId: "open-page-settings" },
      ),
    );
  }

  // Form behavior policy — custom blocks may contain form elements; without a
  // backend they won't submit anywhere.
  const forms = project.pages.flatMap((p) =>
    p.sections
      .filter((s) => s.visible !== false && s.type === "custom-block")
      .map((s) => ({ s, page: p })),
  ).filter(({ s }) => {
    const tree = (s.props?.tree ?? {}) as { nodes?: Record<string, unknown> };
    return Object.values(tree.nodes ?? {}).some((n) => {
      const node = n as { type?: string };
      return node.type === "form" || node.type === "input" || node.type === "textarea";
    });
  });

  if (forms.length === 0) {
    checks.push(
      check(
        "form-behavior",
        "publish",
        "pass",
        "No unconnected forms detected",
        "Your site has no forms that expect a submission service.",
        "Nothing to do.",
        { weight: 2 },
      ),
    );
  } else {
    checks.push(
      check(
        "form-behavior",
        "publish",
        "warning",
        "Your form needs a home for submissions",
        "This form looks ready, but submissions need somewhere to go. Buildora doesn't send form data anywhere on its own.",
        "Connect the form to a service you own, or remove it until you do.",
        { weight: 2, fixActionId: "select-section", severity: "minor" },
      ),
    );
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function getLaunchReadinessReport(
  project: Project,
  ctx: LaunchReadinessContext = {},
): LaunchReadinessReport {
  const checks: LaunchCheck[] = [
    ...siteBasicsChecks(project),
    ...pagesChecks(project),
    ...navigationChecks(project),
    ...contentChecks(project),
    ...mobileChecks(project, ctx),
    ...accessibilityChecks(project),
    ...searchSharingChecks(project),
    ...linksChecks(project),
    ...performanceChecks(project),
    ...publishChecks(project),
  ];

  // ---- Score ----
  const scored = checks.filter((c) => c.weight > 0);
  const possible = scored.reduce((n, c) => n + c.weight, 0);
  const earned = scored.reduce((n, c) => n + earnedWeight(c), 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  // ---- Category summaries ----
  const categories: LaunchCategorySummary[] = (
    Object.keys(LAUNCH_CATEGORY_LABELS) as LaunchCategoryId[]
  ).map((id) => {
    const catChecks = checks.filter((c) => c.category === id);
    const catPossible = catChecks.reduce((n, c) => n + c.weight, 0);
    const catEarned = catChecks.reduce((n, c) => n + earnedWeight(c), 0);
    const fails = catChecks.filter((c) => c.status === "fail");
    const warnings = catChecks.filter((c) => c.status === "warning");
    const status =
      catPossible === 0
        ? "info"
        : fails.length > 0
          ? "fail"
          : warnings.length > 0
            ? "warning"
            : "pass";
    return {
      id,
      label: LAUNCH_CATEGORY_LABELS[id],
      earned: Math.round(catEarned),
      possible: catPossible,
      status,
    };
  });

  // ---- Strong / couldImprove ----
  const strong = checks
    .filter((c) => c.status === "pass")
    .map((c) => c.title)
    .slice(0, 8);
  const couldImprove = checks
    .filter((c) => c.status === "warning" || c.status === "fail")
    .map((c) => c.title)
    .slice(0, 8);

  // ---- Blockers ----
  const blockers = checks
    .filter((c) => c.status === "fail" && c.severity === "critical")
    .map((c) => c.title);

  return {
    score,
    checks,
    categories,
    strong,
    couldImprove,
    blocked: blockers.length > 0,
    blockers,
  };
}

// ---------------------------------------------------------------------------
// Unpublished-changes helper (pure)
// ---------------------------------------------------------------------------

/** True when the current project content differs from a deployed snapshot. */
export function hasUnpublishedChanges(
  currentContentHash: string,
  deployedContentHash: string | undefined,
): boolean {
  if (!deployedContentHash) return false;
  return currentContentHash !== deployedContentHash;
}
