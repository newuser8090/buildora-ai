// ---------------------------------------------------------------------------
// Canvas transform tests (Phase P22-B)
// Covers: move sessions, resize sessions (min size, aspect), rotate sessions
// (normalized angles, snapping), snapping, batch op application, and durable
// op construction (new ids / no shared references via related modules).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { createElement } from "@/features/elements/engine/element-operations";
import { updateElementGeometry } from "@/features/elements/engine/element-operations";
import type { ElementNode, ElementTree } from "@/features/elements/types";
import {
  beginMove,
  beginResize,
  beginRotate,
  buildGeometryOps,
  updateTransform,
} from "../engine/transform";
import { applyElementOpBatch } from "../engine/batch";
import {
  DEFAULT_SNAP_OPTIONS,
  canvasSnapTargets,
  elementSnapTargets,
  snapRectToTargets,
  snapValue,
} from "../engine/snap";
import { validateElementTree } from "@/features/elements/engine/element-validation";

function treeWith(root: ElementNode): ElementTree {
  return { rootIds: [root.id], nodes: { [root.id]: root } };
}

const RECT = { x: 100, y: 100, width: 200, height: 100 };
const P0 = { x: 100, y: 100 };

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

describe("move sessions", () => {
  it("translates the element by the pointer delta", () => {
    const session = beginMove(["a"], { a: RECT }, P0);
    const update = updateTransform(session, { x: 160, y: 140 });
    expect(update.rects.a).toEqual({ x: 160, y: 140, width: 200, height: 100 });
    expect(update.geometry.a).toMatchObject({ x: 160, y: 140 });
  });

  it("multi-move preserves relative positions", () => {
    const session = beginMove(
      ["a", "b"],
      { a: RECT, b: { x: 400, y: 100, width: 100, height: 100 } },
      P0,
    );
    const update = updateTransform(session, { x: 200, y: 200 });
    // Both rects translate by the same delta (100, 100) — spacing unchanged.
    expect(update.rects.a).toEqual({ x: 200, y: 200, width: 200, height: 100 });
    expect(update.rects.b).toEqual({ x: 500, y: 200, width: 100, height: 100 });
    expect(update.rects.b.x - update.rects.a.x).toBe(300);
  });

  it("produces one update-geometry op per element", () => {
    const tree = treeWith(createElement("container", { id: "a" }));
    const session = beginMove(["a"], { a: RECT }, P0);
    const update = updateTransform(session, { x: 200, y: 100 });
    const ops = buildGeometryOps(tree, update.geometry);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: "update-geometry", elementId: "a" });
  });
});

describe("resize sessions", () => {
  it("se handle grows from the origin", () => {
    const session = beginResize("a", RECT, P0, "se");
    const update = updateTransform(session, { x: 150, y: 130 });
    expect(update.rects.a).toEqual({ x: 100, y: 100, width: 250, height: 130 });
  });

  it("nw handle keeps the opposite corner anchored", () => {
    const session = beginResize("a", RECT, P0, "nw");
    const update = updateTransform(session, { x: 80, y: 90 });
    expect(update.rects.a).toEqual({ x: 80, y: 90, width: 220, height: 110 });
  });

  it("never produces negative or sub-minimum dimensions", () => {
    const session = beginResize("a", RECT, P0, "nw");
    const update = updateTransform(session, { x: 500, y: 500 });
    const rect = update.rects.a;
    expect(rect.width).toBeGreaterThanOrEqual(4);
    expect(rect.height).toBeGreaterThanOrEqual(4);
    // The min-size clamp wins over anchor preservation on extreme drags, but
    // the box must never cross its original opposite edge.
    expect(rect.x + rect.width).toBeLessThanOrEqual(300);
    expect(rect.y + rect.height).toBeLessThanOrEqual(200);
  });

  it("respects aspect ratio on corners", () => {
    const session = beginResize("a", RECT, P0, "se", true);
    const update = updateTransform(session, { x: 160, y: 100 });
    const rect = update.rects.a;
    expect(rect.width / rect.height).toBeCloseTo(2);
  });
});

