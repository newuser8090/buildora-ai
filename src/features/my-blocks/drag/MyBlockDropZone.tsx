"use client";

// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — canvas drop zone
//
// A droppable bar rendered ONLY while a My Block drag is active. Friendly
// labels ("Add here", "Add below this section", "Place inside this group").
// The payload carried in the droppable data is just placement coordinates —
// never the tree. Validity is computed against the live project at drop time
// by the canonical insertion path.
// ---------------------------------------------------------------------------

import { useDroppable } from "@dnd-kit/core";
import { ArrowDownToLine, CornerDownRight, Plus } from "lucide-react";
import type { MyBlockDropZonePayload } from "./drop-zone-utils";

function zoneId(zone: MyBlockDropZonePayload): string {
  return `myblock-drop-${zone.kind}-${zone.sectionId ?? zone.pageId}`;
}

export function MyBlockDropZone({ zone }: { zone: MyBlockDropZonePayload }) {
  const { setNodeRef, isOver } = useDroppable({
    id: zoneId(zone),
    data: { myBlockDropZone: zone },
  });

  const icon =
    zone.kind === "inside-custom-block" ? (
      <CornerDownRight className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
    );

  return (
    <div
      ref={setNodeRef}
      data-testid={`my-block-drop-zone-${zone.kind}${zone.sectionId ? `-${zone.sectionId}` : ""}`}
      data-drop-zone-active={isOver || undefined}
      className={`group/drop relative z-[6] my-1 flex h-8 items-center justify-center rounded-lg border-2 border-dashed transition-colors duration-150 ${
        isOver
          ? "border-accent bg-accent/15"
          : "border-accent/30 bg-accent/[0.04] hover:border-accent/60 hover:bg-accent/10"
      }`}
    >
      <span
        className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${
          isOver
            ? "text-accent"
            : "text-text-dim group-hover/drop:text-accent"
        }`}
      >
        {isOver ? <Plus className="h-3 w-3" aria-hidden="true" /> : icon}
        {zone.label}
      </span>
    </div>
  );
}
