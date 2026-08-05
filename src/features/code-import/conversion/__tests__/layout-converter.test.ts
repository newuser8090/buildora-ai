// ---------------------------------------------------------------------------
// Layout converter tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import {
  DEFAULT_LAYOUT_GAP,
  layoutBlockTypeForIntent,
  layoutIntentFromSignals,
  layoutPropsForIntent,
} from "../layout-converter";

describe("layoutIntentFromSignals", () => {
  it("detects a flex row", () => {
    expect(layoutIntentFromSignals({ display: "flex", flexDirection: "row", gap: 16 })).toEqual({
      direction: "row",
      gap: 16,
      wrap: undefined,
    });
  });

  it("detects a flex column", () => {
    expect(layoutIntentFromSignals({ display: "flex", flexDirection: "column" })).toMatchObject({
      direction: "column",
      gap: DEFAULT_LAYOUT_GAP,
    });
  });

  it("detects a grid with columns", () => {
    expect(layoutIntentFromSignals({ display: "grid", columns: 3 })).toMatchObject({
      direction: "grid",
      columns: 3,
      gap: DEFAULT_LAYOUT_GAP,
    });
  });

  it("normalizes alignment into the engine vocabulary", () => {
    const intent = layoutIntentFromSignals({
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
    });
    expect(intent.align).toBe("start");
    expect(intent.justify).toBe("space-between");
  });

  it("returns none for plain containers", () => {
    expect(layoutIntentFromSignals({})).toEqual({ direction: "none" });
  });
});

describe("layoutBlockTypeForIntent", () => {
  it("maps intents to layout block types", () => {
    expect(layoutBlockTypeForIntent({ direction: "row" })).toBe("row");
    expect(layoutBlockTypeForIntent({ direction: "column" })).toBe("column");
    expect(layoutBlockTypeForIntent({ direction: "grid", columns: 3 })).toBe("grid");
    expect(layoutBlockTypeForIntent({ direction: "none" })).toBe("container");
  });

  it("prefers stack for column intents when requested", () => {
    expect(layoutBlockTypeForIntent({ direction: "column" }, true)).toBe("stack");
    expect(layoutBlockTypeForIntent({ direction: "row" }, true)).toBe("row");
  });
});

describe("layoutPropsForIntent", () => {
  it("writes only detected values", () => {
    const props = layoutPropsForIntent({
      direction: "row",
      gap: 12,
      align: "center",
    });
    expect(props).toEqual({ layoutDirection: "row", gap: 12, alignItems: "center" });
  });

  it("writes grid columns", () => {
    const props = layoutPropsForIntent({ direction: "grid", columns: 4, gap: 16 });
    expect(props).toEqual({ layoutDirection: "grid", columns: 4, gap: 16 });
  });

  it("returns empty props for plain containers", () => {
    expect(layoutPropsForIntent({ direction: "none" })).toEqual({});
  });
});
