// ---------------------------------------------------------------------------
// Phase P22-J — collaboration normalization preserves data bindings
//   - normalizeBlockTree carries binding (validated, additive)
//   - invalid bindings are dropped safely
//   - old trees (without binding) normalize unchanged
//   - normalizeProject carries durable collections
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizeBlockTree, normalizeProject, normalizeSections } from "../crdt/tree-normalizer";
import type { BlockTree } from "@/features/blocks/types";

function baseNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "root",
    type: "heading",
    parentId: null,
    children: [],
    props: { text: "Hello" },
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("normalizeBlockTree — P22-J binding carry-through", () => {
  it("preserves a valid binding on reachable nodes", () => {
    const tree: unknown = {
      rootIds: ["root"],
      nodes: {
        root: baseNode({
          binding: { source: "collection", collectionId: "products", path: "price", field: "text" },
        }),
      },
    };
    const normalized = normalizeBlockTree(tree);
    expect(normalized).not.toBeNull();
    const root = normalized?.nodes.root as { binding?: unknown };
    expect(root?.binding).toEqual({
      source: "collection",
      collectionId: "products",
      path: "price",
      field: "text",
    });
  });

  it("drops invalid bindings during projection (never coerced)", () => {
    const tree: unknown = {
      rootIds: ["root"],
      nodes: {
        root: baseNode({ binding: { source: "oracle", path: 42 } }),
      },
    };
    const normalized = normalizeBlockTree(tree);
    const root = normalized?.nodes.root as { binding?: unknown };
    expect(root?.binding).toBeUndefined();
  });

  it("old trees without binding normalize unchanged", () => {
    const tree: unknown = { rootIds: ["root"], nodes: { root: baseNode() } };
    const normalized = normalizeBlockTree(tree);
    const root = normalized?.nodes.root as { binding?: unknown; props?: Record<string, unknown> };
    expect(root?.binding).toBeUndefined();
    expect(root?.props).toEqual({ text: "Hello" });
  });

  it("keeps binding alongside other element metadata", () => {
    const tree: unknown = {
      rootIds: ["root"],
      nodes: {
        root: baseNode({
          geometry: { mode: "flow" },
          binding: { source: "collection", collectionId: "products", path: "name", field: "text" },
        }),
      },
    };
    const normalized = normalizeBlockTree(tree);
    const root = normalized?.nodes.root as { geometry?: unknown; binding?: unknown };
    expect(root?.geometry).toMatchObject({ mode: "flow" });
    expect(root?.binding).toMatchObject({ collectionId: "products", path: "name" });
  });
});

describe("normalizeProject — durable collections carry-through", () => {
  it("preserves valid collections and drops invalid entries", () => {
    const project = normalizeProject({
      id: "p1",
      name: "P",
      theme: { palette: {}, typography: {}, spacing: {}, radius: {}, shadows: {} },
      pages: [],
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      collections: [
        { id: "col-1", name: "Products", fields: [{ id: "f1", name: "name", type: "text" }] },
        { id: "col-2", name: "Bad", fields: [{ id: "f2", name: "x", type: "date" }] },
      ],
    });
    expect(project.collections).toEqual([
      { id: "col-1", name: "Products", fields: [{ id: "f1", name: "name", type: "text" }] },
    ]);
  });

  it("old projects without collections stay empty", () => {
    const project = normalizeProject({
      id: "p1",
      name: "P",
      theme: { palette: {}, typography: {}, spacing: {}, radius: {}, shadows: {} },
      pages: [],
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(project.collections).toBeUndefined();
  });
});

describe("normalizeSections — custom-block trees keep P22-J bindings", () => {
  it("preserves binding through section normalization", () => {
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
                binding: { source: "collection", collectionId: "products", path: "price", field: "text" },
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
    const root = tree?.nodes.root as { binding?: unknown };
    expect(root?.binding).toMatchObject({ collectionId: "products", path: "price" });
  });
});
