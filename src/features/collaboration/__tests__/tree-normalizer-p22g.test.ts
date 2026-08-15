// ---------------------------------------------------------------------------
// Phase P22-G — collaboration normalization preserves declarative metadata
//   - normalizeBlockTree carries animation + interaction (validated, additive)
//   - invalid payloads are dropped (never coerced)
//   - old trees (without the fields) normalize unchanged
//   - geometry / viewport continue to survive alongside
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizeBlockTree, normalizeSections } from "../crdt/tree-normalizer";
import type { BlockTree } from "@/features/blocks/types";

function baseNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "root",
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

describe("normalizeBlockTree — P22-G metadata carry-through", () => {
  it("preserves animation + interaction on reachable nodes", () => {
    const tree: unknown = {
      rootIds: ["root"],
      nodes: {
        root: baseNode({
          animation: { trigger: "load", type: "fade", durationMs: 400 },
          interaction: {
            click: { kind: "navigate", target: { kind: "page", pageId: "home" } },
            hover: { scale: 1.05 },
          },
        }),
      },
    };
    const normalized = normalizeBlockTree(tree);
    expect(normalized).not.toBeNull();
    const root = normalized?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toEqual({ trigger: "load", type: "fade", durationMs: 400 });
    expect(root?.interaction).toMatchObject({
      click: { kind: "navigate" },
      hover: { scale: 1.05 },
    });
  });

  it("drops invalid animation/interaction during projection", () => {
    const tree: unknown = {
      rootIds: ["root"],
      nodes: {
        root: baseNode({
          animation: { trigger: "bogus", type: "fade" },
          interaction: { click: { kind: "teleport" } },
        }),
      },
    };
    const normalized = normalizeBlockTree(tree);
    const root = normalized?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toBeUndefined();
    expect(root?.interaction).toBeUndefined();
  });

  it("old trees without the fields normalize unchanged", () => {
    const tree: unknown = { rootIds: ["root"], nodes: { root: baseNode() } };
    const normalized = normalizeBlockTree(tree);
    const root = normalized?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toBeUndefined();
    expect(root?.interaction).toBeUndefined();
  });

  it("keeps geometry + viewport alongside animation/interaction", () => {
    const tree: unknown = {
      rootIds: ["root"],
      nodes: {
        root: baseNode({
          geometry: { mode: "absolute", x: 10, y: 20 },
          viewport: { mobile: { fontSize: "14px" } },
          animation: { trigger: "scroll", type: "slide" },
        }),
      },
    };
    const normalized = normalizeBlockTree(tree);
    const root = normalized?.nodes.root as {
      geometry?: unknown;
      viewport?: unknown;
      animation?: unknown;
    };
    expect(root?.geometry).toMatchObject({ x: 10, y: 20 });
    expect(root?.viewport).toMatchObject({ mobile: { fontSize: "14px" } });
    expect(root?.animation).toMatchObject({ type: "slide" });
  });
});

describe("normalizeSections — custom-block trees keep P22-G metadata", () => {
  it("preserves animation/interaction through section normalization", () => {
    const sections: unknown = [
      {
        id: "s1",
        type: "custom-block",
        order: 1,
        visible: true,
        props: {
          name: "Design",
          tree: {
            rootIds: ["root"],
            nodes: {
              root: baseNode({
                animation: { trigger: "load", type: "blur" },
                interaction: { focus: { color: "#ff0000" } },
              }),
            },
          },
        },
        styles: {},
      },
    ];
    const out = normalizeSections(sections);
    expect(out).toHaveLength(1);
    const tree = (out[0].props as { tree?: BlockTree }).tree;
    const root = tree?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toMatchObject({ type: "blur" });
    expect(root?.interaction).toMatchObject({ focus: { color: "#ff0000" } });
  });
});
