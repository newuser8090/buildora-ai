// ---------------------------------------------------------------------------
// Website readiness score — transparent, deterministic 0–100 (Phase N, §12)
//
// Rules:
//   - purely data-derived from the current (visible) page state
//   - never claims business performance — only structural/content readiness
//   - score creates no history and no autosave (pure function)
//   - hidden sections are excluded by the caller (they pass visible sections)
//   - different site categories may adjust a couple of rules
// ---------------------------------------------------------------------------

import type {
  BuilderSiteType,
  ReadinessCategoryId,
  ReadinessCategoryResult,
  ReadinessReport,
} from "../types";

export interface ReadinessSection {
  type: string;
  props: Record<string, unknown>;
}

export interface ReadinessContext {
  siteType: BuilderSiteType;
  /** Visible sections on the current page. */
  sections: ReadinessSection[];
  pageTitle: string;
  pageMeta?: { title?: string; description?: string } | null;
  pageCount: number;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasType(sections: ReadinessSection[], type: string): boolean {
  return sections.some((s) => s.type === type);
}

function sectionOf(
  sections: ReadinessSection[],
  type: string,
): ReadinessSection | undefined {
  return sections.find((s) => s.type === type);
}

function featureDescriptions(sections: ReadinessSection[]): number {
  const features = sectionOf(sections, "features");
  if (!features) return 0;
  const list = features.props.features;
  if (!Array.isArray(list)) return 0;
  return list.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      asString((item as Record<string, unknown>).description).length > 0,
  ).length;
}

// ---------------------------------------------------------------------------
// Category rules — each returns points earned + notes
// ---------------------------------------------------------------------------

