// ---------------------------------------------------------------------------
// Stage 4 — mobile auto-stack presentation tests
//
// Covers the pure `mobileAutoStackCss` / `applyBlockPresentation` rules:
//   - horizontal siblings stack vertically at mobile widths (row/container),
//   - already-column layouts are untouched,
//   - grids collapse to mobile-friendly column counts,
//   - media/content clamp to max-width 100%,
//   - absolute overlays rejoin the flow on mobile,
//   - explicit user overrides at `viewport.mobile` ALWAYS win,
//   - desktop rendering is byte-for-byte unchanged.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BlockNode } from "@/features/blocks/types";
import type { ElementGeometry } from "@/features/elements/types";
import {
  applyBlockPresentation,
  mobileAutoStackCss,
} from "../block-presentation";
import type { ElementViewportStyles } from "@/features/elements/types";

/** BlockNode plus the Stage 4 extension fields the renderer folds in. */
type NodeFixture = Partial<BlockNode> & {
  id?: string;
  viewport?: ElementViewportStyles;
  geometry?: Partial<ElementGeometry>;
};

function node(overrides: NodeFixture): BlockNode {
  return {
    id: "n1",
    type: "row",
    children: [],
    props: {},
    style: {},
    responsive: {},
    ...overrides,
  } as BlockNode;
}

const MOBILE = 390;
const DESKTOP = 1440;

describe("mobileAutoStackCss", () => {
  it("stacks a horizontal row into a column at mobile width", () => {
    const css = mobileAutoStackCss(node({ type: "row" }), MOBILE, undefined);
    expect(css.flexDirection).toBe("column");
  });

  it("stacks container and stack layout types too", () => {
    for (const type of ["container", "stack"] as const) {
      const css = mobileAutoStackCss(node({ type }), MOBILE, undefined);
      expect(css.flexDirection).toBe("column");
    }
  });

  it("leaves an already-column layout untouched", () => {
    const css = mobileAutoStackCss(
      node({ type: "row", style: { flexDirection: "column" } }),
      MOBILE,
      undefined,
    );
    expect(css.flexDirection).toBeUndefined();
  });

  it("does nothing on desktop width", () => {
    const css = mobileAutoStackCss(node({ type: "row" }), DESKTOP, undefined);
    expect(css).toEqual({});
  });

  it("collapses a 3-column grid to 2 columns on mobile", () => {
    const css = mobileAutoStackCss(
      node({ type: "grid", props: { columns: 3 } }),
      MOBILE,
      undefined,
    );
    expect(css.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("collapses a 4-column grid to 2 columns", () => {
    const css = mobileAutoStackCss(
      node({ type: "grid", props: { columns: 4 } }),
      MOBILE,
      undefined,
    );
    expect(css.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });

  it("keeps 2-column grids at 2 and collapses the rest to 1", () => {
    const two = mobileAutoStackCss(
      node({ type: "grid", props: { columns: 2 } }),
      MOBILE,
      undefined,
    );
    expect(two.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    const one = mobileAutoStackCss(
      node({ type: "grid", props: { columns: 1 } }),
      MOBILE,
      undefined,
    );
    expect(one.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
  });

  it("clamps media to max-width 100%", () => {
    expect(mobileAutoStackCss(node({ type: "image" }), MOBILE, undefined).maxWidth).toBe("100%");
    expect(mobileAutoStackCss(node({ type: "video" }), MOBILE, undefined).maxWidth).toBe("100%");
  });

  it("emits nothing when the user overrode the same property on mobile", () => {
    const viewport = {
      mobile: { flexDirection: "row", maxWidth: "420px", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" },
    } as ElementViewportStyles;
    const row = mobileAutoStackCss(
      node({ type: "row" }),
      MOBILE,
      viewport,
    );
    expect(row.flexDirection).toBeUndefined();
    const grid = mobileAutoStackCss(
      node({ type: "grid", props: { columns: 3 } }),
      MOBILE,
      viewport,
    );
    expect(grid.gridTemplateColumns).toBeUndefined();
    const img = mobileAutoStackCss(node({ type: "image" }), MOBILE, viewport);
    expect(img.maxWidth).toBeUndefined();
  });
});

describe("applyBlockPresentation (Stage 4 integration)", () => {
  it("desktop output is unchanged for a plain row", () => {
    const base = { display: "flex", gap: "1rem" };
    const out = applyBlockPresentation(node({ style: base }), DESKTOP, { ...base });
    expect(out).toEqual(base);
  });

  it("folds the auto-stack after explicit viewport overrides", () => {
    const viewport = { mobile: { display: "none" } } as ElementViewportStyles;
    // `viewport` rides the node surface (renderer extension field).
    const withViewport = node({
      type: "row",
      style: { display: "flex" },
      viewport,
    });
    const out2 = applyBlockPresentation(withViewport, MOBILE, {});
    expect(out2.display).toBe("none");
    expect(out2.flexDirection).toBe("column");
  });

  it("re-flows absolute overlays into the flow on mobile", () => {
    const out = applyBlockPresentation(
      node({
        type: "heading",
        geometry: { mode: "absolute", x: 240, y: 120, width: 300 },
      }),
      MOBILE,
      {},
    );
    expect(out.position).toBe("relative");
    expect(out.left).toBeUndefined();
    expect(out.top).toBeUndefined();
  });

  it("keeps absolute positioning on desktop", () => {
    const out = applyBlockPresentation(
      node({
        type: "heading",
        geometry: { mode: "absolute", x: 240, y: 120 },
      }),
      DESKTOP,
      {},
    );
    expect(out.position).toBe("absolute");
    expect(out.left).toBe(240);
    expect(out.top).toBe(120);
  });

  it("base geometry width still wins on desktop, auto rules only on mobile", () => {
    const n = node({ type: "image", geometry: { width: 800 } });
    expect(applyBlockPresentation(n, DESKTOP, {}).width).toBe(800);
    const mobileOut = applyBlockPresentation(n, MOBILE, {});
    expect(mobileOut.maxWidth).toBe("100%");
  });
});
