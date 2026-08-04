// ---------------------------------------------------------------------------
// Building journey — guided homepage checklist (Phase N, spec §11)
//
// Completion is derived from REAL project state (visible sections + session
// flags for preview/export). No project fields are added for checklist state;
// dismissed/collapsed state lives in UI prefs. Deterministic, no mutation.
// ---------------------------------------------------------------------------

import type {
  BuildingJourney,
  JourneyStep,
  JourneyStepId,
} from "../types";

export interface JourneySection {
  type: string;
  props: Record<string, unknown>;
}

export interface JourneyContext {
  pageTitle: string;
  /** Visible sections on the current page. */
  sections: JourneySection[];
  /** Session flags — set when the user previews mobile / exports. */
  hasPreviewedMobile: boolean;
  hasExported: boolean;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasType(sections: JourneySection[], type: string): boolean {
  return sections.some((s) => s.type === type);
}

function heroHeadline(sections: JourneySection[]): string {
  const hero = sections.find((s) => s.type === "hero");
  return hero ? asString(hero.props.headline) : "";
}

function featureDescriptions(sections: JourneySection[]): number {
  const features = sections.find((s) => s.type === "features");
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

function hasClearAction(sections: JourneySection[]): boolean {
  if (hasType(sections, "cta")) return true;
  const hero = sections.find((s) => s.type === "hero");
  if (
    hero &&
    hero.props.primaryCta &&
    typeof hero.props.primaryCta === "object"
  ) {
    return asString((hero.props.primaryCta as Record<string, unknown>).text).length > 0;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Steps — order matters for the checklist UI
// ---------------------------------------------------------------------------

export function getBuildingJourney(ctx: JourneyContext): BuildingJourney {
  const steps: JourneyStep[] = [
    {
      id: "main-message",
      label: "Choose your main message",
      helper: "The first thing visitors see when they open your homepage.",
      complete: heroHeadline(ctx.sections).length > 0,
    },
    {
      id: "offer",
      label: "Explain what you offer",
      helper: "Describe your products, services, or benefits.",
      complete: hasType(ctx.sections, "features"),
    },
    {
      id: "next-step",
      label: "Add a clear next step",
      helper: "Give visitors an action like Contact, Buy, or Book.",
      complete: hasClearAction(ctx.sections),
    },
    {
      id: "trust",
      label: "Build trust",
      helper: "Answer common questions or describe benefits in detail.",
      complete: hasType(ctx.sections, "faq") || featureDescriptions(ctx.sections) > 0,
    },
    {
      id: "contact",
      label: "Add contact information",
      helper: "Add a footer with contact details and links.",
      complete: hasType(ctx.sections, "footer"),
    },
    {
      id: "preview-mobile",
      label: "Check the mobile view",
      helper: "See how your homepage looks on a phone.",
      complete: ctx.hasPreviewedMobile,
    },
    {
      id: "export",
      label: "Export your site",
      helper: "Download your website as files you can host anywhere.",
      complete: ctx.hasExported,
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;

  return {
    pageTitle: ctx.pageTitle || "Homepage",
    steps,
    completedCount,
    total: steps.length,
  };
}

/** Map a journey step to the section type it relates to (or null). */
export function journeyStepSectionType(
  stepId: JourneyStepId,
): string | null {
  switch (stepId) {
    case "main-message":
      return "hero";
    case "offer":
      return "features";
    case "next-step":
      return "cta";
    case "trust":
      return "faq";
    case "contact":
      return "footer";
    default:
      return null;
  }
}
