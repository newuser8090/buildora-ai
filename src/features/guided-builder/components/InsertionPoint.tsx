// ---------------------------------------------------------------------------
// InsertionPoint — "+ Add something here" between sections (Phase N, spec §8)
//
// Visual only until clicked — no project mutation on hover, no history on
// open. Clicking opens the block browser with the insertion position
// preselected ("after" the section above). Reduced-motion friendly.
// ---------------------------------------------------------------------------

"use client";

import { Plus } from "lucide-react";
import { useGuidedActions } from "../hooks/useGuidedActions";

export function InsertionPoint({
  afterSectionId,
}: {
  afterSectionId: string;
}) {
  const { browseBlocks } = useGuidedActions();

  return (
    <div
      data-testid={`insertion-point-${afterSectionId}`}
      className="relative z-[5] flex h-9 items-center justify-center"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          browseBlocks({ position: { type: "after", sectionId: afterSectionId } });
        }}
        aria-label={`Add a building block after this part`}
        className="group flex h-7 items-center gap-1.5 rounded-full border border-dashed border-border/70 bg-card/60 px-3 text-[11px] font-medium text-text-dim transition-all duration-200 hover:border-accent/50 hover:text-accent active:scale-95 motion-reduce:transition-none"
      >
        <Plus className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-90 motion-reduce:transition-none" />
        Add something here
      </button>
    </div>
  );
}
