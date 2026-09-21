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
// Phase P27 Slice 3 (D5): the ACTIVE snap matches are exported as structured
// guide lines (SnapGuideMatch → SnapGuide with a perpendicular span) so the
// manipulation layer can render visual alignment lines while a gesture runs.
// Guides are pure data — the gesture layer decides where/if to render them.
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

/**
 * One active snap alignment (Phase P27 Slice 3, D5) — the raw coordinate match
 * produced while snapping. `axis: "x"` means a VERTICAL guide line drawn at
 * `value` (an x-coordinate match); `axis: "y"` means a HORIZONTAL line at
 * `value` (a y-coordinate match).
 */
export interface SnapGuideMatch {
  axis: "x" | "y";
  value: number;
  kind: SnapTargetKind;
}

/**
 * A renderable guide line: the match plus the span it should visually cover
 * along the PERPENDICULAR axis (from the dragged rect(s) to every sibling
 * aligned at the value, or across the whole canvas viewport for canvas
 * frame snaps). Computed by `snapGuideLines`.
 */
export interface SnapGuide extends SnapGuideMatch {
  spanStart: number;
  spanEnd: number;
}

export interface SnapResult {
  rect: ElementRect;
  /** True when any edge/center actually snapped. */
  snapped: boolean;
  /** First active match (back-compat alias of `guides[0]`). */
  match?: SnapGuideMatch;
  /**
   * P27 Slice 3: ALL active matches — one per axis that snapped (a rect can
   * align on x and y simultaneously). The visual guide input.
   */
  guides: SnapGuideMatch[];
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
    return { rect, snapped: false, guides: [] };
  }
  const candidatesX: Array<{ value: number; kind: SnapTargetKind }> = [
    { value: rect.x, kind: "edge" },
    { value: rect.x + rect.width / 2, kind: "center" },
    { value: rect.x + rect.width, kind: "edge" },
  ];
  const candidatesY: Array<{ value: number; kind: SnapTargetKind }> = [
    { value: rect.y, kind: "edge" },
    { value: rect.y + rect.height / 2, kind: "center" },
    { value: rect.y + rect.height, kind: "edge" },
  ];

  // P27 Slice 3: per-axis winners. The previous single `match` variable was
  // SHARED across the two loops, so an x-axis snap suppressed every y-axis
  // match (and only the last match survived). Both axes' active guides are
  // now collected — the closest candidate PER AXIS wins, and a candidate that
  // stays put (delta 0) can never reset an earlier accumulated snap.
  let dx = 0;
  let matchX: SnapGuideMatch | undefined;
  for (const candidate of candidatesX) {
    const snapped = snapValue(candidate.value, xTargets, options.threshold);
    const delta = snapped - candidate.value;
    if (delta !== 0 && (matchX === undefined || Math.abs(delta) < Math.abs(dx))) {
      dx = delta;
      matchX = { axis: "x", value: snapped, kind: candidate.kind };
    }
  }
  let dy = 0;
  let matchY: SnapGuideMatch | undefined;
  for (const candidate of candidatesY) {
    const snapped = snapValue(candidate.value, yTargets, options.threshold);
    const delta = snapped - candidate.value;
    if (delta !== 0 && (matchY === undefined || Math.abs(delta) < Math.abs(dy))) {
      dy = delta;
      matchY = { axis: "y", value: snapped, kind: candidate.kind };
    }
  }

  const guides: SnapGuideMatch[] = [matchX, matchY].filter(
    (m): m is SnapGuideMatch => m !== undefined,
  );

  const next: ElementRect = {
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width,
    height: rect.height,
  };
  return { rect: next, snapped: dx !== 0 || dy !== 0, match: guides[0], guides };
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

// ---------------------------------------------------------------------------
// Visual guide lines (Phase P27 Slice 3, D5) — pure guide-span math
// ---------------------------------------------------------------------------

/** A snap target with PROVENANCE: which rect (id) and which edge/center it came from. */
export interface SnapTargetDescriptor {
  value: number;
  axis: "x" | "y";
  /** The rect id this target derives from (a section container id for canvas frame targets). */
  sourceId: string;
  kind: SnapTargetKind;
}

