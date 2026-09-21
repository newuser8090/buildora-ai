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
 * Resolve the single NESTED selected element id of a tree — the element
 * selection the inspector routes and targets on (Phase P24-C, decisions D2/D3).
 *
 * Rules (mirroring the manipulation layer's own convention):
 *   - the SECTION ROOT id is the section-level selection (the manipulation
 *     layer mirrors the selected section id into the selection), so it is NOT
 *     an element target — it resolves to null;
 *   - only EXACTLY ONE id resolves; a multi-selection is ambiguous and
 *     resolves to null (multi-element inspector routing is an open decision);
 *   - an id that does not belong to this tree resolves to null, so selections
 *     from another section can never leak a stale target.
 *
 * Pure and deterministic — callers fall through to their previous behaviour on
 * null, which is what makes this safe to consult from render paths.
 */
export function singleNestedSelectionId(
  tree: ElementTree,
  selectionIds: readonly string[],
): string | null {
  if (selectionIds.length !== 1) return null;
  const id = selectionIds[0];
  if (!id || tree.rootIds.includes(id)) return null;
  return tree.nodes[id] ? id : null;
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

// ---------------------------------------------------------------------------
// Marquee (Phase P27 Slice 1) — rect-intersection hit-testing
// ---------------------------------------------------------------------------

/**
 * True when any part of rect `a` overlaps rect `b` (OQ-1 resolution: the
 * INTERSECTION model — an element intersecting the marquee at all is
 * selected). Edge semantics are strict: rects that merely touch on an edge
 * do not intersect, so a marquee ending exactly on an element's boundary
 * does not select it.
 */
export function rectIntersects(a: ElementRect, b: ElementRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Normalize a marquee gesture (pointer origin + current corner) into a rect.
 * A drag in any direction yields a positive-width/height rect.
 */
export function marqueeRect(start: Point, current: Point): ElementRect {
  const x = Math.min(start.x, current.x);
  const y = Math.min(start.y, current.y);
  return {
    x,
    y,
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

/**
 * Marquee hit-test (Phase P27 Slice 1, decision D1 with OQ-1 resolved to the
 * intersection model): every selectable element whose rect overlaps the
 * marquee rect is selected.
 *
 * Rules:
 *   - a ZERO-AREA marquee (a click without drag) selects nothing — a plain
 *     click is not a marquee, which is what keeps the frozen background-click
 *     contract (the layer's section-root write stands) intact;
 *   - candidates are NESTED nodes of `tree` only — root ids are section-level
 *     and can never enter the result, which is what bounds a marquee to the
 *     active section (no cross-section leaks, REQ-1);
 *   - an id must exist in `tree.nodes`, so rects keyed by a foreign section's
 *     ids are ignored by construction;
 *   - hidden/invisible elements are skipped (isPointerSelectable); locked
 *     elements ARE selected (selectable per P22-B) — manipulation-time
 *     resolution excludes them from the gesture;
 *   - hits are returned in deterministic tree order.
 *
 * The result is the RAW hit set. Callers filter it through
 * `topLevelSelection` before writing a selection, so a nested child is never
 * redundantly selected alongside its container.
 *
 * Pure and deterministic — no stores, no DOM.
 */
export function marqueeHitTest(
  tree: ElementTree,
  marquee: ElementRect,
  rects: Record<string, ElementRect>,
): string[] {
  if (marquee.width <= 0 || marquee.height <= 0) return [];
  const hits: string[] = [];
  const roots = new Set(tree.rootIds);
  const walk = (id: string): void => {
    const node = tree.nodes[id];
    if (!node) return;
    if (!roots.has(id) && isPointerSelectable(node)) {
      const rect = rects[id];
      if (rect && rectIntersects(rect, marquee)) hits.push(id);
    }
    for (const childId of node.children) walk(childId);
  };
  for (const rootId of tree.rootIds) walk(rootId);
  return hits;
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
