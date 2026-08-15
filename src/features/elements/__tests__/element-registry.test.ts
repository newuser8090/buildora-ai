// ---------------------------------------------------------------------------
// Element registry tests (Phase P22-A)
// Covers: element-only registration, lazy block-type derivation, first-wins
// semantics, deterministic ordering, category listing, clear(), and
// idempotent default registration.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks, blockRegistry } from "@/features/blocks/registry/block-registry";
import { ElementRegistry, elementRegistry } from "../registry/element-registry";
import { ELEMENT_ONLY_DEFINITIONS } from "../registry/default-elements";
import {
  isDefaultElementsRegistered,
  registerDefaultElements,
} from "../registry/register-default-elements";
import type { ElementCategory, ElementDefinition, ElementType } from "../types";

beforeEach(() => {
  elementRegistry.clear();
  registerDefaultBlocks();
  registerDefaultElements();
});

describe("element registry", () => {
  it("registers every element-only definition", () => {
    for (const definition of ELEMENT_ONLY_DEFINITIONS) {
      expect(elementRegistry.has(definition.type)).toBe(true);
      expect(elementRegistry.get(definition.type)?.label).toBe(definition.label);
    }
  });

  it("is idempotent and reported by isDefaultElementsRegistered", () => {
    expect(isDefaultElementsRegistered()).toBe(true);
    registerDefaultElements();
    registerDefaultElements();
    expect(elementRegistry.has("section")).toBe(true);
    expect(elementRegistry.has("text")).toBe(true);
  });

  it("derives block-type definitions lazily from the block registry", () => {
    const heading = elementRegistry.get("heading");
    expect(heading).toBeDefined();
    expect(heading?.type).toBe("heading");
    expect(heading?.label).toBe(blockRegistry.get("heading")?.label);
    // Defaults are the single source of truth — identical to the block.
    expect(heading?.createProps().text).toBe(blockRegistry.get("heading")?.createProps().text);
    expect(heading?.resizePolicy).toBe(blockRegistry.get("heading")?.resizePolicy);
  });

  it("refuses duplicate element-only registration (first wins)", () => {
    const registry = new ElementRegistry();
    const original = ELEMENT_ONLY_DEFINITIONS.find((d) => d.type === "text");
    if (!original) return;
    const impostor: ElementDefinition = {
      ...original,
      label: "Impostor text",
    };
    expect(registry.register(impostor)).toBe(true);
    expect(registry.register({ ...original, label: "Second" })).toBe(false);
    expect(registry.get("text")?.label).toBe("Impostor text");
  });

  it("refuses to register block types through the element-only path", () => {
    const registry = new ElementRegistry();
    const definition = ELEMENT_ONLY_DEFINITIONS[0];
    const block = elementRegistry.get("heading");
    if (!block) return;
    const attempt = registry.register({ ...definition, type: "heading" as ElementType });
    expect(attempt).toBe(false);
  });

  it("lists types deterministically: element-only first, then blocks", () => {
    const types = elementRegistry.types;
    expect(types).toHaveLength(ELEMENT_ONLY_DEFINITIONS.length + blockRegistry.types.length);
    expect(types).toEqual([
      ...ELEMENT_ONLY_DEFINITIONS.map((d) => d.type),
      ...blockRegistry.types,
    ]);
  });

  it("list() and listByCategory() return registered + derived definitions", () => {
    const all = elementRegistry.list();
    expect(all.length).toBeGreaterThanOrEqual(ELEMENT_ONLY_DEFINITIONS.length);

    const layout = elementRegistry.listByCategory("layout" as ElementCategory);
    expect(layout.some((d) => d.type === "section")).toBe(true);
    expect(layout.every((d) => d.category === "layout")).toBe(true);

    const media = elementRegistry.listByCategory("media" as ElementCategory);
    expect(media.some((d) => d.type === "carousel")).toBe(true);
  });

  it("clear() empties element-only definitions and the block cache", () => {
    expect(elementRegistry.has("text")).toBe(true);
    expect(elementRegistry.has("heading")).toBe(true);
    elementRegistry.clear();
    // Element-only definitions are owned by this registry — cleared.
    expect(elementRegistry.has("text")).toBe(false);
    // Block types are NOT owned here: they are always derived lazily from the
    // block registry (the single source of truth), so they remain available.
    expect(elementRegistry.has("heading")).toBe(true);
    expect(elementRegistry.get("heading")?.type).toBe("heading");
    // Element-only defaults can be re-registered (idempotent).
    registerDefaultElements();
    expect(elementRegistry.has("text")).toBe(true);
  });

  it("unknown types are absent", () => {
    expect(elementRegistry.has("gizmo")).toBe(false);
    expect(elementRegistry.get("gizmo" as ElementType)).toBeUndefined();
  });

  it("definitions expose editor metadata for the renderer direction", () => {
    const text = elementRegistry.get("text");
    expect(text?.editor?.rendererKey).toBe("text");
    expect(text?.editor?.supportsViewportOverrides).toBe(true);
    const section = elementRegistry.get("section");
    expect(section?.editor?.defaultLayout).toBe("flow");
  });
});
