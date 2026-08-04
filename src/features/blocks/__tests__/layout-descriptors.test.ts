// ---------------------------------------------------------------------------
// Layout descriptor tests (Phase O spec: TESTS → layout)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_LAYOUT,
  layoutDescriptorFor,
  layoutSummary,
  normalizeAlign,
  normalizeJustify,
  rowLayoutProps,
  columnLayoutProps,
  gridLayoutProps,
  isRowDirection,
} from "../engine/layout-descriptors";
import { createBlock } from "../engine/block-operations";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../registry/block-registry";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

describe("layout descriptors", () => {
  it("returns defaults for a block without layout props", () => {
    const node = createBlock("container");
    expect(layoutDescriptorFor(node)).toEqual(DEFAULT_LAYOUT);
  });

  it("parses explicit layout props", () => {
    const node = createBlock("container", {
      props: { layoutDirection: "row", gap: 24, alignItems: "center", flexWrap: true },
    });
    const descriptor = layoutDescriptorFor(node);
    expect(descriptor.direction).toBe("row");
    expect(descriptor.gap).toBe(24);
    expect(descriptor.align).toBe("center");
    expect(descriptor.wrap).toBe(true);
  });

  it("clamps grid columns to 1..12", () => {
    const node = createBlock("container", { props: { layoutDirection: "grid", columns: 99 } });
    expect(layoutDescriptorFor(node).columns).toBe(12);
    const node2 = createBlock("container", { props: { layoutDirection: "grid", columns: 0 } });
    expect(layoutDescriptorFor(node2).columns).toBe(1);
  });

  it("ignores invalid values", () => {
    const node = createBlock("container", {
      props: { layoutDirection: "diagonal", gap: -5, alignItems: "middle" },
    });
    const descriptor = layoutDescriptorFor(node);
    expect(descriptor.direction).toBe(DEFAULT_LAYOUT.direction);
    expect(descriptor.gap).toBe(DEFAULT_LAYOUT.gap);
    expect(descriptor.align).toBe(DEFAULT_LAYOUT.align);
  });

  it("layoutSummary describes the layout", () => {
    const node = createBlock("container", { props: { layoutDirection: "row", gap: 16 } });
    expect(layoutSummary(node)).toContain("row");
    expect(layoutSummary(node)).toContain("16px");
    const grid = createBlock("container", { props: { layoutDirection: "grid", columns: 3 } });
    expect(layoutSummary(grid)).toContain("3 columns");
  });

  it("normalizers fall back to defaults", () => {
    expect(normalizeAlign("end")).toBe("end");
    expect(normalizeAlign("bogus")).toBe(DEFAULT_LAYOUT.align);
    expect(normalizeJustify("space-between")).toBe("space-between");
    expect(normalizeJustify("bogus")).toBe(DEFAULT_LAYOUT.justify);
  });

  it("factory helpers produce valid props", () => {
    expect(rowLayoutProps().layoutDirection).toBe("row");
    expect(columnLayoutProps(8).gap).toBe(8);
    expect(gridLayoutProps(4).columns).toBe(4);
    expect(isRowDirection("row")).toBe(true);
    expect(isRowDirection("grid")).toBe(true);
    expect(isRowDirection("column")).toBe(false);
  });
});
