// ---------------------------------------------------------------------------
// Canvas layering (Phase P22-B) — z-order as scoped sibling reordering
//
// The element tree expresses z-order through CHILDREN ORDER within a parent
// (later = on top) and through rootIds order for roots. Layering is therefore
// a sibling-reorder operation, scoped to each selected element's parent. The
// tree is NEVER flattened: nested hierarchy is preserved exactly.
//
// Root-level reordering is intentionally NOT part of this engine — page-level
// section ordering already exists (moveSection/reorderSection in the editor
// store). Elements with no parent are skipped.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementTree } from "@/features/elements/types";
import type { ElementOperation } from "@/features/elements/engine/element-operations";
import { topLevelSelection } from "./selection";

export type LayerAction = "forward" | "backward" | "front" | "back";

/**
 * Reorder `order` so every selected id performs the action once, preserving
 * the RELATIVE order of the selected set. Deterministic and side-effect free.
 */
export function applyLayerAction(
  order: string[],
  ids: string[],
  action: LayerAction,
): string[] {
  const present = ids.filter((id) => order.includes(id));
  // "back" processes from the END of the array first; every other action
  // processes from the START — this preserves the selected set's RELATIVE
  // order (e.g. [a, c] brought to front stays [a, c] at the top).
  const targets = [...present].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return action === "back" ? ib - ia : ia - ib;
  });

  let next = [...order];
  for (const id of targets) {
    const current = next.indexOf(id);
    let target: number;
    switch (action) {
      case "front":
        target = next.length - 1;
        break;
      case "back":
        target = 0;
        break;
      case "forward":
        target = current === next.length - 1 ? current : current + 1;
        break;
      case "backward":
        target = current === 0 ? current : current - 1;
        break;
    }
    if (target === current) continue;
    next = next.filter((item) => item !== id);
    const insertAt = Math.max(0, Math.min(target, next.length));
    next.splice(insertAt, 0, id);
  }
  return next;
}

/**
 * Build the move ops that reorder selected elements within their own parents
 * (scoped — never flattens the tree). Root elements are skipped: page-level
 * section ordering already owns that surface.
 */
export function buildLayerOps(
  tree: ElementTree,
  ids: string[],
  action: LayerAction,
): ElementOperation[] {
  const topLevel = topLevelSelection(tree, ids);
  const ops: ElementOperation[] = [];

  // Group by parent so each parent's children are reordered independently.
  const groups = new Map<string | null, string[]>();
  for (const id of topLevel) {
    const parentId = tree.nodes[id]?.parentId ?? null;
    const key = parentId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(id);
  }

  for (const [parentId, groupIds] of groups) {
    if (parentId === null) continue; // root reordering is page-level
    const parent = tree.nodes[parentId];
    if (!parent) continue;
    const order = [...parent.children];
    const ordered = applyLayerAction(order, groupIds, action);
    // Emit order matters: the moves are applied SEQUENTIALLY, so each earlier
    // move shifts later targets' indices. Moving toward the END (front/
    // forward) must emit back-most targets first; moving toward the START
    // (back/backward) emits front-most targets first.
    const byNewIndex = [...groupIds].sort(
      (a, b) => ordered.indexOf(a) - ordered.indexOf(b),
    );
    const emitOrder =
      action === "front" || action === "forward"
        ? [...byNewIndex].reverse()
        : byNewIndex;
    for (const id of emitOrder) {
      const newIndex = ordered.indexOf(id);
      const currentIndex = order.indexOf(id);
      if (newIndex === -1 || newIndex === currentIndex) continue;
      ops.push({
        kind: "move",
        elementId: id,
        toParentId: parentId,
        toIndex: newIndex,
      });
    }
  }
  return ops;
}
