// ---------------------------------------------------------------------------
// Canvas transform (Phase P22-B) — move / resize / rotate sessions
//
// A drag session holds TRANSIENT interaction state (start rects, pointer
// origin, handle). Each pointermove computes a PREVIEW (cheap, no cloning);
// pointerup produces a single batch of geometry mutations that the caller
// commits through the normal store boundary (one undo entry per gesture).
//
// All deltas are in logical canvas units (see coords.ts). The session object
// itself lives in the transient interaction store — never in durable state.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementGeometry, ElementNode, ElementTree } from "@/features/elements/types";
import {
  applyElementOperation,
  type ElementOperation,
} from "@/features/elements/engine/element-operations";
import type { ElementRect, Point, ResizeHandle } from "./geometry";
import {
  MIN_ELEMENT_SIZE,
  boundingBox,
  normalizeAngle,
  rectCenter,
  resizeRect,
  snapAngle,
  translateRect,
} from "./geometry";

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export interface TransformSession {
  kind: "move" | "resize" | "rotate";
  /** Top-level element ids being manipulated (already resolved). */
  elementIds: string[];
  /** Start rects (logical units) captured at pointerdown. */
  startRects: Record<string, ElementRect>;
  /** Pointer position (logical units) at pointerdown. */
  pointerStart: Point;
  /** Resize-only: the active handle. */
  handle?: ResizeHandle;
  /** Resize-only: preserve aspect ratio (Shift). */
  preserveAspect?: boolean;
  /** Rotate-only: center of the selection bounding box. */
  rotateCenter?: Point;
  /** Rotate-only: angle snap step in degrees (0 = free). */
  rotateSnap?: number;
}

export interface TransformUpdate {
  /** Preview rects keyed by element id (for the overlay). */
  rects: Record<string, ElementRect>;
  /** Rotated angle in degrees for the selection box (rotate only). */
  rotation: number;
  /** Per-element geometry patch to commit on pointerup. */
  geometry: Record<string, Partial<ElementGeometry>>;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export function beginMove(
  elementIds: string[],
  startRects: Record<string, ElementRect>,
  pointer: Point,
): TransformSession {
  return { kind: "move", elementIds, startRects, pointerStart: pointer };
}

export function beginResize(
  elementId: string,
  startRect: ElementRect,
  pointer: Point,
  handle: ResizeHandle,
  preserveAspect = false,
): TransformSession {
  return {
    kind: "resize",
    elementIds: [elementId],
    startRects: { [elementId]: startRect },
    pointerStart: pointer,
    handle,
    preserveAspect,
  };
}

export function beginRotate(
  elementIds: string[],
  startRects: Record<string, ElementRect>,
  pointer: Point,
  rotateSnap = 0,
): TransformSession {
  const box = boundingBox(Object.values(startRects));
  return {
    kind: "rotate",
    elementIds,
    startRects,
    pointerStart: pointer,
    rotateCenter: rectCenter(box),
    rotateSnap,
  };
}

// ---------------------------------------------------------------------------
// Updates (called on every pointermove — must stay cheap, no tree cloning)
// ---------------------------------------------------------------------------

export function updateTransform(
  session: TransformSession,
  pointer: Point,
): TransformUpdate {
  if (session.kind === "move") {
    const dx = pointer.x - session.pointerStart.x;
    const dy = pointer.y - session.pointerStart.y;
    const rects: Record<string, ElementRect> = {};
    const geometry: Record<string, Partial<ElementGeometry>> = {};
    for (const id of session.elementIds) {
      const rect = translateRect(session.startRects[id], dx, dy);
      rects[id] = rect;
      geometry[id] = {
        mode: "absolute",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }
    return { rects, rotation: 0, geometry };
  }

  if (session.kind === "resize") {
    const id = session.elementIds[0];
    const start = session.startRects[id];
    const dx = pointer.x - session.pointerStart.x;
    const dy = pointer.y - session.pointerStart.y;
    const rect = resizeRect(start, session.handle ?? "se", dx, dy, {
      minSize: MIN_ELEMENT_SIZE,
      preserveAspect: session.preserveAspect,
    });
    return {
      rects: { [id]: rect },
      rotation: 0,
      geometry: {
        [id]: {
          mode: "absolute",
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y,
        },
      },
    };
  }

  // Rotate: keep the selection box centered; the angle drives the rotation.
  const center = session.rotateCenter ?? { x: 0, y: 0 };
  const start = session.pointerStart;
  const startAngle =
    (Math.atan2(start.y - center.y, start.x - center.x) * 180) / Math.PI;
  const currentAngle =
    (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI;
  const rotation = snapAngle(normalizeAngle(currentAngle - startAngle), session.rotateSnap ?? 0);
  const rects: Record<string, ElementRect> = { ...session.startRects };
  const geometry: Record<string, Partial<ElementGeometry>> = {};
  for (const id of session.elementIds) {
    geometry[id] = {
      mode: "absolute",
      rotation,
    };
  }
  return { rects, rotation, geometry };
}

// ---------------------------------------------------------------------------
// Commit (pointerup) — build ONE batch of immutable element operations
// ---------------------------------------------------------------------------

/**
 * Convert per-element geometry patches into update-geometry operations,
 * merging over each node's EXISTING geometry (never clobbering fields the
 * session did not touch, e.g. zIndex). The resulting ops are validated when
 * the caller applies the batch.
 */
export function buildGeometryOps(
  tree: ElementTree,
  geometry: Record<string, Partial<ElementGeometry>>,
): ElementOperation[] {
  const ops: ElementOperation[] = [];
  for (const [id, patch] of Object.entries(geometry)) {
    const node = tree.nodes[id];
    if (!node) continue;
    const existing = node.geometry ?? { mode: "absolute" };
    ops.push({
      kind: "update-geometry",
      elementId: id,
      // Spread order: session patch wins, then existing (never clobbers fields
      // the session did not touch, e.g. zIndex). `existing` always carries mode.
      geometry: {
        ...existing,
        ...patch,
      },
    });
  }
  return ops;
}

/** Convenience: apply geometry ops to a tree (validates via the engine). */
export function applyGeometryOps(
  tree: ElementTree,
  geometry: Record<string, Partial<ElementGeometry>>,
): { ok: boolean; tree?: ElementTree; error?: string } {
  const ops = buildGeometryOps(tree, geometry);
  let current: ElementTree = tree;
  for (const op of ops) {
    const result = applyElementOperation(current, op);
    if (!result.ok) return { ok: false, error: result.error.message };
    const value = result.value;
    if ("tree" in value) {
      current = value.tree;
    } else {
      current = value;
    }
  }
  return { ok: true, tree: current };
}

/** Minimal geometry read for a node (used by tests and preview math). */
export function geometryOf(node: ElementNode | undefined): ElementGeometry | null {
  return node?.geometry ?? null;
}
