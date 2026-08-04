// ---------------------------------------------------------------------------
// Block registry tests (Phase O spec: TESTS → registry)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  blockRegistry,
  registerDefaultBlocks,
  isDefaultBlocksRegistered,
} from "../registry/block-registry";
import { ALL_BLOCK_TYPES } from "../registry/default-blocks";
import { blockCategoryOf } from "../types";

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

describe("block registry", () => {
  it("registers every default block type", () => {
    for (const type of ALL_BLOCK_TYPES) {
      expect(blockRegistry.has(type)).toBe(true);
    }
  });

  it("every definition has a label, description, iconKey and nesting rules", () => {
    for (const def of blockRegistry.list()) {
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.iconKey.length).toBeGreaterThan(0);
      expect(typeof def.nesting.allowsChildren).toBe("boolean");
      expect(def.resizePolicy).toBeDefined();
    }
  });

  it("createProps/createStyles return fresh objects per call (no shared refs)", () => {
    const def = blockRegistry.get("heading")!;
    const a = def.createProps();
    const b = def.createProps();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    a.text = "mutated";
    expect(b.text).not.toBe("mutated");
  });

  it("listing is deterministic (same order every call)", () => {
    const first = blockRegistry.list().map((d) => d.type);
    const second = blockRegistry.list().map((d) => d.type);
    expect(first).toEqual(second);
    expect(first.length).toBe(ALL_BLOCK_TYPES.length);
  });

  it("unknown types are not registered", () => {
    expect(blockRegistry.has("widget" as never)).toBe(false);
  });

  it("category classification is consistent for every block", () => {
    for (const type of ALL_BLOCK_TYPES) {
      expect(blockCategoryOf(type)).toBe(blockRegistry.get(type)!.category);
    }
  });

  it("duplicate registration is rejected (first wins)", () => {
    const before = blockRegistry.list().length;
    // Re-registering the same definition object is a no-op.
    blockRegistry.register(blockRegistry.get("container")!);
    expect(blockRegistry.list().length).toBe(before);
  });

  it("every layout block declares allowedChildTypes when it allows children", () => {
    for (const def of blockRegistry.listByCategory("layout")) {
      if (def.nesting.allowsChildren) {
        expect(def.nesting.allowedChildTypes).toBeDefined();
      }
    }
  });
});
