"use client";

// ---------------------------------------------------------------------------
// useCanvasManipulation (Phase P22-B) — pointer → session → durable commit
//
// The hook owns the TRANSIENT side of manipulation:
//   - converts client pointer coordinates to logical canvas units (zoom-aware)
//   - runs move / resize / rotate sessions through the pure engine
//   - publishes PREVIEW rects to the interaction store (no durable writes)
//   - on pointerup builds ONE batch of geometry ops, applies it to the current
//     element tree, and calls `commit(tree)` — the caller's normal store
//     boundary (one undo entry per gesture)
//
// All state lives in the transient canvas-interaction-store; durable geometry
// is committed through the editor store (commitElementTree) by the caller.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";
import type { ElementTree } from "@/features/elements/types";
import { useCanvasInteractionStore } from "../store/canvas-interaction-store";
import type { Point, ResizeHandle } from "../engine/geometry";
import { clientToCanvas, type CanvasFrame } from "../engine/coords";
import {
  beginMove,
  beginResize,
  beginRotate,
  updateTransform,
  buildGeometryOps,
} from "../engine/transform";
import { applyElementOpBatch } from "../engine/batch";
import {
  canvasSnapTargets,
  elementSnapTargets,
  snapRectToTargets,
  type SnapOptions,
} from "../engine/snap";
import type { ElementRect } from "../engine/geometry";

export interface ManipulationContext {
  /** The scroll container / canvas frame for coordinate conversion. */
  frame: () => CanvasFrame | null;
  /** The current element tree to mutate (materialized for the target). */
  tree: () => ElementTree | null;
  /** Measured rects for every selectable element (keyed by element id). */
  rects: () => Record<string, ElementRect>;
  /** Durable commit — called ONCE per gesture with the new tree. */
  commit: (tree: ElementTree) => void;
  /** Snap options (threshold / enabled / angle step). */
  snap: () => SnapOptions;
}

export interface CanvasManipulationApi {
  handleMoveStart: (screenPoint: Point) => void;
  handleRotateStart: (screenPoint: Point) => void;
  handleResizeStart: (handle: ResizeHandle, screenPoint: Point) => void;
  /** Pointer-down on empty canvas → marquee. Returns true when started. */
  handleMarqueeStart: (screenPoint: Point) => boolean;
  handleMarqueeMove: (screenPoint: Point) => void;
  handleMarqueeEnd: (screenPoint: Point) => void;
  /** Nudge the current selection by (dx, dy) logical units. */
  nudge: (dx: number, dy: number) => void;
}

