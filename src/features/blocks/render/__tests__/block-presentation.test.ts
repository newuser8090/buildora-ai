// ---------------------------------------------------------------------------
// Block presentation tests (Phase P22-C)
// Covers: geometry folding (width/height/rotation/zIndex/absolute), viewport
// override resolution, additive behavior when geometry/viewport are absent.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BlockNode } from "../../types";
import type { ElementGeometry, ElementViewportStyles } from "@/features/elements/types";
import { applyBlockPresentation } from "../block-presentation";

function nodeWith(
  overrides: Partial<BlockNode> & {
    geometry?: ElementGeometry;
    viewport?: ElementViewportStyles;
  },
): BlockNode {
  return {
    id: "n1",
    type: "container",
    parentId: null,
    children: [],
    props: {},
    style: { padding: "1rem" },
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  } as BlockNode;
}

describe("applyBlockPresentation — geometry", () => {
  it("applies width/height/zIndex when present", () => {
    const css = applyBlockPresentation(
      nodeWith({ geometry: { mode: "flow", width: 320, height: 120, zIndex: 5 } }),
      1440,
      { padding: "1rem" },
    );
    expect(css.width).toBe(320);
    expect(css.height).toBe(120);
    expect(css.zIndex).toBe(5);
    expect(css.padding).toBe("1rem"); // base preserved
  });

  it("applies rotation as a transform", () => {
    const css = applyBlockPresentation(nodeWith({ geometry: { mode: "flow", rotation: 15 } }), 1440, {});
    expect(css.transform).toBe("rotate(15deg)");
  });

  it("skips zero rotation", () => {
    const css = applyBlockPresentation(nodeWith({ geometry: { mode: "flow", rotation: 0 } }), 1440, {});
    expect(css.transform).toBeUndefined();
  });

  it("applies absolute positioning with x/y", () => {
    const css = applyBlockPresentation(
      nodeWith({ geometry: { mode: "absolute", x: 40, y: 60 } }),
      1440,
      {},
    );
    expect(css.position).toBe("absolute");
    expect(css.left).toBe(40);
    expect(css.top).toBe(60);
  });

  it("flow mode does not force absolute positioning", () => {
    const css = applyBlockPresentation(nodeWith({ geometry: { mode: "flow", x: 40, y: 60 } }), 1440, {});
    expect(css.position).toBeUndefined();
    expect(css.left).toBeUndefined();
  });

  it("ignores non-finite geometry values", () => {
    const css = applyBlockPresentation(
      nodeWith({ geometry: { mode: "flow", width: Number.NaN } }),
      1440,
      {},
    );
    expect(css.width).toBeUndefined();
  });

  it("nodes without geometry render unchanged (additive)", () => {
    const css = applyBlockPresentation(nodeWith({}), 1440, { padding: "1rem" });
    expect(css).toEqual({ padding: "1rem" });
  });
});

describe("applyBlockPresentation — viewport overrides", () => {
  it("applies mobile overrides at narrow widths", () => {
    const css = applyBlockPresentation(
      nodeWith({
        style: { fontSize: 24 },
        viewport: { mobile: { fontSize: 18 } },
      }),
      390,
      { fontSize: 24 },
    );
    expect(css.fontSize).toBe(18);
  });

  it("applies tablet overrides at tablet widths and keeps desktop at wide widths", () => {
    const node = nodeWith({
      style: { fontSize: 24 },
      viewport: { tablet: { fontSize: 20 }, mobile: { fontSize: 18 } },
    });
    expect(applyBlockPresentation(node, 900, { fontSize: 24 }).fontSize).toBe(20);
    expect(applyBlockPresentation(node, 1440, { fontSize: 24 }).fontSize).toBe(24);
  });

  it("mobile wins over tablet at narrow widths (top-down inheritance)", () => {
    const node = nodeWith({
      style: { fontSize: 24 },
      viewport: { tablet: { fontSize: 20 }, mobile: { fontSize: 18 } },
    });
    expect(applyBlockPresentation(node, 390, { fontSize: 24 }).fontSize).toBe(18);
  });

  it("geometry overrides viewport overrides (manipulation wins)", () => {
    const css = applyBlockPresentation(
      nodeWith({
        style: { width: "100%" },
        viewport: { mobile: { width: "50%" } },
        geometry: { mode: "flow", width: 320 },
      }),
      390,
      { width: "100%" },
    );
    expect(css.width).toBe(320);
  });
});
