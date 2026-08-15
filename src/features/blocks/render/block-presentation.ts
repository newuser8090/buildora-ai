// ---------------------------------------------------------------------------
// Block presentation (Phase P22-C) — geometry + viewport overrides on render
//
// BlockRenderer renders custom-block trees, whose nodes may carry the additive
// P22-A/P22-B/P22-C element metadata:
//   - `geometry`   (width/height/rotation/zIndex/absolute x/y) — written by
//                   the canvas manipulation layer and the universal inspector
//   - `viewport`   (tablet/mobile style overrides) — written by the
//                   universal inspector's responsive section
//
// This helper folds BOTH into the rendered CSS so the canvas, thumbnails, and
// export preview agree with what the inspector shows. Both surfaces are
// optional — nodes without them render exactly as before (additive change).
//
// Pure, deterministic. Unsafe values are dropped by the style-token converter.
// ---------------------------------------------------------------------------

import { viewportOverridesForWidth } from "@/features/elements/responsive/resolve";
import type { ElementGeometry, ElementViewportStyles } from "@/features/elements/types";
import type { BlockNode } from "../types";
import { styleTokensToCss, type CssStyle } from "./block-style-to-css";

/** Fold a node's geometry + viewport overrides into a CSS record. */
export function applyBlockPresentation(
  node: BlockNode,
  width: number,
  css: CssStyle,
): CssStyle {
  const out: CssStyle = { ...css };

  const viewport = (node as BlockNode & { viewport?: ElementViewportStyles }).viewport;
  const viewportOverrides = styleTokensToCss(viewportOverridesForWidth(viewport, width));
  Object.assign(out, viewportOverrides);

  const geometry = (node as BlockNode & { geometry?: ElementGeometry }).geometry;
  if (geometry) {
    if (typeof geometry.width === "number" && Number.isFinite(geometry.width)) {
      out.width = geometry.width;
    }
    if (typeof geometry.height === "number" && Number.isFinite(geometry.height)) {
      out.height = geometry.height;
    }
    if (typeof geometry.zIndex === "number") {
      out.zIndex = geometry.zIndex;
    }
    if (typeof geometry.rotation === "number" && geometry.rotation !== 0) {
      out.transform = `rotate(${geometry.rotation}deg)`;
    }
    if (geometry.mode === "absolute") {
      out.position = "absolute";
      if (typeof geometry.x === "number" && Number.isFinite(geometry.x)) {
        out.left = geometry.x;
      }
      if (typeof geometry.y === "number" && Number.isFinite(geometry.y)) {
        out.top = geometry.y;
      }
    }
  }

  return out;
}
