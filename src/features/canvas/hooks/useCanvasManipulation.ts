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
import type { ElementGeometry, ElementTree } from "@/features/elements/types";
import { useCanvasInteractionStore } from "../store/canvas-interaction-store";
import type { Point, ResizeHandle, ElementRect } from "../engine/geometry";
import { compositeSelectionBox, translateRect } from "../engine/geometry";
import { clientToCanvas, type CanvasFrame } from "../engine/coords";
import {
  beginMove,
  beginResize,
  beginRotate,
  updateTransform,
  buildGeometryOps,
} from "../engine/transform";
import { applyElementOpBatch } from "../engine/batch";
import { buildLayerOps, type LayerAction } from "../engine/layering";
import {
  canvasSnapTargets,
  elementSnapTargetDescriptors,
  elementSnapTargets,
  snapGuideLines,
  snapRectToTargets,
  type SnapGuide,
  type SnapGuideMatch,
  type SnapOptions,
  type SnapTargetDescriptor,
} from "../engine/snap";
import {
  marqueeHitTest,
  marqueeRect,
  splitManipulable,
  topLevelSelection,
} from "../engine/selection";

/**
 * P27 Slice 2 (D3): resolve the raw selection into the ids a GESTURE may
 * manipulate — top-level of the set (a selected container absorbs its selected
 * descendants, so a child is never double-translated) minus locked elements
 * (the geometry engine rejects them; the gesture fails closed instead).
 * Pure.
 */
function resolveGestureIds(tree: ElementTree, ids: string[]): string[] {
  if (ids.length === 0) return [];
  return splitManipulable(tree, topLevelSelection(tree, ids)).manipulable;
}

/**
 * P27 Slice 3 (D5): compute the renderable guide lines for a snapped move.
 * A match against a SIBLING element's edge/center (provenance in the
 * descriptor lists) spans the dragged box and that sibling — the Figma-style
 * smart line; a match against a CANVAS frame edge/center spans the whole
 * canvas viewport (Canva-style). Pure.
 */
function buildMoveGuides(
  snappedBox: ElementRect,
  matches: readonly SnapGuideMatch[],
  draggedIds: readonly string[],
  measured: Record<string, ElementRect>,
  descriptors: { xTargets: SnapTargetDescriptor[]; yTargets: SnapTargetDescriptor[] },
  canvasSize: { width: number; height: number },
): SnapGuide[] {
  if (matches.length === 0) return [];
  const excluded = new Set(draggedIds);
  const others: ElementRect[] = [];
  for (const [id, rect] of Object.entries(measured)) {
    if (!excluded.has(id)) others.push(rect);
  }
  const lines: SnapGuide[] = [];
  for (const match of matches) {
    const pool = match.axis === "x" ? descriptors.xTargets : descriptors.yTargets;
    const fromSibling = pool.some((t) => Math.abs(t.value - match.value) < 0.01);
    lines.push(
      ...(fromSibling
        ? snapGuideLines(snappedBox, [match], others)
        : snapGuideLines(snappedBox, [match], [], canvasSize)),
    );
  }
  return lines;
}

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
  /**
   * P27 Slice 1 (OQ-1): called when a marquee ends with ZERO hits — the layer
   * falls back to its background-click behaviour (section-root selection).
   * Omitting it keeps the current selection untouched.
   */
  onMarqueeEmpty?: () => void;
}

export interface CanvasManipulationApi {
  handleMoveStart: (screenPoint: Point) => void;
  handleRotateStart: (screenPoint: Point) => void;
  handleResizeStart: (handle: ResizeHandle, screenPoint: Point) => void;
  /**
   * Pointer-down on the section/canvas background → marquee (P27 Slice 1).
   * `true` when the marquee started. The marquee DRIVES on window
   * pointermove/pointerup internally, so the caller only starts it; the live
   * rect is readable from the interaction store's `marquee` state.
   */
  handleMarqueeStart: (screenPoint: Point) => boolean;
  /** Nudge the current selection by (dx, dy) logical units. */
  nudge: (dx: number, dy: number) => void;
  /**
   * P28 Slice 1 (D1): reorder the selection among its own siblings —
   * "front" / "back" / "forward" / "backward". One commit, at most ONE
   * history entry.
   */
  layerAction: (action: LayerAction) => void;
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
    const tree = contextRef.current.tree();
    if (!tree) return;
    // P27 Slice 2 (D3): top-level + unlocked only, so a batch drag moves each
    // branch exactly once and never attempts a locked element.
    const ids = resolveGestureIds(tree, store.selection.ids);
    if (ids.length === 0) return;
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;
    const rects = contextRef.current.rects();
    const startRects: Record<string, ElementRect> = {};
    const startModes: Record<string, "flow" | "absolute" | undefined> = {};
    const startGeometry: Record<string, ElementGeometry | null> = {};
    for (const id of ids) {
      const rect = rects[id];
      if (rect) startRects[id] = rect;
      // D4/OQ-6: remember the geometry (mode + durable offset) at gesture
      // start so the commit patch respects it (flow elements offset their
      // durable x/y — never the measured rect, never a mode flip).
      const nodeGeometry = tree.nodes[id]?.geometry ?? null;
      startModes[id] = nodeGeometry?.mode;
      startGeometry[id] = nodeGeometry;
    }
    if (Object.keys(startRects).length === 0) return;
    store.beginSession(beginMove(ids, startRects, pointer, startModes, startGeometry));
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
    let guides: SnapGuide[] = [];