describe("rotate sessions", () => {
  it("computes a normalized rotation around the box center", () => {
    // Start pointer directly ABOVE the center (0°); rotate clockwise to the
    // right of the center (90° in screen coords with y-down).
    const session = beginRotate(["a"], { a: RECT }, { x: 200, y: 50 });
    const update = updateTransform(session, { x: 400, y: 150 });
    expect(update.rotation).toBe(90);
    expect(update.geometry.a.rotation).toBe(90);
  });

  it("keeps rects stable while rotating (box stays centered)", () => {
    const session = beginRotate(["a"], { a: RECT }, { x: 200, y: 50 });
    const update = updateTransform(session, { x: 200, y: 400 });
    expect(update.rects.a).toEqual(RECT);
  });

  it("snaps to useful angles when requested", () => {
    const session = beginRotate(["a"], { a: RECT }, { x: 200, y: 50 }, 45);
    const update = updateTransform(session, { x: 250, y: 170 });
    expect(Math.abs(update.rotation) % 45).toBeCloseTo(0);
  });
});

describe("geometry op application", () => {
  it("merges over existing geometry and validates the result", () => {
    const root = createElement("container", { id: "a" });
    const withGeom = updateElementGeometry(treeWith(root), "a", { width: 200, zIndex: 5 });
    if (!withGeom.ok) return;
    const ops = buildGeometryOps(withGeom.value, {
      a: { mode: "absolute", x: 10, y: 20, width: 300, height: 150 },
    });
    const result = applyElementOpBatch(withGeom.value, ops);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.tree) return;
    const g = result.tree.nodes.a.geometry;
    expect(g).toMatchObject({ mode: "absolute", x: 10, y: 20, width: 300, height: 150, zIndex: 5 });
    expect(validateElementTree(result.tree).valid).toBe(true);
  });

  it("fails cleanly on unknown elements and does not commit", () => {
    const tree = treeWith(createElement("container", { id: "a" }));
    const ops = buildGeometryOps(tree, { nope: { x: 1 } });
    expect(ops).toHaveLength(0); // unknown ids are skipped at op build
    const result = applyElementOpBatch(tree, [{ kind: "delete", elementId: "nope" }]);
    expect(result.ok).toBe(false);
  });
});

describe("snapping", () => {
  it("snaps values within the threshold only", () => {
    expect(snapValue(103, [100], 8)).toBe(100);
    expect(snapValue(120, [100], 8)).toBe(120);
  });

  it("snaps rects to canvas edges and center", () => {
    const targets = canvasSnapTargets(1440, 900);
    // Right edge at 1436 → snaps to the canvas right edge (1440).
    const result = snapRectToTargets({ x: 1336, y: 0, width: 100, height: 50 }, targets.xTargets, targets.yTargets, DEFAULT_SNAP_OPTIONS);
    expect(result.snapped).toBe(true);
    expect(result.rect.x + result.rect.width).toBeCloseTo(1440);
  });

  it("snaps to nearby element edges/centers and excludes dragged ids", () => {
    const targets = elementSnapTargets(
      { a: { x: 100, y: 100, width: 100, height: 100 }, b: { x: 300, y: 100, width: 100, height: 100 } },
      ["b"],
    );
    // Only `a`'s edges are considered (b excluded).
    expect(targets.xTargets).toContain(100);
    expect(targets.xTargets).not.toContain(300);
  });

  it("disables snapping cleanly", () => {
    const result = snapRectToTargets(
      { x: 1436, y: 0, width: 100, height: 50 },
      [0, 720, 1440],
      [0, 450, 900],
      { ...DEFAULT_SNAP_OPTIONS, enabled: false },
    );
    expect(result.snapped).toBe(false);
    expect(result.rect.x).toBe(1436);
  });
});
