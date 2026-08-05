"use client";

// ---------------------------------------------------------------------------
// ImportVisualPreview — simplified visual preview of the converted design.
// Rendered ONLY from the native converted blocks (BlockRenderer) — the
// original pasted code is never executed, mounted, or stringified as HTML.
// ---------------------------------------------------------------------------

import { BlockRenderer } from "@/features/blocks/render/BlockRenderer";
import type { BlockTree } from "@/features/blocks/types";

export function ImportVisualPreview({
  tree,
  selectedBlockId,
  onSelectBlock,
  viewportWidth = 1280,
}: {
  tree: BlockTree;
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
  viewportWidth?: number;
}) {
  return (
    <div
      data-testid="import-visual-preview"
      className="overflow-hidden rounded-xl border border-border bg-white text-[#0a0a0a]"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide text-text-dim/60">
          Preview
        </span>
      </div>
      <div
        className="max-h-72 overflow-auto p-4"
        style={{
          fontFamily: "Geist, system-ui, sans-serif",
          fontSize: "16px",
          lineHeight: 1.5,
        }}
      >
        <BlockRenderer
          tree={tree}
          viewportWidth={viewportWidth}
          selectedBlockId={selectedBlockId}
          onSelectBlock={onSelectBlock}
        />
      </div>
    </div>
  );
}