/**
 * Build provenance-tagged snap targets from OTHER elements' rects (edges +
 * centers), excluding the ids currently being dragged. Deterministic order;
 * duplicate values collapse to the FIRST occurrence (sorted position wins).
 */
export function elementSnapTargetDescriptors(
  rects: Record<string, ElementRect>,
  excludeIds: string[],
): { xTargets: SnapTargetDescriptor[]; yTargets: SnapTargetDescriptor[] } {
  const xTargets: SnapTargetDescriptor[] = [];
  const yTargets: SnapTargetDescriptor[] = [];
  const excluded = new Set(excludeIds);
  for (const [id, rect] of Object.entries(rects)) {
    if (excluded.has(id)) continue;
    xTargets.push(
      { value: rect.x, axis: "x", sourceId: id, kind: "edge" },
      { value: rect.x + rect.width / 2, axis: "x", sourceId: id, kind: "center" },
      { value: rect.x + rect.width, axis: "x", sourceId: id, kind: "edge" },
    );
    yTargets.push(
      { value: rect.y, axis: "y", sourceId: id, kind: "edge" },
      { value: rect.y + rect.height / 2, axis: "y", sourceId: id, kind: "center" },
      { value: rect.y + rect.height, axis: "y", sourceId: id, kind: "edge" },
    );
  }
  return {
    xTargets: dedupeDescriptors(xTargets),
    yTargets: dedupeDescriptors(yTargets),
  };
}

function dedupeDescriptors(list: SnapTargetDescriptor[]): SnapTargetDescriptor[] {
  const sorted = [...list].sort((a, b) => a.value - b.value);
  const out: SnapTargetDescriptor[] = [];
  for (const d of sorted) {
    if (out.length === 0 || out[out.length - 1].value !== d.value) out.push(d);
  }
  return out;
}

/**
 * Compute the renderable guide LINES for one snapped rect: for each active
 * match, the guide line is drawn at `value` along the match axis, and spans
 * the perpendicular axis from the dragged rect's aligned edge/center to the
 * FARTHEST sibling rect (from `others`) that shares the aligned coordinate —
 * or across the full canvas viewport (`bounds`) when nothing else aligns
 * (canvas frame targets have no provenance rect). Guides always include the
 * dragged rect's extent, so the line visually touches what is being aligned.
 *
 * Pure and deterministic.
 */
export function snapGuideLines(
  snapped: ElementRect,
  guides: readonly SnapGuideMatch[],
  others: readonly ElementRect[] = [],
  bounds?: { width: number; height: number },
): SnapGuide[] {
  if (guides.length === 0) return [];
  const lines: SnapGuide[] = [];
  for (const guide of guides) {
    if (guide.axis === "x") {
      // A vertical line at `value`; spans Y from min to max across the dragged
      // rect and every sibling sharing the aligned x coordinate.
      let spanStart = Math.min(snapped.y, snapped.y + snapped.height);
      let spanEnd = Math.max(snapped.y, snapped.y + snapped.height);
      for (const other of others) {
        const xs = [other.x, other.x + other.width / 2, other.x + other.width];
        if (xs.some((x) => Math.abs(x - guide.value) < 0.01)) {
          spanStart = Math.min(spanStart, other.y);
          spanEnd = Math.max(spanEnd, other.y + other.height);
        }
      }
      if (bounds) {
        spanStart = Math.min(spanStart, 0);
        spanEnd = Math.max(spanEnd, bounds.height);
      }
      lines.push({ ...guide, spanStart, spanEnd });
    } else {
      // A horizontal line at `value`; spans X from min to max across the dragged
      // rect and every sibling sharing the aligned y coordinate.
      let spanStart = Math.min(snapped.x, snapped.x + snapped.width);
      let spanEnd = Math.max(snapped.x, snapped.x + snapped.width);
      for (const other of others) {
        const ys = [other.y, other.y + other.height / 2, other.y + other.height];
        if (ys.some((y) => Math.abs(y - guide.value) < 0.01)) {
          spanStart = Math.min(spanStart, other.x);
          spanEnd = Math.max(spanEnd, other.x + other.width);
        }
      }
      if (bounds) {
        spanStart = Math.min(spanStart, 0);
        spanEnd = Math.max(spanEnd, bounds.width);
      }
      lines.push({ ...guide, spanStart, spanEnd });
    }
  }
  return lines;
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