    // Snapping (move/resize): canvas edges/center + other elements' edges.
    if (session.kind !== "rotate") {
      const snap = contextRef.current.snap();
      if (snap.enabled && snap.threshold > 0) {
        const frame = contextRef.current.frame();
        if (frame) {
          const canvasSize = frameCanvasSize(frame);
          const { xTargets, yTargets } = canvasSnapTargets(canvasSize.width, canvasSize.height);
          const measured = contextRef.current.rects();
          const elementTargets = elementSnapTargets(measured, session.elementIds);
          const descriptors = elementSnapTargetDescriptors(measured, session.elementIds);
          const combinedX = [...xTargets, ...elementTargets.xTargets];
          const combinedY = [...yTargets, ...elementTargets.yTargets];

          if (session.kind === "move") {
            // P27 Slice 3 (D5/OQ-1c): the dragged set's COMPOSITE box is the
            // snap candidate during a move — the winning snap delta per axis
            // is applied to EVERY element identically (per-element matches
            // during multi-drag are explicitly out of scope). A
            // single-element session's composite box IS the element rect, so
            // single-drag snapping is unchanged.
            const startIds = session.elementIds.filter((id) => session.startRects[id]);
            if (startIds.length > 0) {
              const startBox = compositeSelectionBox(
                startIds.map((id) => session.startRects[id]),
              );
              const dx = pointer.x - session.pointerStart.x;
              const dy = pointer.y - session.pointerStart.y;
              const rawBox = translateRect(startBox, dx, dy);
              const snappedBox = snapRectToTargets(rawBox, combinedX, combinedY, snap);
              if (snappedBox.snapped) {
                const snapDx = snappedBox.rect.x - rawBox.x;
                const snapDy = snappedBox.rect.y - rawBox.y;
                rects = {};
                for (const id of startIds) {
                  rects[id] = translateRect(session.startRects[id], dx + snapDx, dy + snapDy);
                }
              }
              guides = buildMoveGuides(
                snappedBox.rect,
                snappedBox.guides,
                session.elementIds,
                measured,
                descriptors,
                canvasSize,
              );
            }
          } else {
            // Resize: per-rect snapping (unchanged P22-B behaviour). REQ-4
            // limits guide RENDERING to move sessions — none published here.
            const snappedRects: Record<string, ElementRect> = {};
            for (const [id, rect] of Object.entries(rects)) {
              snappedRects[id] = snapRectToTargets(rect, combinedX, combinedY, snap).rect;
            }
            rects = snappedRects;
          }
        }
      }
    }

