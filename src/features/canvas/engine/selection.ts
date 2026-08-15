// ---------------------------------------------------------------------------
// Canvas selection (Phase P22-B) — pure selection state logic
//
// Selection is UI state (never persisted): the editor store keeps the durable
// project; this module decides WHICH elements are selected and keeps that set
// valid against the element tree.
//
// Rules:
//   - hidden (or invisible) elements cannot be selected by pointer
//   - locked elements MAY be selected but must be excluded from manipulation
//   - clicking a nested element selects the deepest hit (not its parent)
//   - multi-selection is additive; ancestor/descendant mixes are allowed for
//     display but manipulation always resolves to the top-level of the set
//   - selection self-cleans when elements disappear
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementNode, ElementTree } from "@/features/elements/types";
import type { ElementRect, Point } from "./geometry";

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

/** True when an element can be selected by pointer (not hidden/invisible). */
export function isPointerSelectable(node: ElementNode): boolean {
  return node.visible !== false && node.hidden !== true;
}

/** True when an element can be manipulated (not locked). */
export function isManipulable(node: ElementNode): boolean {
  return node.locked !== true;
}

/**
 * Hit-test a point against a tree. Returns the DEEPEST selectable element id
 * whose rect contains the point (children win over parents — clicking a child
 * never accidentally selects its parent). Locked elements are still selectable
 * (they just cannot be manipulated). Returns null on empty canvas.
 */
export function hitTestElement(
  tree: ElementTree,
  point: Point,
  rectOf: (id: string) => ElementRect | undefined,
): string | null {
  let best: string | null = null;
  let bestDepth = -1;

  const walk = (id: string, depth: number): void => {
    const node = tree.nodes[id];
    if (!node || !isPointerSelectable(node)) return;
    const rect = rectOf(id);
    if (rect && pointInRect(point, rect)) {
      if (depth > bestDepth) {
        best = id;
        bestDepth = depth;
      }
    }
    for (const childId of node.children) {
      walk(childId, depth + 1);
    }
  };

  for (const rootId of tree.rootIds) walk(rootId, 0);
  return best;
}

export function pointInRect(point: Point, rect: ElementRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

// ---------------------------------------------------------------------------
// Selection set operations
// ---------------------------------------------------------------------------

export interface SelectionState {
  /** Stable element ids, in selection order. */
  ids: string[];
  /** True when the most recent interaction extended (not replaced) selection. */
  multi: boolean;
}

export function emptySelection(): SelectionState {
  return { ids: [], multi: false };
}

/** Single-select (replaces the set). */
export function selectOnly(ids: string[]): SelectionState {
  return { ids: [...new Set(ids)], multi: false };
}

/** Modifier-click: toggle an id in/out of the set (preserving order). */
export function toggleSelection(state: SelectionState, id: string): SelectionState {
  if (state.ids.includes(id)) {
    return { ids: state.ids.filter((existing) => existing !== id), multi: true };
  }
  return { ids: [...state.ids, id], multi: true };
}

/** Add an id to the set (no-op when present). */
export function addToSelection(state: SelectionState, id: string): SelectionState {
  if (state.ids.includes(id)) return state;
  return { ids: [...state.ids, id], multi: state.multi };
}

export function removeFromSelection(state: SelectionState, id: string): SelectionState {
  return { ids: state.ids.filter((existing) => existing !== id), multi: state.multi };
}

/**
 * Drop ids that no longer exist in the tree (self-cleaning when elements are
 * deleted). Deterministic, preserves order.
 */
export function purgeSelection(tree: ElementTree, ids: string[]): string[] {
  return ids.filter((id) => tree.nodes[id] !== undefined);
}

/**
 * Resolve a multi-selection to the TOP-LEVEL of the set: ids whose ancestors
 * are ALSO selected are dropped, so a manipulation (move/delete/duplicate/
 * align) is applied exactly once per branch and never corrupts hierarchy.
 */
export function topLevelSelection(tree: ElementTree, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    const node = tree.nodes[id];
    if (!node) return false;
    // Walk up the parent chain: if any ancestor is selected, this is nested.
    let parentId = node.parentId;
    while (parentId) {
      if (set.has(parentId)) return false;
      parentId = tree.nodes[parentId]?.parentId ?? null;
    }
    return true;
  });
}

/** True when any selected element is locked (manipulation must be blocked). */
export function selectionHasLocked(tree: ElementTree, ids: string[]): boolean {
  return ids.some((id) => tree.nodes[id]?.locked === true);
}

/** Split a selection into [manipulable, locked] id lists. */
export function splitManipulable(
  tree: ElementTree,
  ids: string[],
): { manipulable: string[]; locked: string[] } {
  return {
    manipulable: ids.filter((id) => tree.nodes[id] && isManipulable(tree.nodes[id]!)),
    locked: ids.filter((id) => tree.nodes[id] && !isManipulable(tree.nodes[id]!)),
  };
}

/** Rect lookup map built from element geometry (fallback for measurement gaps). */
export function rectsFromGeometry(
  tree: ElementTree,
  ids: string[],
): Record<string, ElementRect> {
  const out: Record<string, ElementRect> = {};
  for (const id of ids) {
    const node = tree.nodes[id];
    const g = node?.geometry;
    if (g && typeof g.width === "number" && typeof g.height === "number") {
      out[id] = {
        x: g.x ?? 0,
        y: g.y ?? 0,
        width: g.width,
        height: g.height,
      };
    }
  }
  return out;
}
