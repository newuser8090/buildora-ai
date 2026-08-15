"use client";

// ---------------------------------------------------------------------------
// ResponsiveSuggestions (Phase P22-F) — rule-based responsive intelligence UI
//
// Rendered inside the element inspector below the breakpoint context. Lists
// the current section tree's proposals at the active tablet/mobile viewport.
// NEVER auto-applies: Apply folds the viewport override + records the AI
// decision; Dismiss records the user rejection (never re-suggested).
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { elementRegistry } from "@/features/elements/registry/element-registry";
import type { ResponsiveProposal } from "@/features/elements/responsive/decisions";
import type { ElementTree } from "@/features/elements/types";

function proposalLabel(tree: ElementTree, proposal: ResponsiveProposal): string {
  const node = tree.nodes[proposal.elementId];
  const definition = node ? elementRegistry.get(node.type) : undefined;
  return definition?.label ?? node?.type ?? "Element";
}

export function ResponsiveSuggestions({
  tree,
  proposals,
  onApply,
  onDismiss,
}: {
  tree: ElementTree;
  proposals: ResponsiveProposal[];
  onApply: (proposal: ResponsiveProposal) => void;
  onDismiss: (proposal: ResponsiveProposal) => void;
}) {
  const viewportLabel = useMemo(() => {
    const viewport = proposals[0]?.viewport;
    return viewport === "mobile" ? "Mobile" : viewport === "tablet" ? "Tablet" : "This viewport";
  }, [proposals]);

  if (proposals.length === 0) return null;

  return (
    <div
      className="mx-5 mt-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2.5"
      data-testid="responsive-suggestions"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-accent">
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        Responsive suggestions · {viewportLabel}
      </div>
      <p className="mt-0.5 text-[10px] leading-snug text-text-dim">
        Suggested layouts for this viewport. Apply one, or dismiss it to keep your choice.
      </p>
      <ul className="mt-2 space-y-1.5">
        {proposals.map((proposal) => (
          <li
            key={`${proposal.elementId}-${proposal.transformation}`}
            data-testid={`responsive-suggestion-${proposal.elementId}`}
            className="flex items-center justify-between gap-2 rounded-md bg-card/60 px-2 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-text-primary">
                {proposalLabel(tree, proposal)}
              </p>
              <p className="truncate text-[10px] text-text-dim">{proposal.note}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                data-testid="responsive-apply"
                title={`Apply: ${proposal.note}`}
                onClick={() => onApply(proposal)}
                className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent-hover"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Apply suggestion</span>
              </button>
              <button
                type="button"
                data-testid="responsive-dismiss"
                title="Dismiss suggestion"
                onClick={() => onDismiss(proposal)}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card/40 text-text-muted transition-colors hover:border-accent/40 hover:text-text-primary"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Dismiss suggestion</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
