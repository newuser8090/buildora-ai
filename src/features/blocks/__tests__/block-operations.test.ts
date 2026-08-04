// ---------------------------------------------------------------------------
// Block operations tests (Phase O spec: TESTS → operations)
// All operations must be immutable, validated, and never throw.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  applyBlockOperation,
  createBlock,
  createBlockId,
  insertBlock,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  setBlockLocked,
  setBlockHidden,
  renameBlock,
  updateBlockProps,
} from "../engine/block-operations";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../registry/block-registry";
import { validateTree } from "../engine/nesting-rules";
import type { BlockTree } from "../types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

function treeWith(root: ReturnType<typeof createBlock>): BlockTree {
  return { rootIds: [root.id], nodes: { [root.id]: root } };
}

describe("insertBlock", () => {
  it("inserts a child into a container and points parentId back", () => {
    const root = createBlock("container");
    const heading = createBlock("heading");
    const result = insertBlock(treeWith(root), root.id, heading);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes[root.id].children).toEqual([heading.id]);
    expect(result.value.nodes[heading.id].parentId).toBe(root.id);
    expect(validateTree(result.value).valid).toBe(true);
  });

  it("inserts at a specific index", () => {
    const root = createBlock("container");
    const a = createBlock("heading", { id: "a" });
    const b = createBlock("paragraph", { id: "b" });
    const t1 = insertBlock(treeWith(root), root.id, a);
    if (!t1.ok) return;
    const t2 = insertBlock(t1.value, root.id, b, 0);
    if (!t2.ok) return;
    expect(t2.value.nodes[root.id].children).toEqual(["b", "a"]);
  });

  it("rejects unknown parents", () => {
    const root = createBlock("container");
    const result = insertBlock(treeWith(root), "missing", createBlock("heading"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TARGET_NOT_FOUND");
  });

  it("rejects duplicate ids", () => {
    const root = createBlock("container");
    const heading = createBlock("heading");
    const t1 = insertBlock(treeWith(root), root.id, heading);
    if (!t1.ok) return;
    const result = insertBlock(t1.value, root.id, { ...heading });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BLOCK_ID_CONFLICT");
  });

  it("rejects nesting violations", () => {
    const root = createBlock("heading");
    const result = insertBlock(treeWith(root), root.id, createBlock("paragraph"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NESTING_RULE_VIOLATION");
  });

  it("rejects inserts into locked parents", () => {
    const root = createBlock("container");
    const locked = setBlockLocked(treeWith(root), root.id, true);
    if (!locked.ok) return;
    const result = insertBlock(locked.value, root.id, createBlock("heading"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LOCKED_BLOCK");
  });

  it("does not mutate the input tree", () => {
    const root = createBlock("container");
    const snapshot = JSON.stringify(treeWith(root));
    insertBlock(treeWith(root), root.id, createBlock("heading"));
    expect(JSON.stringify(treeWith(root))).toBe(snapshot);
  });
});

describe("deleteBlock", () => {
  it("deletes a child and prunes descendants", () => {
    const root = createBlock("container");
    const card = createBlock("card", { id: "card" });
    const heading = createBlock("heading", { id: "h" });
    const t1 = insertBlock(treeWith(root), root.id, card);
    if (!t1.ok) return;
    const t2 = insertBlock(t1.value, card.id, heading);
    if (!t2.ok) return;

    const result = deleteBlock(t2.value, card.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes[card.id]).toBeUndefined();
    expect(result.value.nodes[heading.id]).toBeUndefined();
    expect(result.value.nodes[root.id].children).toEqual([]);
    expect(validateTree(result.value).valid).toBe(true);
  });

  it("rejects unknown blocks", () => {
    const root = createBlock("container");
    const result = deleteBlock(treeWith(root), "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BLOCK_NOT_FOUND");
  });

  it("deletes a root", () => {
    const root = createBlock("container");
    const result = deleteBlock(treeWith(root), root.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rootIds).toEqual([]);
  });
});

describe("duplicateBlock", () => {
  it("duplicates a subtree with fresh ids directly after the source", () => {
    const root = createBlock("container");
    const card = createBlock("card", { id: "card" });
    const heading = createBlock("heading", { id: "h" });
    const t1 = insertBlock(treeWith(root), root.id, card);
    if (!t1.ok) return;
    const t2 = insertBlock(t1.value, card.id, heading);
    if (!t2.ok) return;

    const result = duplicateBlock(t2.value, card.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { tree, newId } = result.value;
    expect(newId).not.toBe(card.id);
    expect(tree.nodes[newId]).toBeDefined();
    expect(tree.nodes[root.id].children).toEqual([card.id, newId]);
    // The clone's children are remapped.
    const cloneChildren = tree.nodes[newId].children;
    expect(cloneChildren.length).toBe(1);
    expect(tree.nodes[cloneChildren[0]].id).not.toBe(heading.id);
    expect(tree.nodes[cloneChildren[0]].parentId).toBe(newId);
    expect(validateTree(tree).valid).toBe(true);
  });

  it("rejects duplicating locked blocks", () => {
    const root = createBlock("container");
    const locked = setBlockLocked(treeWith(root), root.id, true);
    if (!locked.ok) return;
    const result = duplicateBlock(locked.value, root.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LOCKED_BLOCK");
  });
});

describe("moveBlock", () => {
  it("moves a block under a new parent", () => {
    const root = createBlock("container");
    const colA = createBlock("column", { id: "a" });
    const colB = createBlock("column", { id: "b" });
    const heading = createBlock("heading", { id: "h" });
    let tree = treeWith(root);
    for (const child of [colA, colB]) {
      const r = insertBlock(tree, root.id, child);
      if (!r.ok) return;
      tree = r.value;
    }
    const r1 = insertBlock(tree, colA.id, heading);
    if (!r1.ok) return;
    const result = moveBlock(r1.value, heading.id, colB.id, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes[colA.id].children).toEqual([]);
    expect(result.value.nodes[colB.id].children).toEqual([heading.id]);
    expect(result.value.nodes[heading.id].parentId).toBe(colB.id);
    expect(validateTree(result.value).valid).toBe(true);
  });

  it("rejects moving into a descendant", () => {
    const root = createBlock("container");
    const card = createBlock("card", { id: "card" });
    const heading = createBlock("heading", { id: "h" });
    let tree = treeWith(root);
    const r1 = insertBlock(tree, root.id, card);
    if (!r1.ok) return;
    tree = r1.value;
    const r2 = insertBlock(tree, card.id, heading);
    if (!r2.ok) return;
    const result = moveBlock(r2.value, card.id, heading.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NESTING_RULE_VIOLATION");
  });

  it("rejects moves that violate nesting rules", () => {
    const root = createBlock("container");
    const heading = createBlock("heading", { id: "h" });
    const t1 = insertBlock(treeWith(root), root.id, heading);
    if (!t1.ok) return;
    const leaf = createBlock("button", { id: "btn" });
    const t2 = insertBlock(t1.value, root.id, leaf);
    if (!t2.ok) return;
    // Move the heading INTO the button (button is a leaf → violation).
    const result = moveBlock(t2.value, heading.id, leaf.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NESTING_RULE_VIOLATION");
  });
});

describe("lock / hide / rename / props", () => {
  it("setBlockLocked toggles and blocks later edits", () => {
    const root = createBlock("heading");
    const locked = setBlockLocked(treeWith(root), root.id, true);
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.value.nodes[root.id].locked).toBe(true);
    const edit = updateBlockProps(locked.value, root.id, { text: "nope" });
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.error.code).toBe("LOCKED_BLOCK");
  });

  it("setBlockHidden sets the hidden flag", () => {
    const root = createBlock("heading");
    const hidden = setBlockHidden(treeWith(root), root.id, true);
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    expect(hidden.value.nodes[root.id].hidden).toBe(true);
  });

  it("renameBlock writes the label into props.name", () => {
    const root = createBlock("heading");
    const renamed = renameBlock(treeWith(root), root.id, "  My Heading  ");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok) return;
    expect(renamed.value.nodes[root.id].props.name).toBe("My Heading");
  });

  it("updateBlockProps merges props immutably", () => {
    const root = createBlock("heading", { props: { text: "A", level: 2 } });
    const updated = updateBlockProps(treeWith(root), root.id, { text: "B" });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.nodes[root.id].props.text).toBe("B");
    expect(updated.value.nodes[root.id].props.level).toBe(2);
    expect(root.props.text).toBe("A");
    expect(updated.value.nodes[root.id]).not.toBe(root);
  });
});

describe("dispatcher", () => {
  it("applyBlockOperation routes every kind", () => {
    const root = createBlock("container");
    const heading = createBlock("heading", { id: "h" });
    let tree = treeWith(root);
    const r = applyBlockOperation(tree, { kind: "insert", parentId: root.id, block: heading });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    tree = r.value as BlockTree;

    const renamed = applyBlockOperation(tree, { kind: "rename", blockId: heading.id, label: "X" });
    expect(renamed.ok).toBe(true);

    const moved = applyBlockOperation(tree, { kind: "move", blockId: heading.id, toParentId: root.id });
    expect(moved.ok).toBe(true);

    const locked = applyBlockOperation(tree, { kind: "lock", blockId: heading.id, locked: true });
    expect(locked.ok).toBe(true);

    const hidden = applyBlockOperation(tree, { kind: "hide", blockId: heading.id, hidden: true });
    expect(hidden.ok).toBe(true);

    const dup = applyBlockOperation(tree, { kind: "duplicate", blockId: heading.id });
    expect(dup.ok).toBe(true);

    const del = applyBlockOperation(tree, { kind: "delete", blockId: heading.id });
    expect(del.ok).toBe(true);

    const unknown = applyBlockOperation(tree, { kind: "delete", blockId: "nope" });
    expect(unknown.ok).toBe(false);
  });

  it("createBlockId produces unique ids", () => {
    const ids = new Set([createBlockId("heading"), createBlockId("heading"), createBlockId("button")]);
    expect(ids.size).toBe(3);
  });
});
