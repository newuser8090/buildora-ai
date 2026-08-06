"use client";

// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — thumbnail renderer
//
// Read-only preview surface used by thumbnail generation. Renders ONLY the
// validated native BlockTree through BlockRenderer (editing disabled). Never
// executes pasted source, JSX, event handlers, scripts, or arbitrary HTML;
// the safe asset/link policy comes from BlockRenderer itself.
//
// Auto-fit: after layout, the tree is scaled to fit the 480×300 viewport so
// short and tall designs both produce a recognizable thumbnail. Animations
// and transitions are disabled deterministically.
// ---------------------------------------------------------------------------

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BlockTree } from "@/features/blocks/types";
import { BlockRenderer } from "@/features/blocks/render/BlockRenderer";
import {
  MY_BLOCK_THUMBNAIL_WIDTH,
  MY_BLOCK_THUMBNAIL_HEIGHT,
} from "./my-block-thumbnail-types";

export interface MyBlockThumbnailPreviewProps {
  tree: BlockTree;
  /** Cap how many nodes render (very large designs stay cheap). */
  maxNodes?: number;
}

/** Render the tree at the fixed source viewport width (no scale). */
function renderTreeAtViewport(tree: BlockTree) {
  return (
    <BlockRenderer
      tree={tree}
      viewportWidth={MY_BLOCK_THUMBNAIL_WIDTH}
      editable={false}
    />
  );
}

export function MyBlockThumbnailPreview({
  tree,
  maxNodes = 120,
}: MyBlockThumbnailPreviewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Measure the natural height of the rendered content and scale it to fit.
  // Runs before paint so the captured frame already has the final transform.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const height = el.scrollHeight;
    if (height > 0 && height > MY_BLOCK_THUMBNAIL_HEIGHT) {
      const fit = MY_BLOCK_THUMBNAIL_HEIGHT / height;
      setScale(Math.max(0.2, Math.min(1, fit)));
    } else {
      setScale(1);
    }
  }, [tree]);

  const previewTree = useMemoTruncated(tree, maxNodes);

  if (!previewTree || previewTree.rootIds.length === 0) {
    return (
      <div
        data-testid="my-block-thumbnail-preview"
        aria-hidden="true"
        style={{
          width: MY_BLOCK_THUMBNAIL_WIDTH,
          height: MY_BLOCK_THUMBNAIL_HEIGHT,
          background: "#ffffff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#a3a3a3",
          fontSize: 12,
          overflow: "hidden",
        }}
      >
        Empty block
      </div>
    );
  }

  return (
    <div
      data-testid="my-block-thumbnail-preview"
      aria-hidden="true"
      style={{
        width: MY_BLOCK_THUMBNAIL_WIDTH,
        height: MY_BLOCK_THUMBNAIL_HEIGHT,
        overflow: "hidden",
        background: "#ffffff",
        color: "#0a0a0a",
        fontFamily: "Geist, system-ui, sans-serif",
        fontSize: 16,
        lineHeight: 1.5,
        animation: "none",
        transition: "none",
      }}
    >
      <style>{`
        [data-testid="my-block-thumbnail-preview"] *,
        [data-testid="my-block-thumbnail-preview"] *::before,
        [data-testid="my-block-thumbnail-preview"] *::after {
          animation: none !important;
          animation-duration: 0s !important;
          transition: none !important;
          transition-duration: 0s !important;
        }
      `}</style>
      <div
        ref={contentRef}
        style={{
          width: MY_BLOCK_THUMBNAIL_WIDTH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {renderTreeAtViewport(previewTree)}
      </div>
    </div>
  );
}

/**
 * Bounded copy of a tree (cheap truncation for very large designs): keep the
 * root + shallowest nodes so a 400-node design never renders fully. useMemo
 * recomputes only when the tree reference changes — the renderer remounts per
 * tree anyway, so no extra cache is needed.
 */
function useMemoTruncated(tree: BlockTree, maxNodes: number): BlockTree | null {
  return useMemo(() => {
    if (!tree.nodes || Object.keys(tree.nodes).length <= maxNodes) {
      return tree;
    }
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
}
