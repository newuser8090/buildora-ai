// ---------------------------------------------------------------------------
// Phase P3 — ID remapping
//   - every id is replaced with a fresh id
//   - parent/child references stay consistent
//   - the avoid set is never collided with
//   - forceRootId pins the first root
//   - deterministic with an injected factory
//   - input tree is never mutated
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import {
  remapBlockTreeIds,
  collectBlockTreeIds,
  collectPageSectionIds,
} from "@/features/code-import/services/id-remapper";
import { createConversionIdFactory } from "@/features/code-import/conversion/conversion-errors";

function makeNode(id: string, parentId: string | null, children: string[]): BlockNode {
  return {
    id,
    type: "container",
    parentId,
    children,
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
  };
}

function makePreviewTree(): BlockTree {
  const root = makeNode("preview-root", null, ["preview-head", "preview-sub"]);
  const head = makeNode("preview-head", "preview-root", []);
  const sub = makeNode("preview-sub", "preview-root", []);
  return {
    rootIds: ["preview-root"],
    nodes: { "preview-root": root, "preview-head": head, "preview-sub": sub },
  };
}

describe("remapBlockTreeIds", () => {
  it("replaces every id with a fresh id", () => {
    const result = remapBlockTreeIds(makePreviewTree());
    const originalIds = Object.keys(makePreviewTree().nodes);
    for (const oldId of originalIds) {
      expect(result.tree.nodes[oldId]).toBeUndefined();
    }
    expect(Object.keys(result.tree.nodes).length).toBe(3);
    expect(result.oldToNew.size).toBe(3);
  });

  it("keeps parent/child references consistent", () => {
    const result = remapBlockTreeIds(makePreviewTree());
    const { tree, oldToNew } = result;
    const newRootId = tree.rootIds[0];
    const root = tree.nodes[newRootId];
    expect(root.parentId).toBeNull();
    const newHeadId = oldToNew.get("preview-head");
    const head = tree.nodes[newHeadId!];
    expect(head.parentId).toBe(newRootId);
    expect(root.children).toEqual([newHeadId, oldToNew.get("preview-sub")]);
  });

  it("pins the first root when forceRootId is provided", () => {
    const result = remapBlockTreeIds(makePreviewTree(), { forceRootId: "sec-imported" });
    expect(result.tree.rootIds).toEqual(["sec-imported"]);
    expect(result.tree.nodes["sec-imported"]).toBeDefined();
    expect(result.oldToNew.get("preview-root")).toBe("sec-imported");
  });

  it("never collides with the avoid set", () => {
    const avoid = new Set<string>();
    // The default factory yields conv-1, conv-2, … — force collisions by
    // pre-seeding the avoid set with those ids.
    createConversionIdFactory("conv");
    for (let i = 1; i <= 10; i += 1) avoid.add(`conv-${i}`);
    const result = remapBlockTreeIds(makePreviewTree(), { avoid });
    for (const id of Object.keys(result.tree.nodes)) {
      expect(avoid.has(id)).toBe(false);
    }
  });

  it("is deterministic with an injected factory", () => {
    const factoryA = createConversionIdFactory("t");
    const factoryB = createConversionIdFactory("t");
    const a = remapBlockTreeIds(makePreviewTree(), { idFactory: factoryA });
    const b = remapBlockTreeIds(makePreviewTree(), { idFactory: factoryB });
    expect(JSON.stringify(a.tree)).toBe(JSON.stringify(b.tree));
  });

  it("does not mutate the input tree", () => {
    const input = makePreviewTree();
    const snapshot = JSON.stringify(input);
    remapBlockTreeIds(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("deep-copies nodes so later edits cannot leak into the result", () => {
    const result = remapBlockTreeIds(makePreviewTree());
    const newRootId = result.tree.rootIds[0];
    result.tree.nodes[newRootId].props.injected = true;
    expect((makePreviewTree().nodes["preview-root"].props as Record<string, unknown>).injected).toBeUndefined();
  });
});

describe("collect helpers", () => {
  it("collects every block id", () => {
    expect(collectBlockTreeIds(makePreviewTree()).sort()).toEqual(
      ["preview-head", "preview-root", "preview-sub"].sort(),
    );
  });

  it("collects section ids", () => {
    expect(collectPageSectionIds([{ id: "a" }, { id: "b" }])).toEqual(["a", "b"]);
  });
});
