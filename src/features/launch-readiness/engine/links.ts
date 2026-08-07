// ---------------------------------------------------------------------------
// Launch readiness — link/action collection
//
// Enumerates every user-authored link/action in a project:
//   - standard sections (header nav + CTA, hero CTAs, cta section, footer
//     links, feature links) — mirrors the export LINK_TRANSFORMS
//   - custom-block trees (deep scan of node props for href-like strings)
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";

export interface CollectedLink {
  href: string;
  /** Human-readable label (link text) when available. */
  label?: string;
  /** Set by collectProjectLinks; the section collectors omit it. */
  pageId?: string;
  sectionId: string;
  /** Field path for precise messaging (e.g. "navLinks[0].href"). */
  field?: string;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function labelOf(obj: unknown): string | undefined {
  if (obj && typeof obj === "object") {
    const text = asString((obj as Record<string, unknown>).text);
    return text || undefined;
  }
  return undefined;
}

function arrayItems(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object",
  );
}

/** Collect links from a standard section using the export link transforms. */
export function collectSectionLinks(section: BaseSection): CollectedLink[] {
  const out: CollectedLink[] = [];
  const props = section.props ?? {};
  const push = (href: unknown, label: string | undefined, field: string) => {
    const value = asString(href);
    if (!value) return;
    out.push({ href: value, label, sectionId: section.id, field });
  };

  switch (section.type) {
    case "header": {
      const navLinks = arrayItems(props.navLinks);
      navLinks.forEach((item, i) => {
        push(item.href, labelOf(item), `navLinks[${i}].href`);
      });
      push(props.ctaHref, asString(props.ctaText) || undefined, "ctaHref");
      break;
    }
    case "hero": {
      push(
        (props.primaryCta as Record<string, unknown>)?.href,
        labelOf(props.primaryCta),
        "primaryCta.href",
      );
      push(
        (props.secondaryCta as Record<string, unknown>)?.href,
        labelOf(props.secondaryCta),
        "secondaryCta.href",
      );
      break;
    }
    case "cta": {
      push(props.ctaHref, asString(props.ctaText) || undefined, "ctaHref");
      break;
    }
    case "footer": {
      arrayItems(props.links).forEach((item, i) => {
        push(item.href, labelOf(item), `links[${i}].href`);
      });
      break;
    }
    case "features": {
      arrayItems(props.features).forEach((item, i) => {
        const link = item.link;
        if (link && typeof link === "object") {
          push(
            (link as Record<string, unknown>).href,
            labelOf(link) || asString(item.title) || undefined,
            `features[${i}].link.href`,
          );
        }
      });
      break;
    }
    default:
      break;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Custom-block deep scan — href-like strings in tree node props
// ---------------------------------------------------------------------------

/** Keys commonly used for links/actions inside block trees. */
const HREF_KEYS = new Set([
  "href", "url", "link", "to", "action", "target", "srcLink",
]);

export function collectCustomBlockLinks(section: BaseSection): CollectedLink[] {
  const out: CollectedLink[] = [];
  const tree = (section.props?.tree ?? {}) as {
    nodes?: Record<string, { props?: Record<string, unknown> }>;
  };
  const nodes = tree.nodes ?? {};

  for (const [nodeId, node] of Object.entries(nodes)) {
    const props = node.props ?? {};
    for (const [key, value] of Object.entries(props)) {
      if (!HREF_KEYS.has(key)) continue;
      const href = asString(value);
      if (!href) continue;
      // Only include clearly link-like values to avoid false positives on
      // decorative strings (e.g. button labels).
      if (
        href.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/i.test(href) ||
        href.startsWith("#")
      ) {
        out.push({
          href,
          label: undefined,
          sectionId: section.id,
          field: `block:${nodeId}.${key}`,
        });
      }
    }
  }

  return out;
}

/** Collect every link/action in the project. */
export function collectProjectLinks(project: Project): CollectedLink[] {
  const out: CollectedLink[] = [];
  for (const page of project.pages ?? []) {
    for (const section of page.sections ?? []) {
      const links =
        section.type === "custom-block"
          ? collectCustomBlockLinks(section)
          : collectSectionLinks(section);
      for (const link of links) {
        out.push({ ...link, pageId: page.id });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Buttons with no meaningful action (standard sections)
// ---------------------------------------------------------------------------

export interface CollectedButton {
  pageId: string;
  sectionId: string;
  label?: string;
  field?: string;
  href?: string;
}

/** Collect actionable buttons where the target may be empty/placeholder. */
export function collectProjectButtons(project: Project): CollectedButton[] {
  const out: CollectedButton[] = [];
  for (const page of project.pages ?? []) {
    for (const section of page.sections ?? []) {
      const props = section.props ?? {};
      const push = (
        href: unknown,
        label: string | undefined,
        field: string,
      ) => {
        out.push({
          pageId: page.id,
          sectionId: section.id,
          label,
          field,
          href: asString(href) || undefined,
        });
      };
      if (section.type === "header") {
        const href = asString(props.ctaHref);
        const text = asString(props.ctaText);
        // Only a button that actually exists (text or target present) counts.
        if (href || text) push(props.ctaHref, text || undefined, "ctaHref");
      } else if (section.type === "hero") {
        const primary = props.primaryCta;
        if (primary && typeof primary === "object") {
          push(
            (primary as Record<string, unknown>).href,
            labelOf(primary),
            "primaryCta.href",
          );
        }
        const secondary = props.secondaryCta;
        if (secondary && typeof secondary === "object") {
          push(
            (secondary as Record<string, unknown>).href,
            labelOf(secondary),
            "secondaryCta.href",
          );
        }
      } else if (section.type === "cta") {
        const href = asString(props.ctaHref);
        const text = asString(props.ctaText);
        if (href || text) push(props.ctaHref, text || undefined, "ctaHref");
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
