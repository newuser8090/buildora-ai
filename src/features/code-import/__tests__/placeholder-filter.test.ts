// ---------------------------------------------------------------------------
// Phase P3 — supported-parts-only filter
//   - empty placeholder containers are removed
//   - content-bearing / styled / rooted containers are kept
//   - the filtered tree remains valid (falls back when not)
//   - deterministic
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import {
  isEmptyPlaceholder,
  filterSupportedOnly,
} from "@/features/code-import/services/placeholder-filter";

function makeNode(id: string, overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
    type: "container",
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

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

describe("isEmptyPlaceholder", () => {
  it("true for an empty, unstyled leaf container", () => {
    expect(isEmptyPlaceholder(makeNode("x", { parentId: "p" }))).toBe(true);
  });

  it("false when the node has children", () => {
    expect(isEmptyPlaceholder(makeNode("x", { children: ["y"] }))).toBe(false);
  });

  it("false when the node is a root", () => {
    expect(isEmptyPlaceholder(makeNode("x", { parentId: "p" }))).toBe(true);
    expect(isEmptyPlaceholder(makeNode("x"))).toBe(false);
  });

  it("false when the node carries content props", () => {
    expect(
      isEmptyPlaceholder(makeNode("x", { parentId: "p", props: { text: "Hi" } })),
    ).toBe(false);
    expect(
      isEmptyPlaceholder(makeNode("x", { parentId: "p", props: { _marker: "internal" } })),
    ).toBe(true);
  });

  it("false when the node has any style", () => {
    expect(
      isEmptyPlaceholder(makeNode("x", { parentId: "p", style: { padding: "1rem" } })),
    ).toBe(false);
  });

  it("false for non-container types", () => {
    expect(
      isEmptyPlaceholder(makeNode("x", { parentId: "p", type: "spacer" })),
    ).toBe(false);
  });
});

describe("filterSupportedOnly", () => {
  it("removes empty placeholder containers and reports the count", () => {
    const tree: BlockTree = {
      rootIds: ["root"],
      nodes: {
        root: makeNode("root", { children: ["placeholder"] }),
        placeholder: makeNode("placeholder", { parentId: "root" }),
      },
    };
    const result = filterSupportedOnly(tree);
    expect(result.removed).toBe(1);
    expect(result.tree.nodes.placeholder).toBeUndefined();
    expect(result.tree.nodes.root.children).toEqual([]);
  });

  it("returns the original tree when there is nothing to remove", () => {
    const tree: BlockTree = {
      rootIds: ["root"],
      nodes: {
        root: makeNode("root", { children: ["head"] }),
        head: makeNode("head", { parentId: "root", type: "heading", props: { text: "Hi" } }),
      },
    };
    const result = filterSupportedOnly(tree);
    expect(result.removed).toBe(0);
    expect(result.tree).toBe(tree);
  });

  it("keeps content-bearing and styled containers", () => {
    const tree: BlockTree = {
      rootIds: ["root"],
      nodes: {
        root: makeNode("root", {
          children: ["content", "styled"],
          props: { text: "Keep me" },
        }),
        content: makeNode("content", { parentId: "root", props: { text: "Real content" } }),
        styled: makeNode("styled", { parentId: "root", style: { margin: "2rem" } }),
      },
    };
    const result = filterSupportedOnly(tree);
    expect(result.removed).toBe(0);
    expect(result.tree.nodes.content).toBeDefined();
    expect(result.tree.nodes.styled).toBeDefined();
  });

  it("never drops roots", () => {
    const tree: BlockTree = {
      rootIds: ["r1", "r2"],
      nodes: {
        r1: makeNode("r1"),
        r2: makeNode("r2"),
      },
    };
    const result = filterSupportedOnly(tree);
    expect(result.removed).toBe(0);
    expect(result.tree.rootIds).toEqual(["r1", "r2"]);
  });

  it("does not mutate the input tree", () => {
    const tree: BlockTree = {
      rootIds: ["root"],
      nodes: {
        root: makeNode("root", { children: ["p"] }),
        p: makeNode("p", { parentId: "root" }),
      },
    };
    const snapshot = JSON.stringify(tree);
    filterSupportedOnly(tree);
    expect(JSON.stringify(tree)).toBe(snapshot);
  });
});
