// ---------------------------------------------------------------------------
// Canvas alignment (Phase P22-B) — align + distribute as geometry mutations
//
// Alignment is expressed as REAL geometry mutations (update-geometry ops), so
// it participates in undo/redo through the normal store boundary. Multi-select
// alignment is relative to the selection's bounding box; distribution spaces
// the selected elements evenly along the dominant axis.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementGeometry, ElementTree } from "@/features/elements/types";
import type { ElementOperation } from "@/features/elements/engine/element-operations";
import { boundingBox, type ElementRect } from "./geometry";
import { buildGeometryOps } from "./transform";

export type AlignMode =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "middle-v"
  | "bottom";

export type DistributeAxis = "horizontal" | "vertical";

/** Compute the aligned rect for a single rect within the group's bounds. */
export function alignRect(
  rect: ElementRect,
  mode: AlignMode,
  bounds: ElementRect,
): ElementRect {
  switch (mode) {
    case "left":
      return { ...rect, x: bounds.x };
    case "center-h":
      return { ...rect, x: bounds.x + (bounds.width - rect.width) / 2 };
    case "right":
      return { ...rect, x: bounds.x + bounds.width - rect.width };
    case "top":
      return { ...rect, y: bounds.y };
    case "middle-v":
      return { ...rect, y: bounds.y + (bounds.height - rect.height) / 2 };
    case "bottom":
      return { ...rect, y: bounds.y + bounds.height - rect.height };
  }
}

/** Align every rect within the selection bounds (the group stays put). */
export function alignRects(rects: ElementRect[], mode: AlignMode): ElementRect[] {
  const bounds = boundingBox(rects);
  return rects.map((rect) => alignRect(rect, mode, bounds));
}

/**
 * Distribute rects evenly along an axis, keeping the FIRST and LAST elements
 * in place (the standard design-tool behavior). Returns the rects unchanged
 * when there are fewer than 3 elements.
 */
export function distributeRects(
  rects: ElementRect[],
  axis: DistributeAxis,
): ElementRect[] {
  if (rects.length < 3) return rects;
  const sorted = [...rects].sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span =
    axis === "horizontal"
      ? last.x + last.width - first.x
      : last.y + last.height - first.y;
  const totalGap = span - sorted.reduce((sum, r) => sum + (axis === "horizontal" ? r.width : r.height), 0);
  const gap = totalGap / (sorted.length - 1);

  const result: ElementRect[] = [];
  // The cursor tracks the trailing edge of the LAST PLACED element, so the
  // running gap stays exact even when source rects overlap — the previous
  // element's ORIGINAL position must never be reused after it was moved.
  let cursor =
    axis === "horizontal" ? first.x + first.width : first.y + first.height;
  for (let i = 0; i < sorted.length; i += 1) {
    if (i === 0) {
      result.push(sorted[i]);
      continue;
    }
    const start = cursor + gap;
    const next =
      axis === "horizontal"
        ? { ...sorted[i], x: start }
        : { ...sorted[i], y: start };
    result.push(next);
    cursor = start + (axis === "horizontal" ? next.width : next.height);
  }
  return result;
}

/** Build the update-geometry ops that align the selected elements. */
export function buildAlignOps(
  tree: ElementTree,
  elementIds: string[],
  rects: Record<string, ElementRect>,
  mode: AlignMode,
): ElementOperation[] {
  const aligned = alignRects(
    elementIds.map((id) => rects[id]).filter(Boolean),
    mode,
  );
  const geometry: Record<string, Partial<ElementGeometry>> = {};
  elementIds.forEach((id, index) => {
    const next = aligned[index];
    if (!next) return;
    geometry[id] = { mode: "absolute", x: next.x, y: next.y };
  });
  return buildGeometryOps(tree, geometry);
}

/** Build the update-geometry ops that distribute the selected elements. */
export function buildDistributeOps(
  tree: ElementTree,
  elementIds: string[],
  rects: Record<string, ElementRect>,
  axis: DistributeAxis,
): ElementOperation[] {
  const distributed = distributeRects(
    elementIds.map((id) => rects[id]).filter(Boolean),
    axis,
  );
  const geometry: Record<string, Partial<ElementGeometry>> = {};
  elementIds.forEach((id, index) => {
    const next = distributed[index];
    if (!next) return;
    if (axis === "horizontal") {
      geometry[id] = { mode: "absolute", x: next.x };
    } else {
      geometry[id] = { mode: "absolute", y: next.y };
    }
  });
  return buildGeometryOps(tree, geometry);
}
