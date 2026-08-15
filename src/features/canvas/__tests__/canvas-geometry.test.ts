// ---------------------------------------------------------------------------
// Canvas geometry + coordinates tests (Phase P22-B)
// Covers: min-size clamping, resize handles (corners + edges), aspect ratio,
// rotation normalization/snapping, and zoom-aware coordinate conversion
// (50% / 100% / 200%).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  boundingBox,
  clampRect,
  MIN_ELEMENT_SIZE,
  normalizeAngle,
  rectCenter,
  resizeRect,
  snapAngle,
  translateRect,
  type ElementRect,
} from "../engine/geometry";
import {
  clientToCanvas,
  clientDeltaToCanvas,
  logicalToScreen,
  zoomToScale,
} from "../engine/coords";

describe("clampRect / min size", () => {
  it("clamps below-minimum dimensions to the minimum", () => {
    const rect = clampRect({ x: 0, y: 0, width: 1, height: -3 });
    expect(rect.width).toBe(MIN_ELEMENT_SIZE);
    expect(rect.height).toBe(MIN_ELEMENT_SIZE);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
  });

  it("accepts a custom minimum", () => {
    expect(clampRect({ x: 0, y: 0, width: 0, height: 0 }, 12)).toEqual({
      x: 0, y: 0, width: 12, height: 12,
    });
  });

  it("never produces negative dimensions (invalid geometry protection)", () => {
    const result = resizeRect({ x: 10, y: 10, width: 30, height: 30 }, "nw", 1000, 1000);
    expect(result.width).toBeGreaterThanOrEqual(MIN_ELEMENT_SIZE);
    expect(result.height).toBeGreaterThanOrEqual(MIN_ELEMENT_SIZE);
  });
});

describe("resizeRect", () => {
  const base: ElementRect = { x: 100, y: 100, width: 200, height: 100 };

  it("se corner grows the box without moving the origin", () => {
    const next = resizeRect(base, "se", 20, 10);
    expect(next).toEqual({ x: 100, y: 100, width: 220, height: 110 });
  });

  it("nw corner shrinks and moves the origin", () => {
    const next = resizeRect(base, "nw", 10, 10);
    expect(next).toEqual({ x: 110, y: 110, width: 190, height: 90 });
  });

  it("e edge resizes width only", () => {
    const next = resizeRect(base, "e", -50, 99);
    expect(next.width).toBe(150);
    expect(next.height).toBe(100);
  });

  it("s edge resizes height only", () => {
    const next = resizeRect(base, "s", 99, -30);
    expect(next.width).toBe(200);
    expect(next.height).toBe(70);
  });

  it("preserves aspect ratio when requested", () => {
    const next = resizeRect(base, "se", 100, 100, { preserveAspect: true });
    expect(next.width / next.height).toBeCloseTo(2);
  });

  it("keeps the opposite edge anchored under aspect ratio", () => {
    const next = resizeRect(base, "nw", 50, 25, { preserveAspect: true });
    expect(next.x + next.width).toBeCloseTo(300);
    expect(next.y + next.height).toBeCloseTo(200);
  });
});

describe("rotation math", () => {
  it("normalizes angles into [-180, 180)", () => {
    expect(normalizeAngle(45)).toBe(45);
    expect(normalizeAngle(270)).toBe(-90);
    expect(normalizeAngle(-90)).toBe(-90);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(180)).toBe(-180);
    expect(normalizeAngle(0.12345)).toBe(0.1); // float noise rounded
  });

  it("snaps to useful angles (0/45/90) when requested", () => {
    expect(snapAngle(47, 45)).toBe(45);
    expect(snapAngle(88, 45)).toBe(90);
    expect(snapAngle(3, 0)).toBe(3); // free rotation
  });
});

describe("boundingBox / translate / center", () => {
  it("computes the union rect of a set", () => {
    const box = boundingBox([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 20, y: 5, width: 5, height: 30 },
    ]);
    expect(box).toEqual({ x: 0, y: 0, width: 25, height: 35 });
  });

  it("translates rects without changing dimensions", () => {
    expect(translateRect({ x: 1, y: 2, width: 3, height: 4 }, 10, -2)).toEqual({
      x: 11, y: 0, width: 3, height: 4,
    });
  });

  it("finds rect centers", () => {
    expect(rectCenter({ x: 0, y: 0, width: 100, height: 50 })).toEqual({ x: 50, y: 25 });
  });
});

describe("coordinate conversion (zoom-aware)", () => {
  const frame = (zoom: number) => ({
    left: 200,
    top: 150,
    width: 1440,
    height: 900,
    zoom,
    scrollLeft: 0,
    scrollTop: 0,
  });

  it("is identity at 100% zoom with no scroll", () => {
    const p = clientToCanvas(1200, 650, frame(100));
    expect(p.x).toBeCloseTo(1000);
    expect(p.y).toBeCloseTo(500);
  });

  it("scales correctly at 50% zoom", () => {
    const p = clientToCanvas(1200, 650, frame(50));
    expect(p.x).toBeCloseTo(2000);
    expect(p.y).toBeCloseTo(1000);
  });

  it("scales correctly at 200% zoom", () => {
    const p = clientToCanvas(1200, 650, frame(200));
    expect(p.x).toBeCloseTo(500);
    expect(p.y).toBeCloseTo(250);
  });

  it("accounts for scroll offsets", () => {
    const p = clientToCanvas(1200, 650, {
      ...frame(100),
      scrollLeft: 100,
      scrollTop: 50,
    });
    expect(p.x).toBeCloseTo(1100);
    expect(p.y).toBeCloseTo(550);
  });

  it("scroll offsets are exact regardless of device pixel ratio", () => {
    // clientX/Y, bounding rect and scroll offsets are all CSS px — a HiDPI
    // dpr must NOT shrink the scroll term (regression guard for coords.ts).
    for (const dpr of [1, 2, 3]) {
      const p = clientToCanvas(1200, 650, {
        ...frame(100),
        scrollLeft: 100,
        scrollTop: 50,
        dpr,
      });
      expect(p.x).toBeCloseTo(1100);
      expect(p.y).toBeCloseTo(550);
    }
    // Zoomed + scrolled + HiDPI together.
    const p = clientToCanvas(700, 400, {
      ...frame(50),
      scrollLeft: 120,
      scrollTop: 60,
      dpr: 2,
    });
    expect(p.x).toBeCloseTo((700 - 200) / 0.5 + 120);
    expect(p.y).toBeCloseTo((400 - 150) / 0.5 + 60);
  });

  it("converts deltas so the same logical movement happens at any zoom", () => {
    for (const zoom of [50, 100, 200]) {
      const delta = clientDeltaToCanvas(10, 20, zoom);
      expect(delta.x * (zoom / 100)).toBeCloseTo(10);
      expect(delta.y * (zoom / 100)).toBeCloseTo(20);
    }
  });

  it("converts logical lengths to screen space", () => {
    expect(logicalToScreen(10, 100)).toBe(10);
    expect(logicalToScreen(10, 200)).toBe(20);
    expect(logicalToScreen(10, 50)).toBe(5);
  });

  it("handles zero/invalid zoom defensively", () => {
    expect(zoomToScale(0)).toBe(0);
    const p = clientToCanvas(300, 300, { ...frame(100), zoom: 0 });
    expect(p.x).toBeCloseTo(100); // falls back to 100 zoom
  });
});