export function useCanvasManipulation(context: ManipulationContext): CanvasManipulationApi {
  // Latest-value ref: updated in an effect (never during render) so pointer
  // callbacks always see the freshest context.
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  });

  const toCanvas = useCallback((screen: Point): Point | null => {
    const frame = contextRef.current.frame();
    if (!frame) return null;
    return clientToCanvas(screen.x, screen.y, frame);
  }, []);

  const handleMoveStart = useCallback((screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const ids = store.selection.ids;
    if (ids.length === 0) return;
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;
    const rects = contextRef.current.rects();
    const startRects: Record<string, ElementRect> = {};
    for (const id of ids) {
      const rect = rects[id];
      if (rect) startRects[id] = rect;
    }
    if (Object.keys(startRects).length === 0) return;
    store.beginSession(beginMove(ids, startRects, pointer));
  }, [toCanvas]);

  const handleResizeStart = useCallback((handle: ResizeHandle, screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const id = store.selection.ids[0];
    if (!id) return;
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;
    const rect = contextRef.current.rects()[id];
    if (!rect) return;
    const preserveAspect = false; // Shift handled by callers if needed later
    store.beginSession(beginResize(id, rect, pointer, handle, preserveAspect));
  }, [toCanvas]);

  const handleRotateStart = useCallback((screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const ids = store.selection.ids;
    if (ids.length === 0) return;
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;
    const rects = contextRef.current.rects();
    const startRects: Record<string, ElementRect> = {};
    for (const id of ids) {
      const rect = rects[id];
      if (rect) startRects[id] = rect;
    }
    if (Object.keys(startRects).length === 0) return;
    const snap = contextRef.current.snap();
    store.beginSession(beginRotate(ids, startRects, pointer, snap.angleStep));
  }, [toCanvas]);

  // ---- Session drive (pointermove / pointerup on window while active) ----

  const driveSession = useCallback((screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const session = store.session;
    if (!session) return;
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;

    const update = updateTransform(session, pointer);
    let rects = update.rects;

    // Snapping (move/resize): canvas edges/center + other elements' edges.
    if (session.kind !== "rotate") {
      const snap = contextRef.current.snap();
      if (snap.enabled && snap.threshold > 0) {
        const frame = contextRef.current.frame();
        if (frame) {
          const canvasSize = frameCanvasSize(frame);
          const { xTargets, yTargets } = canvasSnapTargets(canvasSize.width, canvasSize.height);
          const elementTargets = elementSnapTargets(
            contextRef.current.rects(),
            session.elementIds,
          );
          const snappedRects: Record<string, ElementRect> = {};
          for (const [id, rect] of Object.entries(rects)) {
            const result = snapRectToTargets(rect, [...xTargets, ...elementTargets.xTargets], [...yTargets, ...elementTargets.yTargets], snap);
            snappedRects[id] = result.rect;
          }
          rects = snappedRects;
        }
      }
    }

    store.updateSession(rects, update.rotation);
  }, [toCanvas]);

  const endSession = useCallback((_screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const session = store.session;
    const preview = store.previewRects;
    if (!session) return;
    store.endSession();
    if (!preview) return;

    // Rebuild the geometry patch from the final preview rects so snapping is
    // honored exactly (the engine's last update was published as preview).
    const geometry: Record<string, Partial<import("@/features/elements/types").ElementGeometry>> = {};
    if (session.kind === "rotate") {
      const rotation = store.previewRotation;
      for (const id of session.elementIds) {
        geometry[id] = { mode: "absolute", rotation };
      }
    } else if (session.kind === "move") {
      for (const id of session.elementIds) {
        const rect = preview[id];
        if (!rect) continue;
        geometry[id] = { mode: "absolute", x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    } else {
      const id = session.elementIds[0];
      const rect = preview[id];
      if (rect) {
        geometry[id] = { mode: "absolute", x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }

    const tree = contextRef.current.tree();
    if (!tree) return;
    const ops = buildGeometryOps(tree, geometry);
    if (ops.length === 0) return;
    const result = applyElementOpBatch(tree, ops);
    if (result.ok && result.tree) {
      contextRef.current.commit(result.tree);
    }
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => driveSession({ x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => endSession({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [driveSession, endSession]);

  // ---- Marquee (selection rectangle) ----

  const handleMarqueeStart = useCallback((screenPoint: Point) => {
    const pointer = toCanvas(screenPoint);
    if (!pointer) return false;
    useCanvasInteractionStore.getState().beginMarquee(pointer);
    return true;
  }, [toCanvas]);

  const handleMarqueeMove = useCallback((screenPoint: Point) => {
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;
    useCanvasInteractionStore.getState().updateMarquee(pointer);
  }, [toCanvas]);

  const handleMarqueeEnd = useCallback((_screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const marquee = store.marquee;
    if (!marquee) return;
    store.endMarquee();
    const minX = Math.min(marquee.start.x, marquee.current.x);
    const maxX = Math.max(marquee.start.x, marquee.current.x);
    const minY = Math.min(marquee.start.y, marquee.current.y);
    const maxY = Math.max(marquee.start.y, marquee.current.y);
    const rects = contextRef.current.rects();
    const hit: string[] = [];
    for (const [id, rect] of Object.entries(rects)) {
      if (rect.x < maxX && rect.x + rect.width > minX && rect.y < maxY && rect.y + rect.height > minY) {
        hit.push(id);
      }
    }
    if (hit.length > 0) {
      store.setSelection(hit, { multi: true });
    }
  }, []);

  // ---- Nudge (arrow keys) ----

  const nudge = useCallback((dx: number, dy: number) => {
    const store = useCanvasInteractionStore.getState();
    const ids = store.selection.ids;
    if (ids.length === 0) return;
    const tree = contextRef.current.tree();
    const rects = contextRef.current.rects();
    if (!tree) return;
    const geometry: Record<string, Partial<import("@/features/elements/types").ElementGeometry>> = {};
    for (const id of ids) {
      const rect = rects[id];
      if (!rect) continue;
      geometry[id] = {
        mode: "absolute",
        x: Math.round((rect.x + dx) * 10) / 10,
        y: Math.round((rect.y + dy) * 10) / 10,
      };
    }
    const ops = buildGeometryOps(tree, geometry);
    const result = applyElementOpBatch(tree, ops);
    if (result.ok && result.tree) {
      contextRef.current.commit(result.tree);
    }
  }, []);

  return {
    handleMoveStart,
    handleRotateStart,
    handleResizeStart,
    handleMarqueeStart,
    handleMarqueeMove,
    handleMarqueeEnd,
    nudge,
  };
}

/** Logical size of the canvas content area (for snap targets). */
function frameCanvasSize(frame: CanvasFrame): { width: number; height: number } {
  return { width: frame.width ?? 0, height: frame.height ?? 0 };
}