interface CategoryRule {
  id: ReadinessCategoryId;
  label: string;
  possible: number;
  evaluate(ctx: ReadinessContext): { earned: number; notes: string[] };
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    id: "structure",
    label: "Structure",
    possible: 20,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      if (hasType(ctx.sections, "header")) {
        earned += 6;
        notes.push("Top navigation added");
      } else {
        notes.push("Add top navigation");
      }
      if (hasType(ctx.sections, "footer")) {
        earned += 6;
        notes.push("Bottom information added");
      } else {
        notes.push("Add bottom information");
      }
      if (ctx.sections.length >= 3) {
        earned += 8;
        notes.push("Page has several building blocks");
      } else {
        notes.push("Add a couple more building blocks");
      }
      return { earned, notes };
    },
  },
  {
    id: "content",
    label: "Content",
    possible: 20,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      const hero = sectionOf(ctx.sections, "hero");
      if (hero && asString(hero.props.headline).length > 0) {
        earned += 8;
        notes.push("Clear main message");
      } else {
        notes.push("Write your main message");
      }
      if (hero && asString(hero.props.subheadline).length > 0) {
        earned += 6;
        notes.push("Supporting text added");
      } else {
        notes.push("Add a short supporting sentence");
      }
      if (hasType(ctx.sections, "features")) {
        earned += 6;
        notes.push("What you offer is explained");
      } else {
        notes.push("Explain what you offer");
      }
      return { earned, notes };
    },
  },
  {
    id: "trust",
    label: "Trust",
    possible: 15,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      if (hasType(ctx.sections, "faq")) {
        earned += 8;
        notes.push("Common questions answered");
      } else {
        notes.push("Add common questions");
      }
      if (featureDescriptions(ctx.sections) > 0) {
        earned += 7;
        notes.push("Benefits are described in detail");
      } else {
        notes.push("Describe your benefits in a few words");
      }
      return { earned, notes };
    },
  },
  {
    id: "action",
    label: "Action",
    possible: 15,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      if (hasType(ctx.sections, "cta")) {
        earned += 8;
        notes.push("Clear next step added");
      } else {
        notes.push("Add a next step");
      }
      const hero = sectionOf(ctx.sections, "hero");
      const cta = sectionOf(ctx.sections, "cta");
      const ctaText =
        cta && asString(cta.props.ctaText).length > 0
          ? asString(cta.props.ctaText)
          : hero &&
              hero.props.primaryCta &&
              typeof hero.props.primaryCta === "object"
            ? asString((hero.props.primaryCta as Record<string, unknown>).text)
            : "";
      if (ctaText.length > 0) {
        earned += 7;
        notes.push("Action button labelled");
      } else {
        notes.push("Label an action button");
      }
      return { earned, notes };
    },
  },
  {
    id: "navigation",
    label: "Navigation",
    possible: 10,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      if (ctx.pageCount >= 2) {
        earned += 6;
        notes.push("More than one page");
      } else {
        notes.push("Add another page");
      }
      const header = sectionOf(ctx.sections, "header");
      if (
        header &&
        Array.isArray(header.props.navLinks) &&
        header.props.navLinks.length > 0
      ) {
        earned += 4;
        notes.push("Menu links added");
      } else {
        notes.push("Add menu links");
      }
      return { earned, notes };
    },
  },
  {
    id: "mobile",
    label: "Mobile readiness",
    possible: 10,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      const hero = sectionOf(ctx.sections, "hero");
      const cta = sectionOf(ctx.sections, "cta");
      const headline =
        (hero && asString(hero.props.headline)) ||
        (cta && asString(cta.props.headline)) ||
        "";
      if (headline.length === 0 || headline.length <= 100) {
        earned += 5;
        notes.push("Main message fits phone screens");
      } else {
        notes.push("Shorten the main message for phones");
      }
      if (ctx.sections.length >= 2) {
        earned += 5;
        notes.push("Page is laid out for small screens");
      } else {
        notes.push("Add more content before previewing on a phone");
      }
      return { earned, notes };
    },
  },
  {
    id: "seo",
    label: "SEO basics",
    possible: 10,
    evaluate(ctx) {
      let earned = 0;
      const notes: string[] = [];
      const meta = ctx.pageMeta;
      if (meta && (asString(meta.title).length > 0 || asString(ctx.pageTitle).length > 0)) {
        earned += 5;
        notes.push("Page has a clear title");
      } else {
        notes.push("Give the page a clear title");
      }
      if (meta && asString(meta.description).length > 0) {
        earned += 5;
        notes.push("Page description added");
      } else {
        notes.push("Add a short page description");
      }
      return { earned, notes };
    },
  },
];

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export function getReadinessReport(ctx: ReadinessContext): ReadinessReport {
  const categories: ReadinessCategoryResult[] = CATEGORY_RULES.map((rule) => {
    const { earned, notes } = rule.evaluate(ctx);
    return {
      id: rule.id,
      label: rule.label,
      pointsEarned: Math.min(earned, rule.possible),
      pointsPossible: rule.possible,
      notes,
    };
  });

  const totalEarned = categories.reduce((sum, c) => sum + c.pointsEarned, 0);
  const totalPossible = categories.reduce((sum, c) => sum + c.pointsPossible, 0);
  const score = Math.round((totalEarned / Math.max(totalPossible, 1)) * 100);

  const strong: string[] = [];
  const couldImprove: string[] = [];
  for (const category of categories) {
    for (const note of category.notes) {
      if (category.pointsEarned > 0 && noteIsEarned(category, note)) {
        strong.push(note);
      } else if (!noteIsEarned(category, note)) {
        couldImprove.push(note);
      }
    }
  }

  return { score, categories, strong, couldImprove };
}

/** A note is "earned" when the category earned at least one point and the
 *  note does not begin with "Add "/"Write "/"Label "/"Shorten "/"Give "/"Describe "/
 *  "Explain "/"Check ". Deterministic heuristic — earned notes never instruct
 *  the user to do something. */
function noteIsEarned(
  category: ReadinessCategoryResult,
  note: string,
): boolean {
  if (category.pointsEarned === 0) return false;
  const ACTION_PREFIXES = [
    "Add ",
    "Write ",
    "Label ",
    "Shorten ",
    "Give ",
    "Describe ",
    "Explain ",
    "Check ",
    "Spacing ",
    "Try ",
  ];
  return !ACTION_PREFIXES.some((prefix) => note.startsWith(prefix));
}
