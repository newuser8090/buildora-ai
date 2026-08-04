// ---------------------------------------------------------------------------
// Nesting rules tests (Phase O spec: TESTS → tree / validation)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { canNest, validateTree, nestingViolation } from "../engine/nesting-rules";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../registry/block-registry";
import { createBlock } from "../engine/block-operations";
import type { BlockTree } from "../types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

function buildTree(nodesIn: ReturnType<typeof createBlock>[]): BlockTree {
  const nodes: BlockTree["nodes"] = {};
  const rootIds: string[] = [];
  for (const node of nodesIn) {
    nodes[node.id] = node;
    if (node.parentId === null) rootIds.push(node.id);
  }
  return { rootIds, nodes };
}

describe("canNest", () => {
  it("container accepts any block", () => {
    expect(canNest("container", "heading")).toBe(true);
    expect(canNest("container", "button")).toBe(true);
    expect(canNest("container", "form")).toBe(true);
  });

  it("row accepts its declared children", () => {
    expect(canNest("row", "card")).toBe(true);
    expect(canNest("row", "button")).toBe(true);
  });

  it("row rejects undeclared children", () => {
    expect(canNest("row", "heading")).toBe(false);
    expect(canNest("row", "form")).toBe(false);
  });

  it("leaf blocks reject all children", () => {
    expect(canNest("heading", "paragraph")).toBe(false);
    expect(canNest("button", "badge")).toBe(false);
    expect(canNest("image", "icon")).toBe(false);
    expect(canNest("divider", "spacer")).toBe(false);
  });

  it("pricing-card accepts heading/paragraph/button but not image", () => {
    expect(canNest("pricing-card", "heading")).toBe(true);
    expect(canNest("pricing-card", "paragraph")).toBe(true);
    expect(canNest("pricing-card", "button")).toBe(true);
    expect(canNest("pricing-card", "image")).toBe(false);
  });

  it("unknown types are rejected", () => {
    expect(canNest("container", "nope" as never)).toBe(false);
    expect(canNest("nope" as never, "heading")).toBe(false);
  });
});

describe("nestingViolation", () => {
  it("returns null when allowed", () => {
    expect(nestingViolation("container", "heading")).toBeNull();
  });

  it("returns a readable reason when rejected", () => {
    const reason = nestingViolation("heading", "paragraph");
    expect(reason).toContain("cannot");
  });
});

describe("validateTree", () => {
  it("accepts a valid tree", () => {
    const root = createBlock("container");
    const child = createBlock("heading");
    root.children = [child.id];
    child.parentId = root.id;
    const result = validateTree(buildTree([root, child]));
    expect(result.valid).toBe(true);
    expect(result.problems).toHaveLength(0);
  });

  it("rejects a missing root", () => {
    const result = validateTree({ rootIds: ["ghost"], nodes: {} });
    expect(result.valid).toBe(false);
  });

  it("rejects orphaned nodes", () => {
    const root = createBlock("container");
    const orphan = createBlock("heading");
    orphan.parentId = root.id; // referenced nowhere → unreachable
    const result = validateTree(buildTree([root, orphan]));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("orphaned"))).toBe(true);
  });

  it("rejects a parent/child pointer mismatch", () => {
    const root = createBlock("container");
    const child = createBlock("heading");
    root.children = [child.id]; // child does not point back
    const result = validateTree(buildTree([root, child]));
    expect(result.valid).toBe(false);
  });

  it("rejects a cycle", () => {
    const a = createBlock("container");
    const b = createBlock("container");
    a.children = [b.id];
    b.parentId = a.id;
    b.children = [a.id]; // b points back at the root a → cycle
    const result = validateTree(buildTree([a, b]));
    expect(result.valid).toBe(false);
    expect(
      result.problems.some((p) => p.message.toLowerCase().includes("cycle")),
    ).toBe(true);
  });

  it("rejects nesting-rule violations", () => {
    const root = createBlock("heading");
    const child = createBlock("paragraph");
    root.children = [child.id];
    child.parentId = root.id;
    const result = validateTree(buildTree([root, child]));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("cannot"))).toBe(true);
  });

  it("rejects exceeding maxChildren", () => {
    const row = createBlock("row");
    const children: ReturnType<typeof createBlock>[] = [];
    const nodes: BlockTree["nodes"] = { [row.id]: row };
    for (let i = 0; i < 7; i += 1) {
      const card = createBlock("card", { id: `card-${i}` });
      card.parentId = row.id;
      children.push(card);
      nodes[card.id] = card;
    }
    row.children = children.map((c) => c.id);
    const result = validateTree({ rootIds: [row.id], nodes });
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("at most 6"))).toBe(true);
  });

  it("does not mutate the tree", () => {
    const root = createBlock("container");
    const before = JSON.stringify({ children: root.children });
    validateTree(buildTree([root]));
    expect(JSON.stringify({ children: root.children })).toBe(before);
  });
});
