// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — placement suggestions
//
// Deterministically suggests WHERE an import should go based on what the
// converter detected. Suggestions are never applied automatically.
//
// Priority (first match wins as the primary suggestion):
//   1. navbar present            → "top of the page"
//   2. pricing-card present      → before an existing FAQ section if present,
//                                  else end of page
//   3. footer present            → end of page
//   4. otherwise                 → end of page
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { ConversionReport } from "../conversion/conversion-report";
import type { ImportPlacement, ImportPlacementKind } from "./insert-imported-block-tree";
import { CUSTOM_BLOCK_SECTION_TYPE } from "../schemas/custom-block-schema";

export interface PlacementOption {
  id: string;
  kind: ImportPlacementKind;
  pageId: string;
  /** Target section for before/after/inside. */
  sectionId?: string;
  /** Target parent block for inside-custom-block. */
  parentBlockId?: string;
  label: string;
  detail: string;
  /** Deterministic suggestion reason (empty when not suggested). */
  suggestion?: string;
  primary?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export interface PlacementSuggestionsInput {
  project: Project;
  pageId: string;
  report: ConversionReport;
  /** Currently selected section (if any). */
  selectedSectionId?: string | null;
  /** Block browser insertion target (section + optional parent). */
  insertionTarget?: { sectionId?: string; parentBlockId?: string } | null;
}

/**
 * Build the ordered placement options for the Import Studio.
 * Deterministic: the suggested option is always first.
 */
export function suggestPlacements(input: PlacementSuggestionsInput): PlacementOption[] {
  const { project, pageId, report } = input;
  const page = project.pages.find((p) => p.id === pageId);
  const sections = page?.sections ?? [];

  const counts = report.blockTypeCounts ?? {};
  const hasNavbar = (counts.navbar ?? 0) > 0;
  const hasFooter = (counts.footer ?? 0) > 0;
  const hasPricing = (counts["pricing-card"] ?? 0) > 0;

  const faqSection = sections.find((s) => s.type === "faq");
  const selected = input.selectedSectionId
    ? sections.find((s) => s.id === input.selectedSectionId)
    : undefined;

  const customBlockSections = sections.filter((s) => s.type === CUSTOM_BLOCK_SECTION_TYPE);

  const options: PlacementOption[] = [];

  // ---- Suggested (primary) option ----
  let primary: PlacementOption;
  if (hasNavbar) {
    primary = {
      id: "primary-top",
      kind: "new-section",
      pageId,
      label: "At the top of this page",
      detail: "Add it as the first part of the page.",
      suggestion: "This looks like navigation. Add it at the top?",
      primary: true,
    };
  } else if (hasPricing && faqSection) {
    primary = {
      id: "primary-before-faq",
      kind: "before-section",
      pageId,
      sectionId: faqSection.id,
      label: "Before “Common questions”",
      detail: "Right before the questions section.",
      suggestion: "This looks like pricing. Add it before “Common questions”?",
      primary: true,
    };
  } else if (hasFooter) {
    primary = {
      id: "primary-end",
      kind: "new-section",
      pageId,
      label: "At the end of this page",
      detail: "Add it as the last part of the page.",
      suggestion: "This looks like bottom-of-page content. Add it at the end?",
      primary: true,
    };
  } else {
    primary = {
      id: "primary-end",
      kind: "new-section",
      pageId,
      label: "At the end of this page",
      detail: "Add it as a new part at the end of the page.",
      primary: true,
    };
  }
  options.push(primary);

  // ---- Selected-section placements ----
  if (selected) {
    options.push({
      id: "before-selected",
      kind: "before-section",
      pageId,
      sectionId: selected.id,
      label: "Before the selected part",
      detail: `Place it just before “${selected.type}”.`,
    });
    options.push({
      id: "after-selected",
      kind: "after-section",
      pageId,
      sectionId: selected.id,
      label: "After the selected part",
      detail: `Place it just after “${selected.type}”.`,
    });
  }

  // ---- Inside an existing imported design ----
  for (const section of customBlockSections.slice(0, 3)) {
    options.push({
      id: `inside-${section.id}`,
      kind: "inside-custom-block",
      pageId,
      sectionId: section.id,
      parentBlockId: input.insertionTarget?.sectionId === section.id
        ? (input.insertionTarget.parentBlockId ?? section.id)
        : section.id,
      label: "Inside an imported design",
      detail: `Add it inside “${section.props.name}”.`,
    });
  }

  // ---- Always offered ----
  options.push({
    id: "new-page",
    kind: "new-page",
    pageId,
    label: "On a new page",
    detail: "Create a new page and add this design to it.",
  });

  return options;
}

/** True when a placement references a target that still exists. */
export function isPlacementValid(
  project: Project,
  placement: ImportPlacement,
): { valid: boolean; reason?: string } {
  const page = project.pages.find((p) => p.id === placement.pageId);
  if (!page) return { valid: false, reason: "That page no longer exists." };
  if (
    (placement.kind === "before-section" || placement.kind === "after-section" || placement.kind === "inside-custom-block") &&
    placement.sectionId
  ) {
    const section = page.sections.find((s) => s.id === placement.sectionId);
    if (!section) return { valid: false, reason: "That part no longer exists." };
    if (placement.kind === "inside-custom-block" && section.type !== CUSTOM_BLOCK_SECTION_TYPE) {
      return {
        valid: false,
        reason: "This part uses a built-in layout, so imported blocks cannot be added inside it yet.",
      };
    }
  }
  return { valid: true };
}
