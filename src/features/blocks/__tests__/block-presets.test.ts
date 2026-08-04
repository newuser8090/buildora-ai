// ---------------------------------------------------------------------------
// Block presets tests (Phase O spec: TESTS → presets)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  getButtonPreset,
  getCardPreset,
  getImagePreset,
  listPresets,
} from "../engine/block-presets";
import { applyPresetToBlock, createBlock } from "../engine/block-operations";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../registry/block-registry";
import { validateTree } from "../engine/nesting-rules";
import type { BlockTree } from "../types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

describe("block presets", () => {
  it("lists every registered preset deterministically", () => {
    const a = listPresets();
    const b = listPresets();
    expect(a.length).toBeGreaterThanOrEqual(6 + 4 + 5);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });

  it("exposes button, image and card presets", () => {
    expect(getButtonPreset("button-primary")).toBeDefined();
    expect(getButtonPreset("button-gradient")).toBeDefined();
    expect(getImagePreset("image-circle")).toBeDefined();
    expect(getCardPreset("card-premium")).toBeDefined();
  });

  it("kind-specific lookups reject the wrong kind", () => {
    expect(getButtonPreset("card-minimal")).toBeUndefined();
    expect(getCardPreset("image-frame")).toBeUndefined();
  });

  it("applies a button preset through the operation dispatcher", () => {
    const button = createBlock("button");
    const tree: BlockTree = { rootIds: [button.id], nodes: { [button.id]: button } };
    const result = applyPresetToBlock(tree, button.id, "button-gradient");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const node = result.value.nodes[button.id];
    expect(node.props.buttonStyle).toBe("gradient");
    expect(node.style.color).toBe("#ffffff");
    expect(validateTree(result.value).valid).toBe(true);
  });

  it("applies a card preset", () => {
    const card = createBlock("card");
    const tree: BlockTree = { rootIds: [card.id], nodes: { [card.id]: card } };
    const result = applyPresetToBlock(tree, card.id, "card-glass");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes[card.id].style.borderRadius).toBe(16);
  });

  it("rejects unknown presets", () => {
    const button = createBlock("button");
    const tree: BlockTree = { rootIds: [button.id], nodes: { [button.id]: button } };
    const result = applyPresetToBlock(tree, button.id, "nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TREE");
  });

  it("rejects presets on locked blocks", () => {
    const button = createBlock("button");
    const tree: BlockTree = { rootIds: [button.id], nodes: { [button.id]: button } };
    const lockedTree = { ...tree, nodes: { [button.id]: { ...button, locked: true } } };
    const result = applyPresetToBlock(lockedTree, button.id, "button-primary");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LOCKED_BLOCK");
  });

  it("does not mutate the input tree", () => {
    const button = createBlock("button");
    const snapshot = JSON.stringify(button.style);
    const tree: BlockTree = { rootIds: [button.id], nodes: { [button.id]: button } };
    applyPresetToBlock(tree, button.id, "button-primary");
    expect(JSON.stringify(button.style)).toBe(snapshot);
  });
});
