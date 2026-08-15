// ---------------------------------------------------------------------------
// Responsive decision engine tests (Phase P22-F)
// Covers: validated transformation vocabulary (no arbitrary strings), proposal
// rules (grids/rows/headings, locked/hidden/already-responsive skips), user
// ownership suppression (never re-suggest), application through the existing
// viewport op, and bounded recording/normalization.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../registry/register-default-elements";
import type { ElementNode, ElementTree } from "../types";
import {
  MAX_RESPONSIVE_DECISIONS,
  ResponsiveDecisionSchema,
  ResponsiveDecisionsSchema,
  applyResponsibleDecision,
  normalizeResponsiveDecisions,
  parseGridTemplateColumnsCount,
  parsePxFontSize,
  proposeResponsiveDecisions,
  recordResponsiveDecision,
  suppressResponsiveProposals,
} from "../responsive/decisions";
import type { ResponsiveDecision } from "../responsive/types";

function node(overrides: Partial<ElementNode>): ElementNode {
  return {
    id: "n1",
    type: "heading",
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function tree(nodes: ElementNode[]): ElementTree {
  const map: Record<string, ElementNode> = {};
  for (const n of nodes) map[n.id] = n;
  return { rootIds: nodes.map((n) => n.id), nodes: map };
}

function grid(id: string, columns: number, extra: Partial<ElementNode> = {}): ElementNode {
  return node({ id, type: "grid", props: { columns }, children: [], ...extra });
}

function child(id: string): ElementNode {
  return node({ id, type: "container", children: [], props: {} });
}

/** A row together with its (validated) child nodes, ids + backrefs matching. */
function rowTree(id: string, childCount: number): ElementTree {
  const children = Array.from({ length: childCount }, (_, i) => `child-${id}-${i}`);
  const nodes: Record<string, ElementNode> = {
    [id]: node({ id, type: "row", children }),
  };
  for (const c of children) {
    nodes[c] = { ...child(c), parentId: id };
  }
  return { rootIds: [id], nodes };
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
});

const applied = (partial: Partial<ResponsiveDecision>): ResponsiveDecision => ({
  elementId: "n1",
  viewport: "mobile",
  transformation: "grid-columns-2",
  appliedBy: "ai",
  state: "applied",
  ...partial,
});

// ---------------------------------------------------------------------------
// Vocabulary + schema (the hard boundary — no arbitrary strings)
// ---------------------------------------------------------------------------

describe("ResponsiveDecisionSchema — validated vocabulary", () => {
  it("accepts allow-list transformations", () => {
    const decision = applied({ transformation: "grid-columns-2" });
    expect(ResponsiveDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it("rejects arbitrary/unvalidated transformation strings", () => {
    const decision = applied({ transformation: "carousel" } as unknown as ResponsiveDecision);
    expect(ResponsiveDecisionSchema.safeParse(decision).success).toBe(false);
    expect(ResponsiveDecisionSchema.safeParse({ ...decision, transformation: "grid-2" }).success).toBe(false);
    expect(ResponsiveDecisionSchema.safeParse({ ...decision, transformation: "font-size" }).success).toBe(false);
  });

  it("rejects malformed records (viewport/state/appliedBy)", () => {
    expect(ResponsiveDecisionSchema.safeParse(applied({ viewport: "desktop" as never })).success).toBe(false);
    expect(ResponsiveDecisionSchema.safeParse(applied({ state: "maybe" as never })).success).toBe(false);
    expect(ResponsiveDecisionSchema.safeParse(applied({ appliedBy: "robot" as never })).success).toBe(false);
  });

  it("defaults missing state to applied", () => {
    const parsed = ResponsiveDecisionSchema.safeParse({
      elementId: "n1",
      viewport: "mobile",
      transformation: "stack",
      appliedBy: "user",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.state).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe("parsers", () => {
  it("parsePxFontSize handles numbers and px strings", () => {
    expect(parsePxFontSize(40)).toBe(40);
    expect(parsePxFontSize("40px")).toBe(40);
    expect(parsePxFontSize("2rem")).toBeNull();
    expect(parsePxFontSize(undefined)).toBeNull();
  });

  it("parseGridTemplateColumnsCount reads repeat(N, ...)", () => {
    expect(parseGridTemplateColumnsCount("repeat(2, minmax(0, 1fr))")).toBe(2);
    expect(parseGridTemplateColumnsCount("repeat( 1 , minmax(0, 1fr))")).toBe(1);
    expect(parseGridTemplateColumnsCount("auto")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

describe("proposeResponsiveDecisions", () => {
  it("proposes fewer grid columns on tablet/mobile", () => {
    const t = tree([grid("g", 4)]);
    const tablet = proposeResponsiveDecisions(t, "tablet");
    expect(tablet).toHaveLength(1);
    expect(tablet[0]).toMatchObject({ elementId: "g", transformation: "grid-columns-2" });
    const mobile = proposeResponsiveDecisions(t, "mobile");
    expect(mobile[0]).toMatchObject({ elementId: "g", transformation: "grid-columns-1" });
  });

  it("proposes nothing when the grid already fits", () => {
    expect(proposeResponsiveDecisions(tree([grid("g", 2)]), "tablet")).toHaveLength(0);
    expect(proposeResponsiveDecisions(tree([grid("g", 1)]), "mobile")).toHaveLength(0);
  });

  it("skips grids already responsive at that viewport", () => {
    const t = tree([grid("g", 4, { viewport: { mobile: { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } } })]);
    expect(proposeResponsiveDecisions(t, "mobile")).toHaveLength(0);
  });

  it("proposes stack for busy rows on mobile only", () => {
    const mobile = proposeResponsiveDecisions(rowTree("r", 5), "mobile");
    expect(mobile.some((p) => p.elementId === "r" && p.transformation === "stack")).toBe(true);
    expect(proposeResponsiveDecisions(rowTree("r", 5), "tablet")).toHaveLength(0);
  });

  it("does not propose stack for sparse rows or already-stacked rows", () => {
    expect(proposeResponsiveDecisions(rowTree("r", 2), "mobile")).toHaveLength(0);
    const stacked = rowTree("r", 5);
    stacked.nodes.r = { ...stacked.nodes.r, viewport: { mobile: { flexDirection: "column" } } };
    expect(proposeResponsiveDecisions(stacked, "mobile")).toHaveLength(0);
  });

  it("does not propose stack for non-flex elements (headings, plain containers)", () => {
    const t = tree([node({ id: "h", type: "heading", style: { fontSize: 40 } }), node({ id: "c", type: "container" })]);
    expect(proposeResponsiveDecisions(t, "mobile").filter((p) => p.transformation === "stack")).toHaveLength(0);
  });

  it("proposes font-size-smaller for large text on mobile", () => {
    const t = tree([node({ id: "h", type: "heading", style: { fontSize: 40 } })]);
    const mobile = proposeResponsiveDecisions(t, "mobile");
    expect(mobile.some((p) => p.elementId === "h" && p.transformation === "font-size-smaller")).toBe(true);
    expect(proposeResponsiveDecisions(t, "tablet")).toHaveLength(0);
  });

  it("skips small text and already-overridden text", () => {
    const small = tree([node({ id: "h", type: "heading", style: { fontSize: 16 } })]);
    expect(proposeResponsiveDecisions(small, "mobile")).toHaveLength(0);
    const overridden = tree([node({ id: "h", type: "heading", style: { fontSize: 40 }, viewport: { mobile: { fontSize: 20 } } })]);
    expect(proposeResponsiveDecisions(overridden, "mobile")).toHaveLength(0);
  });

  it("skips locked and hidden nodes", () => {
    const locked = tree([grid("g", 4, { locked: true })]);
    expect(proposeResponsiveDecisions(locked, "mobile")).toHaveLength(0);
    const hidden = tree([grid("g", 4, { hidden: true })]);
    expect(proposeResponsiveDecisions(hidden, "mobile")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suppression — user overrides always win, never re-suggest
// ---------------------------------------------------------------------------

describe("suppressResponsiveProposals", () => {
  const proposal = { elementId: "g", viewport: "mobile" as const, transformation: "grid-columns-1" as const, note: "x" };
  const other = { ...proposal, elementId: "h" };
  const otherViewport = { ...proposal, viewport: "tablet" as const };

  it("keeps proposals when no decisions exist", () => {
    expect(suppressResponsiveProposals([proposal], [])).toEqual([proposal]);
  });

  it("a user decision for the pair suppresses ALL proposals for that pair", () => {
    const decisions = [applied({ elementId: "g", appliedBy: "user", transformation: "stack" })];
    expect(suppressResponsiveProposals([proposal], decisions)).toHaveLength(0);
    // Other elements / viewports are unaffected.
    expect(suppressResponsiveProposals([other, otherViewport], decisions)).toHaveLength(2);
  });

  it("a user rejection suppresses re-suggestion", () => {
    const decisions = [applied({ elementId: "g", appliedBy: "user", transformation: "grid-columns-1", state: "rejected" })];
    expect(suppressResponsiveProposals([proposal], decisions)).toHaveLength(0);
  });

  it("an applied AI decision suppresses re-offering the same change", () => {
    const decisions = [applied({ elementId: "g", transformation: "grid-columns-1" })];
    expect(suppressResponsiveProposals([proposal], decisions)).toHaveLength(0);
    expect(suppressResponsiveProposals([other], decisions)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Application — writes viewport overrides through the existing op
// ---------------------------------------------------------------------------

describe("applyResponsibleDecision", () => {
  it("grid-columns-2 writes a gridTemplateColumns override without touching base props", () => {
    const t = tree([grid("g", 4)]);
    const result = applyResponsibleDecision(t, applied({ elementId: "g", viewport: "tablet", transformation: "grid-columns-2" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.g.viewport?.tablet?.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expect(result.value.nodes.g.props.columns).toBe(4);
    expect(result.value.nodes.g.style).toEqual({});
  });

  it("stack writes flexDirection column at the decision viewport", () => {
    const t = rowTree("r", 4);
    const result = applyResponsibleDecision(t, applied({ elementId: "r", transformation: "stack" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.r.viewport?.mobile?.flexDirection).toBe("column");
  });

  it("font-size-smaller reduces the base px size (40 → 30)", () => {
    const t = tree([node({ id: "h", type: "heading", style: { fontSize: 40 } })]);
    const result = applyResponsibleDecision(t, applied({ elementId: "h", transformation: "font-size-smaller" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h.viewport?.mobile?.fontSize).toBe(30);
  });

  it("font-size-smaller is a no-op when there is no parseable base size", () => {
    const t = tree([node({ id: "h", type: "heading", style: { fontSize: "clamp(1rem, 4vw, 3rem)" } })]);
    const result = applyResponsibleDecision(t, applied({ elementId: "h", transformation: "font-size-smaller" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h.viewport).toBeUndefined();
  });

  it("rejects unknown elements and locked elements", () => {
    const t = tree([grid("g", 4)]);
    expect(applyResponsibleDecision(t, applied({ elementId: "missing", transformation: "stack" })).ok).toBe(false);
    const locked = tree([grid("g", 4, { locked: true })]);
    expect(applyResponsibleDecision(locked, applied({ elementId: "g", transformation: "stack" })).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recording + normalization (bounded)
// ---------------------------------------------------------------------------

describe("recordResponsiveDecision", () => {
  it("appends new decisions", () => {
    const out = recordResponsiveDecision([], applied({}));
    expect(out).toHaveLength(1);
  });

  it("replaces an earlier decision for the same triple", () => {
    const earlier = applied({ state: "applied" });
    const later = applied({ state: "rejected", appliedBy: "user" });
    const out = recordResponsiveDecision([earlier], later);
    expect(out).toEqual([later]);
  });

  it("keeps distinct decisions for the same element+viewport with different transformations", () => {
    const a = applied({ transformation: "grid-columns-2" });
    const b = applied({ transformation: "stack" });
    expect(recordResponsiveDecision([a], b)).toHaveLength(2);
  });

  it("caps the list at the bound (oldest dropped)", () => {
    const decisions: ResponsiveDecision[] = [];
    for (let i = 0; i < MAX_RESPONSIVE_DECISIONS + 10; i += 1) {
      decisions.push(applied({ elementId: `e${i}` }));
    }
    const out = recordResponsiveDecision(decisions, applied({ elementId: "last" }));
    expect(out).toHaveLength(MAX_RESPONSIVE_DECISIONS);
    expect(out[out.length - 1].elementId).toBe("last");
    expect(out.some((d) => d.elementId === "e0")).toBe(false);
  });
});

describe("normalizeResponsiveDecisions", () => {
  it("keeps valid decisions and drops invalid entries (incl. unknown transformations)", () => {
    const input = [
      applied({}),
      { elementId: "x", viewport: "mobile", transformation: "carousel", appliedBy: "ai" },
      { elementId: "y", viewport: "tablet", transformation: "grid-columns-2", appliedBy: "user", state: "rejected" },
      "garbage",
    ];
    const out = normalizeResponsiveDecisions(input);
    expect(out).toHaveLength(2);
    expect(out[0].elementId).toBe("n1");
    expect(out[1]).toMatchObject({ elementId: "y", state: "rejected" });
  });

  it("returns an empty array for non-array input", () => {
    expect(normalizeResponsiveDecisions(null)).toEqual([]);
    expect(normalizeResponsiveDecisions({})).toEqual([]);
  });

  it("caps the normalized list", () => {
    const big = Array.from({ length: MAX_RESPONSIVE_DECISIONS + 5 }, (_, i) => applied({ elementId: `e${i}` }));
    const out = normalizeResponsiveDecisions(big);
    expect(out).toHaveLength(MAX_RESPONSIVE_DECISIONS);
  });
});

describe("ResponsiveDecisionsSchema bounds", () => {
  it("rejects oversized decision arrays", () => {
    const big = Array.from({ length: MAX_RESPONSIVE_DECISIONS + 1 }, (_, i) => applied({ elementId: `e${i}` }));
    expect(ResponsiveDecisionsSchema.safeParse(big).success).toBe(false);
  });
});
