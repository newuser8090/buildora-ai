"use client";

// ---------------------------------------------------------------------------
// MyBlockPreview — read-only preview of a saved block tree
//
// Renders ONLY through the validated native BlockTree (BlockRenderer with
// editing disabled). Never executes original source, JSX, React functions,
// event handlers, scripts, or arbitrary HTML. Safe asset/link policy comes
// from BlockRenderer itself.
//
// Capped dimensions + reduced motion: the preview scales down and disables
// animations so cards stay cheap and calm.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { BlockTree } from "@/features/blocks/types";
import { BlockRenderer } from "@/features/blocks/render/BlockRenderer";

export interface MyBlockPreviewProps {
  tree: BlockTree;
  /** Height of the preview viewport (cards use ~112px, details taller). */
  height?: number;
  /** Cap how many nodes render (card previews stay cheap). */
  maxNodes?: number;
}

export function MyBlockPreview({
  tree,
  height = 112,
  maxNodes = 40,
}: MyBlockPreviewProps) {
  const previewTree = useMemo(() => {
    if (!tree || !tree.nodes) return tree;
    const ids = Object.keys(tree.nodes);
    if (ids.length <= maxNodes) return tree;
    // Cheap truncation for very large trees: keep the root + shallowest nodes
    // so cards never render the whole design. The cap is enforced node-by-node
    // (a single very wide root must not add every child in one pass).
    const kept = new Set<string>(tree.rootIds);
    const frontier = [...tree.rootIds];
    while (frontier.length > 0 && kept.size < maxNodes) {
      const id = frontier.shift() as string;
      const node = tree.nodes[id];
      if (!node) continue;
      for (const childId of node.children) {
        if (kept.has(childId)) continue;
        if (kept.size >= maxNodes) break;
        kept.add(childId);
        frontier.push(childId);
      }
    }
    const nodes: Record<string, BlockTree["nodes"][string]> = {};
    for (const [id, node] of Object.entries(tree.nodes)) {
      if (kept.has(id)) {
        nodes[id] = { ...node, children: node.children.filter((c) => kept.has(c)) };
      }
    }
    return { rootIds: [...tree.rootIds], nodes };
  }, [tree, maxNodes]);

  return (
    <div
      data-testid="my-block-preview"
      className="pointer-events-none overflow-hidden rounded-lg border border-border/60 bg-white"
      style={{
        height,
        transform: "scale(1)",
        transformOrigin: "top left",
      }}
      aria-hidden="true"
    >
      {/* Wrapper applies a subtle global scale so the preview fits the cap. */}
      <div className="h-full w-full overflow-hidden">
        {previewTree && previewTree.rootIds.length > 0 ? (
          <div className="origin-top-left [&_*]:!transition-none [&_*]:!animate-none">
            <BlockRenderer tree={previewTree} viewportWidth={360} editable={false} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">
            Empty block
          </div>
        )}
      </div>
    </div>
  );
}
