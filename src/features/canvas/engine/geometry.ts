// ---------------------------------------------------------------------------
// Canvas geometry (Phase P22-B) — pure, deterministic rect/rotation math
//
// The transform overlay, move/resize/rotate sessions, alignment, snapping and
// coordinate conversion all build on these primitives. No React, no DOM.
// Geometry is expressed in LOGICAL canvas units (pre-zoom); the caller
// converts screen deltas via coords.ts.
// ---------------------------------------------------------------------------

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Minimum logical size an element can be resized to. */
export const MIN_ELEMENT_SIZE = 4;

/** Resize handle identifiers (8 directions). */
export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

export const RESIZE_HANDLES: readonly ResizeHandle[] = [
  "nw", "n", "ne", "e", "se", "s", "sw", "w",
];

export interface RectOptions {
  minSize?: number;
  preserveAspect?: boolean;
}

/** Clamp a rect to the minimum size with a stable anchor (never negative). */
export function clampRect(
  rect: ElementRect,
  minSize: number = MIN_ELEMENT_SIZE,
): ElementRect {
  const width = Math.max(minSize, rect.width);
  const height = Math.max(minSize, rect.height);
  return { x: rect.x, y: rect.y, width, height };
}

/** Round a rect to a stable grid (0.5px) to avoid floating-point noise. */
export function roundRect(rect: ElementRect): ElementRect {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    x: round2(rect.x),
    y: round2(rect.y),
    width: round2(rect.width),
    height: round2(rect.height),
  };
}

export function translateRect(rect: ElementRect, dx: number, dy: number): ElementRect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/**
 * Resize a rect from one of the 8 handles by a pointer delta.
 * Handles anchored at the opposite edge keep that edge fixed; width/height
 * are clamped to minSize. With preserveAspect the aspect ratio of the ORIGINAL
 * rect is kept (driven by the dominant axis of the delta).
 */
export function resizeRect(
  rect: ElementRect,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  options: RectOptions = {},
): ElementRect {
  const minSize = options.minSize ?? MIN_ELEMENT_SIZE;
  let { x, y, width, height } = rect;

  const affectsLeft = handle.includes("w");
  const affectsTop = handle.includes("n");
  const affectsRight = handle.includes("e");
  const affectsBottom = handle.includes("s");

  if (affectsLeft) {
    width = width - deltaX;
    if (width >= minSize) x = x + deltaX;
    else width = minSize;
  } else if (affectsRight) {
    width = width + deltaX;
    if (width < minSize) width = minSize;
  }

  if (affectsTop) {
    height = height - deltaY;
    if (height >= minSize) y = y + deltaY;
    else height = minSize;
  } else if (affectsBottom) {
    height = height + deltaY;
    if (height < minSize) height = minSize;
  }

  let next = { x, y, width, height };

  if (options.preserveAspect && rect.width > 0 && rect.height > 0) {
    const aspect = rect.width / rect.height;
    // Drive by the dominant axis so both dimensions stay in sync.
    const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);
    if (horizontal) {
      next.height = next.width / aspect;
      if (affectsTop) next.y = y + height - next.height;
    } else {
      next.width = next.height * aspect;
      if (affectsLeft) next.x = x + width - next.width;
    }
    next = clampRect(next, minSize);
    // Re-clamp: aspect may have pushed the driven dimension below min.
    if (next.width < minSize) {
      next = { ...next, width: minSize, height: minSize / aspect };
      if (affectsLeft) next.x = x + width - next.width;
    }
    if (next.height < minSize) {
      next = { ...next, height: minSize, width: minSize * aspect };
      if (affectsTop) next.y = y + height - next.height;
    }
  }

  return roundRect(next);
}

/** Bounding box of a set of rects (empty set → zero rect at origin). */
export function boundingBox(rects: ElementRect[]): ElementRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectCenter(rect: ElementRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectsEqual(a: ElementRect, b: ElementRect, epsilon = 0.01): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.width - b.width) <= epsilon &&
    Math.abs(a.height - b.height) <= epsilon
  );
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/**
 * Normalize an angle to [-180, 180) — the canonical representation used by
 * the element geometry model. Never stores arbitrary float noise: values are
 * rounded to 0.1°.
 */
export function normalizeAngle(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  // Half-open range [-180, 180): +180 canonicalizes to -180.
  const normalized = wrapped >= 180 ? wrapped - 360 : wrapped;
  return Math.round(normalized * 10) / 10;
}

/** Snap an angle to the nearest multiple of `step` (0 = no snapping). */
export function snapAngle(degrees: number, step = 0): number {
  if (step <= 0) return normalizeAngle(degrees);
  const snapped = Math.round(degrees / step) * step;
  return normalizeAngle(snapped);
}

/** Angle (degrees) of a pointer around a center point. */
export function angleOfPoint(pointer: Point, center: Point): number {
  return normalizeAngle((Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90);
}

/** Distance between two points (used for rotate-session deltas). */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
