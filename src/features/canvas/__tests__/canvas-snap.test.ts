// ---------------------------------------------------------------------------
// Canvas snap guides (Phase P27 Slice 3 — D5, REQ-4, REQ-7, REQ-11)
//
// Covers:
//   - `snapRectToTargets` guideline coordinates for LEFT / CENTER / RIGHT and
//     TOP / MIDDLE / BOTTOM alignments (axis + value + kind);
//   - BOTH axes surfacing matches simultaneously (the Slice 3 fix: an x-snap
//     no longer suppresses the y-match);
//   - `snapGuideLines` span math (sibling-linked span, canvas-viewport span);
//   - `elementSnapTargetDescriptors` provenance (sourceId / kind) and dedupe;
//   - threshold/disable semantics unchanged (8px, REQ-7).
//
// Pure-engine suite: no stores, no DOM.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  DEFAULT_SNAP_OPTIONS,
  canvasSnapTargets,
  elementSnapTargetDescriptors,
  elementSnapTargets,
  snapGuideLines,
  snapRectToTargets,
  snapValue,
} from "../engine/snap";
import type { ElementRect } from "../engine/geometry";

const RECT: ElementRect = { x: 100, y: 200, width: 80, height: 40 };

describe("snapRectToTargets guideline coordinates (D5)", () => {
  const canvas = canvasSnapTargets(1440, 900);

  it("LEFT edge: axis x, value = target x, kind edge", () => {
    // Drag so the left edge is 3px right of the canvas left (0) → snaps to 0.
    const result = snapRectToTargets({ ...RECT, x: 3 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.snapped).toBe(true);
    expect(result.match).toEqual({ axis: "x", value: 0, kind: "edge" });
    expect(result.guides).toContainEqual({ axis: "x", value: 0, kind: "edge" });
    expect(result.rect.x).toBe(0);
  });

  it("RIGHT edge: axis x, value = target x", () => {
    // Right edge at 1436 → snaps to canvas right (1440); left = 1440-80 = 1360.
    const result = snapRectToTargets({ ...RECT, x: 1356 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.match).toEqual({ axis: "x", value: 1440, kind: "edge" });
    expect(result.rect.x).toBeCloseTo(1360);
  });

  it("CENTER-X: axis x, value = target x, kind center", () => {
    // Center at 720±3 → snaps to canvas center (720); left = 720-40 = 680.
    const result = snapRectToTargets({ ...RECT, x: 683 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.match).toEqual({ axis: "x", value: 720, kind: "center" });
    expect(result.rect.x).toBeCloseTo(680);
  });

  it("TOP edge: axis y, value = target y", () => {
    const result = snapRectToTargets({ ...RECT, y: 2 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.match).toEqual({ axis: "y", value: 0, kind: "edge" });
    expect(result.rect.y).toBe(0);
  });

  it("BOTTOM edge: axis y, value = target y", () => {
    // Bottom at 897 → snaps to canvas bottom (900); top = 900-40 = 860.
    const result = snapRectToTargets({ ...RECT, y: 857 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.match).toEqual({ axis: "y", value: 900, kind: "edge" });
    expect(result.rect.y).toBeCloseTo(860);
  });

  it("MIDDLE-Y: axis y, value = target y, kind center", () => {
    // Center at 450±3 → snaps to canvas middle (450); top = 450-20 = 430.
    const result = snapRectToTargets({ ...RECT, y: 433 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.match).toEqual({ axis: "y", value: 450, kind: "center" });
    expect(result.rect.y).toBeCloseTo(430);
  });

  it("surfaces BOTH axes' matches simultaneously (x + y at once)", () => {
    // Left edge near 0 AND top edge near 0: both must be reported. (Before
    // Slice 3 the single shared `match` dropped one axis.)
    const result = snapRectToTargets({ x: 3, y: 2, width: 80, height: 40 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.guides).toHaveLength(2);
    expect(result.guides).toContainEqual({ axis: "x", value: 0, kind: "edge" });
    expect(result.guides).toContainEqual({ axis: "y", value: 0, kind: "edge" });
    expect(result.rect).toEqual({ x: 0, y: 0, width: 80, height: 40 });
    // Back-compat alias: the first (x-axis) match.
    expect(result.match).toEqual({ axis: "x", value: 0, kind: "edge" });
  });

  it("no guides when nothing is within the threshold", () => {
    const result = snapRectToTargets({ x: 500, y: 500, width: 80, height: 40 }, canvas.xTargets, canvas.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.snapped).toBe(false);
    expect(result.guides).toEqual([]);
    expect(result.match).toBeUndefined();
  });

  it("no guides when snapping is disabled (toggle hides guides, REQ-7)", () => {
    const result = snapRectToTargets(
      { x: 3, y: 2, width: 80, height: 40 },
      canvas.xTargets,
      canvas.yTargets,
      { ...DEFAULT_SNAP_OPTIONS, enabled: false },
    );
    expect(result.snapped).toBe(false);
    expect(result.guides).toEqual([]);
    expect(result.rect.x).toBe(3);
  });

  it("closest candidate per axis wins", () => {
    // Two candidate edges within threshold: the nearer target wins.
    const result = snapRectToTargets(
      { x: 97, y: 500, width: 80, height: 40 }, // left edge 97 → target 100 dist 3
      [100, 180],
      canvas.yTargets,
      DEFAULT_SNAP_OPTIONS,
    );
    expect(result.guides).toEqual([{ axis: "x", value: 100, kind: "edge" }]);
  });
});

describe("snapGuideLines span math (D5)", () => {
  it("spans the dragged rect and the aligned sibling (sibling smart line)", () => {
    // Dragged rect snapped with left edge at x=300; sibling's left edge also
    // at 300 but taller/farther down → the vertical line spans both.
    const dragged: ElementRect = { x: 300, y: 260, width: 120, height: 60 };
    const sibling: ElementRect = { x: 300, y: 300, width: 100, height: 40 };
    const lines = snapGuideLines(
      dragged,
      [{ axis: "x", value: 300, kind: "edge" }],
      [sibling],
    );
    expect(lines).toEqual([
      { axis: "x", value: 300, kind: "edge", spanStart: 260, spanEnd: 340 },
    ]);
  });

  it("spans the full canvas viewport when only a canvas frame target matched", () => {
    const dragged: ElementRect = { x: 680, y: 100, width: 80, height: 40 };
    const lines = snapGuideLines(
      dragged,
      [{ axis: "x", value: 720, kind: "center" }],
      [],
      { width: 1440, height: 900 },
    );
    // No sibling shares x=720 → the line covers the whole viewport height.
    expect(lines).toEqual([
      { axis: "x", value: 720, kind: "center", spanStart: 0, spanEnd: 900 },
    ]);
  });

  it("horizontal lines span X (top alignment across two siblings)", () => {
    const dragged: ElementRect = { x: 400, y: 200, width: 100, height: 50 };
    const left: ElementRect = { x: 100, y: 200, width: 80, height: 60 };
    const lines = snapGuideLines(dragged, [{ axis: "y", value: 200, kind: "edge" }], [left]);
    expect(lines).toEqual([
      { axis: "y", value: 200, kind: "edge", spanStart: 100, spanEnd: 500 },
    ]);
  });

  it("ignores siblings that do not share the aligned coordinate", () => {
    const dragged: ElementRect = { x: 300, y: 260, width: 120, height: 60 };
    const unrelated: ElementRect = { x: 900, y: 900, width: 50, height: 50 };
    const lines = snapGuideLines(
      dragged,
      [{ axis: "x", value: 300, kind: "edge" }],
      [unrelated],
    );
    expect(lines).toEqual([
      { axis: "x", value: 300, kind: "edge", spanStart: 260, spanEnd: 320 },
    ]);
  });

  it("returns no lines without matches", () => {
    expect(snapGuideLines(RECT, [], [])).toEqual([]);
  });
});

describe("elementSnapTargetDescriptors provenance (D5)", () => {
  it("tags every edge/center target with its source rect and kind", () => {
    const descriptors = elementSnapTargetDescriptors(
      {
        a: { x: 100, y: 100, width: 100, height: 50 },
        b: { x: 300, y: 200, width: 80, height: 40 },
      },
      [],
    );
    expect(descriptors.xTargets).toEqual([
      { value: 100, axis: "x", sourceId: "a", kind: "edge" },
      { value: 150, axis: "x", sourceId: "a", kind: "center" },
      { value: 200, axis: "x", sourceId: "a", kind: "edge" },
      { value: 300, axis: "x", sourceId: "b", kind: "edge" },
      { value: 340, axis: "x", sourceId: "b", kind: "center" },
      { value: 380, axis: "x", sourceId: "b", kind: "edge" },
    ]);
    expect(descriptors.yTargets).toEqual([
      { value: 100, axis: "y", sourceId: "a", kind: "edge" },
      { value: 125, axis: "y", sourceId: "a", kind: "center" },
      { value: 150, axis: "y", sourceId: "a", kind: "edge" },
      { value: 200, axis: "y", sourceId: "b", kind: "edge" },
      { value: 220, axis: "y", sourceId: "b", kind: "center" },
      { value: 240, axis: "y", sourceId: "b", kind: "edge" },
    ]);
  });

  it("excludes dragged ids (same rule as elementSnapTargets)", () => {
    const descriptors = elementSnapTargetDescriptors(
      { a: { x: 100, y: 100, width: 100, height: 50 }, b: { x: 300, y: 200, width: 80, height: 40 } },
      ["b"],
    );
    expect(descriptors.xTargets.every((t) => t.sourceId === "a")).toBe(true);
    expect(descriptors.yTargets.every((t) => t.sourceId === "a")).toBe(true);
    // Parity with the plain numeric target list.
    const plain = elementSnapTargets(
      { a: { x: 100, y: 100, width: 100, height: 50 }, b: { x: 300, y: 200, width: 80, height: 40 } },
      ["b"],
    );
    expect(descriptors.xTargets.map((t) => t.value)).toEqual(plain.xTargets);
  });

  it("collapses duplicate values to one descriptor (sorted, first source wins)", () => {
    const descriptors = elementSnapTargetDescriptors(
      {
        a: { x: 100, y: 0, width: 100, height: 50 }, // left edge 100
        b: { x: 100, y: 500, width: 80, height: 40 }, // left edge 100 (duplicate)
      },
      [],
    );
    const at100 = descriptors.xTargets.filter((t) => t.value === 100);
    expect(at100).toHaveLength(1);
    expect(at100[0]).toEqual({ value: 100, axis: "x", sourceId: "a", kind: "edge" });
  });
});

describe("snap threshold semantics unchanged (REQ-7)", () => {
  it("keeps the 8px default threshold", () => {
    expect(DEFAULT_SNAP_OPTIONS.threshold).toBe(8);
    expect(snapValue(103, [100], 8)).toBe(100);
    expect(snapValue(109, [100], 8)).toBe(109); // dist 9 > 8 → unsnapped
    expect(snapValue(107.999, [100], 8)).toBe(100);
  });
});
