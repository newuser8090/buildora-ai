// ---------------------------------------------------------------------------
// Canvas coordinates (Phase P22-B) — zoom/offset-aware conversion
//
// The editor canvas renders the page inside a viewport frame that is scaled
// with `transform: scale(zoom/100)`. Pointer coordinates must be converted
// from screen space to LOGICAL canvas units so that dragging produces the
// same logical movement at any zoom level.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { Point } from "./geometry";

/** The canvas frame's on-screen bounding rect (post-transform) + zoom + scroll. */
export interface CanvasFrame {
  /** getBoundingClientRect() of the scaled frame (screen coordinates). */
  left: number;
  top: number;
  /** Logical width/height of the content area (clientWidth/clientHeight). */
  width?: number;
  height?: number;
  /** Logical zoom percent (100 = 1x). */
  zoom: number;
  /** Scroll offset of the scrolling container inside the frame (logical px). */
  scrollLeft?: number;
  scrollTop?: number;
  /** Device pixel ratio (default 1). */
  dpr?: number;
}

export function zoomToScale(zoom: number): number {
  return zoom / 100;
}

/**
 * Convert a client (screen) point to logical canvas coordinates.
 *   logical = (client - frameOrigin) / scale + scroll
 * The frame's bounding rect is already scaled by the CSS transform, so
 * dividing by the scale yields logical units from the frame's content origin.
 */
export function clientToCanvas(
  clientX: number,
  clientY: number,
  frame: CanvasFrame,
): Point {
  const scale = zoomToScale(frame.zoom || 100);
  // Pointer clientX/Y, getBoundingClientRect() and scrollLeft/Top are ALL CSS
  // (logical) pixels — no DPR factor is applied anywhere. Dividing the scroll
  // term by DPR would halve it on HiDPI displays and shift coordinates while
  // the canvas is scrolled.
  return {
    x: (clientX - frame.left) / scale + (frame.scrollLeft ?? 0),
    y: (clientY - frame.top) / scale + (frame.scrollTop ?? 0),
  };
}

/** Convert a screen-space delta to a logical delta (zoom-aware). */
export function clientDeltaToCanvas(
  deltaX: number,
  deltaY: number,
  zoom: number,
): Point {
  const scale = zoomToScale(zoom || 100);
  return { x: deltaX / scale, y: deltaY / scale };
}

/** Round a canvas point to avoid float drift during drag sessions. */
export function roundCanvasPoint(point: Point): Point {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return { x: round2(point.x), y: round2(point.y) };
}

/**
 * The fraction of the frame occupied by one logical pixel at a zoom level —
 * used by the overlay to size handles correctly in screen space.
 */
export function logicalToScreen(length: number, zoom: number): number {
  return length * zoomToScale(zoom || 100);
}

/**
 * Clamp a zoom percentage into the editor's supported range.
 * The editor store accepts any zoom; this keeps the canvas layer sane.
 */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 100;
  return Math.min(300, Math.max(25, Math.round(zoom)));
}
