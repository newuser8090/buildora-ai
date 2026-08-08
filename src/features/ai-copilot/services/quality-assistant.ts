// ---------------------------------------------------------------------------
// AI Copilot — quality assistant (Phase P10, spec §12)
//
// Bridges the deterministic launch-readiness engine (AUTHORITATIVE) with the
// Copilot (helper). The Copilot:
//   - explains findings in plain language
//   - never fabricates or alters the readiness score
//   - drafts content for findings that need it (site description, search
//     title) so the user can paste it into settings
//   - prepares EDIT PLANS only for findings the plan op-set can genuinely
//     fix (placeholder text, empty headings, empty pages, missing CTA,
//     repeated headings, page search metadata)
//
// The readiness engine is never mutated; it recomputes from project state.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { LaunchCheck } from "@/features/launch-readiness/types";
import type { CopilotScope } from "../types";

export type QualityFixKind = "explain-only" | "plan" | "draft-content";

export interface QualityFindingHelp {
  findingId: string;
  title: string;
  explanation: string;
  fixKind: QualityFixKind;
  /** Edit-plan instruction when fixKind === "plan". */
  planInstruction?: string;
  /** Scope the fix plan should run against. */
  planScope?: CopilotScope;
  /** Drafted content when fixKind === "draft-content". */
  draft?: string;
  /** Settings surface to open when fixKind === "draft-content". */
  openDialog?: "site-settings-basics" | "site-settings-search";
}

const MAX_DRAFT = 155;

/** Deterministic draft of a search description from real page copy. */
export function draftSiteDescription(project: Project): string {
  const candidate: string[] = [];
  for (const page of project.pages ?? []) {
    for (const section of page.sections) {
      if (!section.visible) continue;
      const props = section.props ?? {};
      for (const key of ["subheadline", "subtitle", "description"]) {
        const value = props[key];
        if (typeof value === "string" && value.trim().length > 40) {
          candidate.push(value.trim().replace(/\s+/g, " "));
        }
      }
      if (candidate.length >= 2) break;
    }
    if (candidate.length >= 2) break;
  }
  const body = candidate[0] ?? "A modern website built with Buildora.";
  const name = project.name?.split(" — ")[0]?.trim() || "This site";
  const full = `${name} — ${body}`;
  return full.length <= MAX_DRAFT ? full : `${full.slice(0, MAX_DRAFT - 1)}…`;
}

/** Deterministic draft of a search title from the project name. */
export function draftSiteTitle(project: Project): string {
  const name = project.name?.split(" — ")[0]?.trim() || "My website";
  return name.length <= 60 ? name : name.slice(0, 59);
}

// ---------------------------------------------------------------------------
// Fix-plan mapping (findings the plan op-set can genuinely fix)
// ---------------------------------------------------------------------------

function planForFinding(
  finding: LaunchCheck,
  project: Project,
): { instruction: string; scope: CopilotScope } | null {
  switch (finding.id) {
    case "placeholder-text":
      return {
        instruction:
          'Replace all placeholder text (for example "lorem ipsum" or "Your text here") with real, finished content that fits each section. Keep all links, prices, and asset references exactly the same.',
        scope: { type: "project" },
      };
    case "empty-headings":
      return {
        instruction:
          "Add a clear, distinct heading to every section that is missing one. Keep all links, prices, and asset references exactly the same.",
        scope: { type: "project" },
      };
    case "empty-pages": {
      const emptyPage = (project.pages ?? []).find(
        (p) => !p.sections.some((s) => s.visible !== false),
      );
      if (emptyPage) {
        return {
          instruction:
            "Add useful content sections to this empty page so visitors see a finished, on-topic page that matches the site's style.",
          scope: { type: "page", pageId: emptyPage.id },
        };
      }
      return {
        instruction:
          "Add useful content sections to every empty page so visitors see a finished, on-topic page that matches the site's style.",
        scope: { type: "project" },
      };
    }
    case "cta-exists":
      return {
        instruction:
          "Add a clear call-to-action section to this page with a short headline and one action-oriented button.",
        scope: { type: "page", pageId: (project.pages ?? [])[0]?.id ?? "" },
      };
    case "duplicate-headings":
      return {
        instruction:
          "Vary repeated headings so every section has its own distinct heading. Keep all links, prices, and asset references exactly the same.",
        scope: { type: "project" },
      };
    case "page-meta":
      return {
        instruction:
          "Set a search title and description for every page based on its content. Update page metadata only.",
        scope: { type: "project" },
      };
    case "seo-title":
      return null; // site settings field — not a plan op; drafted instead
    case "seo-description":
      return null;
    case "site-description":
      return null;
    case "site-name":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Build the plain-language help for a single deterministic finding.
 * Never touches the readiness engine or the score.
 */
export function explainFinding(
  finding: LaunchCheck,
  project: Project,
): QualityFindingHelp {
  const explanationLines = [finding.explanation];
  if (finding.suggestedAction && finding.suggestedAction !== "Nothing to do.") {
    explanationLines.push(finding.suggestedAction);
  }
  if (finding.affected) {
    explanationLines.push(`Affected: ${finding.affected}.`);
  }

  const plan = planForFinding(finding, project);
  // A page-scoped fix with an unresolved pageId (no pages in the project) is
  // not usable — treat it as explain-only rather than planning on nothing.
  const usablePlan =
    plan && (plan.scope.type !== "page" || plan.scope.pageId !== "") ? plan : null;

  if (usablePlan) {
    return {
      findingId: finding.id,
      title: finding.title,
      explanation: explanationLines.join("\n"),
      fixKind: "plan",
      planInstruction: usablePlan.instruction,
      planScope: usablePlan.scope,
    };
  }

  // Draft-content findings (site-level settings fields).
  if (finding.id === "site-description" || finding.id === "seo-description") {
    return {
      findingId: finding.id,
      title: finding.title,
      explanation: explanationLines.join("\n"),
      fixKind: "draft-content",
      draft: draftSiteDescription(project),
      openDialog: "site-settings-search",
    };
  }
  if (finding.id === "seo-title") {
    return {
      findingId: finding.id,
      title: finding.title,
      explanation: explanationLines.join("\n"),
      fixKind: "draft-content",
      draft: draftSiteTitle(project),
      openDialog: "site-settings-search",
    };
  }
  if (finding.id === "site-name") {
    return {
      findingId: finding.id,
      title: finding.title,
      explanation: explanationLines.join("\n"),
      fixKind: "draft-content",
      draft: project.name?.split(" — ")[0]?.trim() || "",
      openDialog: "site-settings-basics",
    };
  }

  return {
    findingId: finding.id,
    title: finding.title,
    explanation: explanationLines.join("\n"),
    fixKind: "explain-only",
  };
}

/** True when the finding is a hard failure (blocked from publishing). */
export function isBlockingFinding(finding: LaunchCheck): boolean {
  return finding.status === "fail" && finding.severity === "critical";
}

/**
 * A short honesty note appended to every quality answer: the score comes
 * from Buildora's deterministic checks, not from the Copilot.
 */
export const READINESS_AUTHORITY_NOTE =
  "The readiness score is calculated by Buildora's own checks from your site — I can't change it directly. Fixing the underlying issue updates it automatically.";
