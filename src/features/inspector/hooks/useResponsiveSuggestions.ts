"use client";

// ---------------------------------------------------------------------------
// useResponsiveSuggestions (Phase P22-F)
//
// Computes the rule-based responsive proposals for the selected section's
// element tree at the CURRENT viewport (tablet/mobile only — desktop shows
// none, matching the "Desktop is the base" mental model). Proposals are never
// auto-applied: the user Accepts (one atomic history entry folding the
// viewport override + recording the AI decision) or Dismisses (one entry
// recording the user rejection so it is never re-suggested).
// ---------------------------------------------------------------------------

import { useCallback, useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  proposeResponsiveDecisions,
  suppressResponsiveProposals,
  type ResponsiveProposal,
} from "@/features/elements/responsive/decisions";
import type { ResponsiveDecision } from "@/features/elements/responsive/types";
import type { ElementTree } from "@/features/elements/types";

/** Stable empty array — selector defaults must never allocate per render. */
const EMPTY_DECISIONS: ResponsiveDecision[] = [];

export interface ResponsiveSuggestionsApi {
  /** Proposals for the current breakpoint (tablet/mobile), user-filtered. */
  proposals: ResponsiveProposal[];
  /** Accept one proposal — apply + record, ONE atomic history entry. */
  acceptProposal: (proposal: ResponsiveProposal) => void;
  /** Dismiss one proposal — record the user rejection, never re-suggested. */
  dismissProposal: (proposal: ResponsiveProposal) => void;
}

export function useResponsiveSuggestions(
  pageId: string,
  sectionId: string,
  tree: ElementTree,
): ResponsiveSuggestionsApi {
  const viewport = useEditorStore((s) => s.viewport);
  const decisionsRaw = useEditorStore((s) => s.project.responsiveDecisions);
  // Stable reference (never a fresh array) so useSyncExternalStore does not
  // treat the store as changed on every render.
  const decisions = decisionsRaw ?? EMPTY_DECISIONS;
  const accept = useEditorStore((s) => s.acceptResponsiveDecision);
  const reject = useEditorStore((s) => s.rejectResponsiveDecision);

  const proposals = useMemo(() => {
    if (viewport !== "tablet" && viewport !== "mobile") return [];
    const raw = proposeResponsiveDecisions(tree, viewport);
    return suppressResponsiveProposals(raw, decisions);
  }, [tree, decisions, viewport]);

  const acceptProposal = useCallback(
    (proposal: ResponsiveProposal) => {
      const decision: ResponsiveDecision = {
        elementId: proposal.elementId,
        viewport: proposal.viewport,
        transformation: proposal.transformation,
        appliedBy: "ai",
        state: "applied",
        note: proposal.note,
      };
      accept(pageId, sectionId, decision);
    },
    [accept, pageId, sectionId],
  );

  const dismissProposal = useCallback(
    (proposal: ResponsiveProposal) => {
      const decision: ResponsiveDecision = {
        elementId: proposal.elementId,
        viewport: proposal.viewport,
        transformation: proposal.transformation,
        appliedBy: "user",
        state: "rejected",
        note: proposal.note,
      };
      reject(decision);
    },
    [reject],
  );

  return { proposals, acceptProposal, dismissProposal };
}
