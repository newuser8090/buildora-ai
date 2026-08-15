// ---------------------------------------------------------------------------
// Responsive foundation tests (Phase P22-A)
// Covers: viewport thresholds, style-token merging, top-down override
// inheritance, effective element style resolution (base < block responsive <
// viewport overrides), and user-over-AI decision ordering.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  hasViewportOverride,
  mergeStyleTokens,
  resolveElementStyle,
  viewportOverridesForWidth,
  effectiveResponsiveDecisions,
} from "../responsive/resolve";
import {
  MOBILE_MAX_WIDTH,
  TABLET_MAX_WIDTH,
  viewportKeyForWidth,
  type ResponsiveDecision,
} from "../responsive/types";
import type { ElementNode } from "../types";

describe("viewport thresholds", () => {
  it("classifies widths into mobile / tablet / desktop", () => {
    expect(viewportKeyForWidth(0)).toBe("mobile");
    expect(viewportKeyForWidth(MOBILE_MAX_WIDTH)).toBe("mobile");
    expect(viewportKeyForWidth(MOBILE_MAX_WIDTH + 1)).toBe("tablet");
    expect(viewportKeyForWidth(TABLET_MAX_WIDTH)).toBe("tablet");
    expect(viewportKeyForWidth(TABLET_MAX_WIDTH + 1)).toBeNull();
    expect(viewportKeyForWidth(1920)).toBeNull();
  });
});

describe("mergeStyleTokens", () => {
  it("later records win and nullish values are skipped", () => {
    const merged = mergeStyleTokens(
      { fontSize: "20px", color: "red", gap: undefined },
      { fontSize: "14px", padding: "1rem", opacity: null as unknown as undefined },
    );
    expect(merged).toEqual({ fontSize: "14px", color: "red", padding: "1rem" });
  });

  it("ignores empty / undefined records", () => {
    expect(mergeStyleTokens(undefined, {}, { color: "blue" })).toEqual({ color: "blue" });
  });
});

describe("viewportOverridesForWidth (top-down inheritance)", () => {
  const viewport = {
    tablet: { fontSize: "18px", padding: "2rem" },
    mobile: { fontSize: "14px" },
  };

  it("desktop receives no overrides", () => {
    expect(viewportOverridesForWidth(viewport, 1200)).toEqual({});
  });

  it("tablet range receives tablet overrides only", () => {
    expect(viewportOverridesForWidth(viewport, 900)).toEqual({
      fontSize: "18px",
      padding: "2rem",
    });
  });

  it("mobile range receives mobile on top of tablet (mobile wins per-key)", () => {
    expect(viewportOverridesForWidth(viewport, 600)).toEqual({
      fontSize: "14px",
      padding: "2rem",
    });
  });

  it("missing viewport data yields no overrides", () => {
    expect(viewportOverridesForWidth(undefined, 400)).toEqual({});
  });

  it("hasViewportOverride reports non-empty breakpoint keys", () => {
    expect(hasViewportOverride(viewport, "tablet")).toBe(true);
    expect(hasViewportOverride(viewport, "mobile")).toBe(true);
    expect(hasViewportOverride({ tablet: {} }, "tablet")).toBe(false);
    expect(hasViewportOverride(undefined, "mobile")).toBe(false);
  });
});

describe("resolveElementStyle precedence", () => {
  function node(overrides: Partial<ElementNode>): ElementNode {
    return {
      id: "n",
      type: "heading",
      parentId: null,
      children: [],
      props: {},
      style: { fontSize: "32px", color: "black" },
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      ...overrides,
    } as ElementNode;
  }

  it("returns base style on desktop", () => {
    const css = resolveElementStyle(node({}), 1440);
    expect(css.fontSize).toBe("32px");
    expect(css.color).toBe("black");
  });

  it("applies block responsive tokens in the matching width range", () => {
    const css = resolveElementStyle(
      node({ responsive: { sm: { fontSize: "24px" } } }),
      700,
    );
    expect(css.fontSize).toBe("24px");
  });

  it("viewport overrides win over base and block responsive tokens", () => {
    const css = resolveElementStyle(
      node({
        responsive: { sm: { fontSize: "24px" } },
        viewport: { mobile: { fontSize: "14px" } },
      }),
      400,
    );
    expect(css.fontSize).toBe("14px");
  });

  it("viewport overrides do not leak to larger widths", () => {
    const css = resolveElementStyle(
      node({ viewport: { mobile: { fontSize: "14px" } } }),
      900,
    );
    expect(css.fontSize).toBe("32px");
  });
});

describe("effectiveResponsiveDecisions", () => {
  const ai: ResponsiveDecision = {
    elementId: "c1",
    viewport: "mobile",
    transformation: "grid-columns-2",
    appliedBy: "ai",
    state: "applied",
  };
  const user: ResponsiveDecision = {
    elementId: "c1",
    viewport: "mobile",
    transformation: "stack",
    appliedBy: "user",
    state: "applied",
  };

  it("keeps user decisions before AI decisions (user overrides always win)", () => {
    const ordered = effectiveResponsiveDecisions([ai, user, ai]);
    expect(ordered.map((d) => d.appliedBy)).toEqual(["user", "ai", "ai"]);
    expect(ordered[0]).toBe(user);
  });

  it("preserves relative order within each group (stable)", () => {
    const a1 = { ...ai, note: "a1" };
    const a2 = { ...ai, note: "a2" };
    const u1 = { ...user, note: "u1" };
    const ordered = effectiveResponsiveDecisions([a1, u1, a2]);
    expect(ordered.map((d) => d.note)).toEqual(["u1", "a1", "a2"]);
  });
});
