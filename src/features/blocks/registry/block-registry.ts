// ---------------------------------------------------------------------------
// Block registry — deterministic catalogue of every registered block type
//
// Framework-independent: no React, no DOM, no store. Each block registers
// defaults, nesting rules, resize policy, editable fields, and keywords.
// Definitions are frozen on registration and duplicate registration is
// rejected (first definition wins).
// ---------------------------------------------------------------------------

import type {
  BlockCategory,
  BlockDefinition,
  BlockType,
} from "../types";
import { BLOCK_DEFINITIONS } from "./default-blocks";

export class BlockRegistry {
  private registry = new Map<BlockType, BlockDefinition>();

  register(definition: BlockDefinition): boolean {
    if (this.registry.has(definition.type)) return false;
    this.registry.set(definition.type, Object.freeze(definition));
    return true;
  }

  get(type: BlockType): BlockDefinition | undefined {
    return this.registry.get(type);
  }

  has(type: BlockType): boolean {
    return this.registry.has(type);
  }

  list(): BlockDefinition[] {
    return Array.from(this.registry.values());
  }

  listByCategory(category: BlockCategory): BlockDefinition[] {
    return this.list().filter((d) => d.category === category);
  }

  get types(): BlockType[] {
    return Array.from(this.registry.keys());
  }

  clear(): void {
    this.registry.clear();
  }
}

/** Singleton shared across the application. */
export const blockRegistry = new BlockRegistry();

/** Register every built-in block definition. Idempotent. */
export function registerDefaultBlocks(): void {
  for (const definition of BLOCK_DEFINITIONS) {
    blockRegistry.register(definition);
  }
}

/** True when the default block catalogue is already registered. */
export function isDefaultBlocksRegistered(): boolean {
  return blockRegistry.has("container") && blockRegistry.has("heading");
}