    // ONE store write per frame: previews + guides together (D6).
    store.updateSession(rects, update.rotation, guides);
  }, [toCanvas]);

  const endSession = useCallback((_screenPoint: Point) => {
    const store = useCanvasInteractionStore.getState();
    const session = store.session;
    const preview = store.previewRects;
    if (!session) return;
    store.endSession();
    if (!preview) return;

    // A gesture that never moved anything (click without drag, or a snap that
    // settled back to the start) commits NOTHING — no geometry patch, no
    // materialization of modeless nodes, no history entry. P27 Slice 2.
    if (session.kind === "rotate") {
      if (store.previewRotation === 0) return;
    } else {
      const unchanged = session.elementIds.every((id) => {
        const rect = preview[id];
        const start = session.startRects[id];
        return (
          rect !== undefined &&
          start !== undefined &&
          Math.abs(rect.x - start.x) < 0.01 &&
          Math.abs(rect.y - start.y) < 0.01 &&
          Math.abs(rect.width - start.width) < 0.01 &&
          Math.abs(rect.height - start.height) < 0.01
        );
      });
      if (unchanged) return;
    }

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
        if (session.startModes?.[id] === "flow") {
          // P27 Slice 2 (D4/OQ-6): flow elements commit their DURABLE x/y
          // offset moved by the same delta the preview showed (snapping
          // included) — never the measured canvas rect, never a mode flip.
          const start = session.startGeometry?.[id];
          if (start) {
            geometry[id] = {
              x: (start.x ?? 0) + (rect.x - session.startRects[id].x),
              y: (start.y ?? 0) + (rect.y - session.startRects[id].y),
            };
          } else {
            geometry[id] = { x: rect.x, y: rect.y };
          }
        } else {
          // Position-only: a MOVE never rewrites size (P22-B materializes
          // absolute mode on the first real drag, unchanged).
          geometry[id] = { mode: "absolute", x: rect.x, y: rect.y };
        }
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

  // ---- Marquee (P27 Slice 1) — background drag → rect-intersection select ----
  //
  // The gesture is STARTED by the layer (background pointerdown, D1b) and then
  // DRIVES on window pointermove/pointerup, like the transform sessions. The
  // hit set is validated against the active section's tree (marqueeHitTest,
  // OQ-1 intersection model) and resolved to the top level of the set
  // (topLevelSelection), so no section root, foreign id or redundant nested
  // child can enter the selection.

  const handleMarqueeStart = useCallback((screenPoint: Point) => {
    const pointer = toCanvas(screenPoint);
    if (!pointer) return false;
    useCanvasInteractionStore.getState().beginMarquee(pointer);
    return true;
  }, [toCanvas]);

  const driveMarquee = useCallback((screenPoint: Point) => {
    const pointer = toCanvas(screenPoint);
    if (!pointer) return;
    useCanvasInteractionStore.getState().updateMarquee(pointer);
  }, [toCanvas]);

  const endMarquee = useCallback(() => {
    const store = useCanvasInteractionStore.getState();
    const marquee = store.marquee;
    if (!marquee) return;
    store.endMarquee();

    const tree = contextRef.current.tree();
    if (!tree) return;
    const hits = marqueeHitTest(
      tree,
      marqueeRect(marquee.start, marquee.current),
      contextRef.current.rects(),
    );
    if (hits.length === 0) {
      // OQ-1: an empty marquee defers to the layer's background behaviour
      // (section-root selection), never a stray element focus.
      contextRef.current.onMarqueeEmpty?.();
      return;
    }
    store.setSelection(topLevelSelection(tree, hits), {
      multi: false,
      anchorId: null,
    });
  }, []);

  // ---- Marquee drive (pointermove/pointerup on window while active) ----
  //
  // Like the transform sessions, the marquee is started by a pointerdown and
  // then driven by WINDOW-level events, so the pointer can leave the section
  // content mid-drag without ending the gesture.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (useCanvasInteractionStore.getState().marquee) {
        driveMarquee({ x: e.clientX, y: e.clientY });
      }
    };
    const onUp = () => endMarquee();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [driveMarquee, endMarquee]);

  // ---- Nudge (arrow keys) ----

  const nudge = useCallback((dx: number, dy: number) => {
    const store = useCanvasInteractionStore.getState();
    const tree = contextRef.current.tree();
    if (!tree) return;
    // P27 Slice 2 (D3): the same gesture resolution as pointer drags —
    // top-level + unlocked (a locked member would fail the whole batch).
    const ids = resolveGestureIds(tree, store.selection.ids);
    if (ids.length === 0) return;
    const rects = contextRef.current.rects();
    const geometry: Record<string, Partial<import("@/features/elements/types").ElementGeometry>> = {};
    for (const id of ids) {
      const rect = rects[id];
      if (!rect) continue;
      // D4/OQ-6: mode-aware — flow elements offset their DURABLE x/y (never
      // the measured rect, never a mode flip); absolute/modeless materialize
      // absolute (unchanged).
      if (tree.nodes[id]?.geometry?.mode === "flow") {
        const start = tree.nodes[id].geometry;
        geometry[id] = {
          x: Math.round(((start.x ?? 0) + dx) * 10) / 10,
          y: Math.round(((start.y ?? 0) + dy) * 10) / 10,
        };
      } else {
        geometry[id] = {
          mode: "absolute",
          x: Math.round((rect.x + dx) * 10) / 10,
          y: Math.round((rect.y + dy) * 10) / 10,
        };
      }
    }
    const ops = buildGeometryOps(tree, geometry);
    const result = applyElementOpBatch(tree, ops);
    if (result.ok && result.tree) {
      contextRef.current.commit(result.tree);
    }
  }, []);

  // ---- Layer ordering (P28 Slice 1, D1) ----

  /**
   * P28 Slice 1 (D1): reorder the selected elements among their own siblings
   * via the existing P22-B engine (`buildLayerOps`). The call site never
   * re-derives order — the engine's emission order is load-bearing for
   * sequential `move` op application. Root ids are skipped by the engine
   * itself (page-level section ordering owns the root surface); locked
   * elements are excluded (a locked member fails the batch — excluded up
   * front so a locked selection is a structured no-op); unknown/foreign ids
   * are dropped by `topLevelSelection`. The reordered tree is applied as ONE
   * batch and committed ONCE — exactly one history entry (no-op detection is
   * the commit boundary's own deep-equality contract).
   */
  const layerAction = useCallback((action: LayerAction) => {
    const store = useCanvasInteractionStore.getState();
    const tree = contextRef.current.tree();
    if (!tree) return;
    // Same gesture resolution as drags/nudge: top-level of the set + unlocked
    // (a locked member would fail the whole batch — fail closed instead).
    const ids = resolveGestureIds(tree, store.selection.ids);
    if (ids.length === 0) return;
    const ops = buildLayerOps(tree, ids, action);
    if (ops.length === 0) return;
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
    nudge,
    layerAction,
  };
}

/** Logical size of the canvas content area (for snap targets). */
function frameCanvasSize(frame: CanvasFrame): { width: number; height: number } {
  return { width: frame.width ?? 0, height: frame.height ?? 0 };
}
