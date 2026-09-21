// ---------------------------------------------------------------------------
// Canvas interaction store (Phase P22-B) — TRANSIENT UI state
//
// This store owns state that must NEVER be persisted or synchronized:
//   - the current selection (single/multi) over element ids
//   - the active drag session (move/resize/rotate preview) + preview rects
//   - the marquee (selection rectangle) in progress
//   - the ACTIVE snap guide lines (P27 Slice 3, D5/REQ-4) — rendered only
//     while a move session runs; cleared on end/cancel/reset
//   - the canvas clipboard buffer (serialized, sanitized payload)
//   - the snapping toggle
//
// Durable consequences are committed through the EDITOR store's existing
// boundary (withHistory/commitLocalProject) — never through this store.
// The store is intentionally thin: all logic lives in the pure engines.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { ElementRect, Point, ResizeHandle } from "../engine/geometry";
import type { TransformSession } from "../engine/transform";
import type { SnapGuide } from "../engine/snap";
import { DEFAULT_SNAP_OPTIONS } from "../engine/snap";
import { emptySelection, type SelectionState } from "../engine/selection";

export interface MarqueeState {
  /** Pointer origin and current corner (logical canvas units). */
  start: Point;
  current: Point;
}

export interface CanvasInteractionState {
  // ---- Selection (transient) ----
  selection: SelectionState;
  /** The anchor element id (used by marquee selection). */
  anchorId: string | null;

  // ---- Transform session (transient preview) ----
  session: TransformSession | null;
  /** Preview rects keyed by element id — drives the overlay during a drag. */
  previewRects: Record<string, ElementRect> | null;
  /** Rotated angle (deg) during a rotate session. */
  previewRotation: number;

  // ---- Marquee ----
  marquee: MarqueeState | null;

  /**
   * P27 Slice 3 (D5/REQ-4): the ACTIVE visual snap guide lines while a move
   * session runs. Pure render data (axis + coordinate + perpendicular span);
   * written by the gesture drive path, cleared on session end/cancel. Never
   * persisted, never history, never synchronized.
   */
  snapGuides: SnapGuide[];

  // ---- Clipboard (transient, sanitized payload) ----
  clipboard: string | null;

  // ---- Options ----
  snapEnabled: boolean;
  /** Live handles are only meaningful when geometry can be consumed/durable. */
  manipulationEnabled: boolean;

  // ---- Actions ----
  setSelection: (ids: string[], options?: { multi?: boolean; anchorId?: string | null }) => void;
  toggleSelect: (id: string) => void;
  addToSelection: (id: string) => void;
  clearSelection: () => void;

  beginSession: (session: TransformSession) => void;
  /**
   * P27 Slice 3 (D6): previews and the frame's active snap guides publish in
   * ONE store write — a single notification per animation frame. Pass
   * `guides` on every move-frame call (empty array when nothing snapped).
   */
  updateSession: (rects: Record<string, ElementRect>, rotation?: number, guides?: SnapGuide[]) => void;
  endSession: () => void;
  cancelSession: () => void;

  beginMarquee: (start: Point) => void;
  updateMarquee: (current: Point) => void;
  endMarquee: () => void;

  /** P27 Slice 3 (D5): publish the active guide lines during a move gesture. */
  setSnapGuides: (guides: SnapGuide[]) => void;

  setClipboard: (payloadJson: string | null) => void;

  setSnapEnabled: (enabled: boolean) => void;
  setManipulationEnabled: (enabled: boolean) => void;
  reset: () => void;
}

export const useCanvasInteractionStore = create<CanvasInteractionState>()((set) => ({
  selection: emptySelection(),
  anchorId: null,
  session: null,
  previewRects: null,
  previewRotation: 0,
  marquee: null,
  snapGuides: [],
  clipboard: null,
  snapEnabled: DEFAULT_SNAP_OPTIONS.enabled,
  manipulationEnabled: false,

  setSelection: (ids, options) =>
    set({
      selection: { ids: [...new Set(ids)], multi: options?.multi ?? false },
      anchorId: options?.anchorId ?? null,
      previewRects: null,
      previewRotation: 0,
    }),

  toggleSelect: (id) =>
    set((state) => ({ selection: toggleSelectionSafe(state.selection, id) })),

  addToSelection: (id) =>
    set((state) => ({ selection: addToSelectionSafe(state.selection, id) })),

  clearSelection: () =>
    set({ selection: emptySelection(), anchorId: null, marquee: null, previewRects: null, previewRotation: 0, snapGuides: [] }),

  beginSession: (session) =>
    set({ session, previewRects: null, previewRotation: 0, snapGuides: [] }),

  updateSession: (rects, rotation = 0, guides) =>
    set(guides ? { previewRects: rects, previewRotation: rotation, snapGuides: guides } : { previewRects: rects, previewRotation: rotation }),

  endSession: () =>
    set({ session: null, previewRects: null, previewRotation: 0, snapGuides: [] }),
  cancelSession: () =>
    set({ session: null, previewRects: null, previewRotation: 0, snapGuides: [] }),

  beginMarquee: (start) => set({ marquee: { start, current: start }, anchorId: null }),
  updateMarquee: (current) =>
    set((state) => (state.marquee ? { marquee: { ...state.marquee, current } } : {})),
  endMarquee: () => set({ marquee: null }),

  setSnapGuides: (guides) => set({ snapGuides: guides }),

  setClipboard: (payloadJson) => set({ clipboard: payloadJson }),
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setManipulationEnabled: (enabled) => set({ manipulationEnabled: enabled }),
  reset: () =>
    set({
      selection: emptySelection(),
      anchorId: null,
      session: null,
      previewRects: null,
      previewRotation: 0,
      marquee: null,
      snapGuides: [],
      clipboard: null,
      snapEnabled: DEFAULT_SNAP_OPTIONS.enabled,
      manipulationEnabled: false,
    }),
}));

// Local re-implementations so the store does not depend on engine internals
// beyond the types (keeps the store thin and trivially testable).
function toggleSelectionSafe(state: SelectionState, id: string): SelectionState {
  if (state.ids.includes(id)) {
    return { ids: state.ids.filter((existing) => existing !== id), multi: true };
  }
  return { ids: [...state.ids, id], multi: true };
}

function addToSelectionSafe(state: SelectionState, id: string): SelectionState {
  if (state.ids.includes(id)) return state;
  return { ids: [...state.ids, id], multi: true };
}

export type { ResizeHandle };
