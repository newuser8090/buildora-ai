// ---------------------------------------------------------------------------
// Canvas snapping (Phase P22-B) — minimal extensible snap architecture
//
// Snapping is a pure, opt-in transform post-process: while dragging/resizing,
// the interaction layer calls snapRectToTargets with the current preview rect
// and a target list. Targets are built from the canvas frame edges/center and
// the OTHER elements' edges/centers (excluding the ones being dragged).
//
// The abstraction is extensible (any provider of SnapTarget works) and can be
// toggled on/off via SnapOptions — no geometry is ever written until the
// snapped value is committed.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementRect, Point } from "./geometry";

export type SnapTargetKind = "edge" | "center";

export interface SnapTarget {
  /** The snapped coordinate along one axis. */
  x?: number;
  y?: number;
  kind: SnapTargetKind;
}

export interface SnapOptions {
  enabled: boolean;
  /** Snap distance in logical px (0 disables). */
  threshold: number;
  /** Snap angle step in degrees for rotations (0 = free). */
  angleStep: number;
}

export const DEFAULT_SNAP_OPTIONS: SnapOptions = {
  enabled: true,
  threshold: 8,
  angleStep: 0,
};

export interface SnapResult {
  rect: ElementRect;
  /** True when any edge/center actually snapped. */
  snapped: boolean;
  /** The target that matched (for guide rendering later). */
  match?: { axis: "x" | "y"; value: number; kind: SnapTargetKind };
}

/**
 * Snap a single value to the nearest target within the threshold.
 * Returns the original value when nothing is close enough.
 */
export function snapValue(value: number, targets: number[], threshold: number): number {
  if (threshold <= 0 || targets.length === 0) return value;
  let best = value;
  let bestDist = threshold;
  for (const target of targets) {
    const dist = Math.abs(target - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  }
  return best;
}

/**
 * Snap a rect against x/y target lists. Each of the rect's left/center/right
 * (and top/center/bottom) is compared to its axis' targets; the closest within
 * threshold wins and translates the whole rect.
 */
export function snapRectToTargets(
  rect: ElementRect,
  xTargets: number[],
  yTargets: number[],
  options: SnapOptions = DEFAULT_SNAP_OPTIONS,
): SnapResult {
  if (!options.enabled || options.threshold <= 0) {
    return { rect, snapped: false };
  }
  const candidatesX = [rect.x, rect.x + rect.width / 2, rect.x + rect.width];
  const candidatesY = [rect.y, rect.y + rect.height / 2, rect.y + rect.height];

  let dx = 0;
  let match: SnapResult["match"];
  for (const candidate of candidatesX) {
    const snapped = snapValue(candidate, xTargets, options.threshold);
    const delta = snapped - candidate;
    // Only a candidate that ACTUALLY snapped (delta !== 0) can win; a later
    // candidate that stays put must never reset an earlier accumulated snap.
    if (delta !== 0 && (match === undefined || Math.abs(delta) < Math.abs(dx))) {
      dx = delta;
      match = { axis: "x", value: snapped, kind: "edge" };
    }
  }
  let dy = 0;
  for (const candidate of candidatesY) {
    const snapped = snapValue(candidate, yTargets, options.threshold);
    const delta = snapped - candidate;
    if (delta !== 0 && (match === undefined || Math.abs(delta) < Math.abs(dy))) {
      dy = delta;
      match = { axis: "y", value: snapped, kind: "edge" };
    }
  }

  const next: ElementRect = {
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width,
    height: rect.height,
  };
  return { rect: next, snapped: dx !== 0 || dy !== 0, match };
}

/** Build x/y snap targets from a canvas frame (edges + center). */
export function canvasSnapTargets(
  width: number,
  height: number,
): { xTargets: number[]; yTargets: number[] } {
  return {
    xTargets: [0, width / 2, width],
    yTargets: [0, height / 2, height],
  };
}

/**
 * Build snap targets from OTHER elements' rects (edges + centers), excluding
 * the ids currently being dragged. Deterministic order.
 */
export function elementSnapTargets(
  rects: Record<string, ElementRect>,
  excludeIds: string[],
): { xTargets: number[]; yTargets: number[] } {
  const xTargets: number[] = [];
  const yTargets: number[] = [];
  const excluded = new Set(excludeIds);
  for (const [id, rect] of Object.entries(rects)) {
    if (excluded.has(id)) continue;
    xTargets.push(rect.x, rect.x + rect.width / 2, rect.x + rect.width);
    yTargets.push(rect.y, rect.y + rect.height / 2, rect.y + rect.height);
  }
  return {
    xTargets: [...new Set(xTargets)].sort((a, b) => a - b),
    yTargets: [...new Set(yTargets)].sort((a, b) => a - b),
  };
}

/** Point helper for snap-aware move math. */
export function snapPoint(
  point: Point,
  xTargets: number[],
  yTargets: number[],
  threshold: number,
): Point {
  return {
    x: snapValue(point.x, xTargets, threshold),
    y: snapValue(point.y, yTargets, threshold),
  };
}
