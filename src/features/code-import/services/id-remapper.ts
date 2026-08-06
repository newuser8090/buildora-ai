// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — ID remapping
//
// Every imported node receives NEW ids at insertion time:
//   - converter preview ids are never reused
//   - no collision with existing section/block ids
//   - the injectable factory keeps tests deterministic
//   - internal parent/child references are updated consistently
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { createConversionIdFactory, type ConversionIdFactory } from "../conversion/conversion-errors";

export interface RemapOptions {
  /** Fresh-id factory (injectable for tests). */
  idFactory?: ConversionIdFactory;
  /** Existing ids that must not be reused. */
  avoid?: ReadonlySet<string> | ReadonlyArray<string>;
  /** When set, the first root is forced to this id (used for the section root). */
  forceRootId?: string;
}

export interface RemapResult {
  tree: BlockTree;
  /** old id → new id for every remapped node. */
  oldToNew: Map<string, string>;
}

/**
 * Shared default factory so sequential default remaps never reuse ids.
 *
 * Without this, every remap call built its own factory starting at counter 0
 * ("conv-1", "conv-2", …) — inserting the SAME saved block twice produced
 * two project copies whose child ids collided. Injected factories remain
 * per-call (deterministic tests keep their independent counters).
 */
const defaultIdFactory = createConversionIdFactory();

/** Wrap an id factory so it never collides with the avoid set. */
function collisionSafeFactory(
  base: ConversionIdFactory,
  avoid: ReadonlySet<string>,
): ConversionIdFactory {
  return {
    next: (prefix?: string) => {
      let candidate = base.next(prefix);
      let guard = 0;
      while (avoid.has(candidate) && guard < 1000) {
        candidate = base.next(prefix);
        guard += 1;
      }
      return candidate;
    },
  };
}

/**
 * Remap every id in a tree with fresh ids, preserving parent/child
 * relationships. The first root is forced to `forceRootId` when provided.
 * Pure — never mutates the input tree.
 */
export function remapBlockTreeIds(
  input: BlockTree,
  options: RemapOptions = {},
): RemapResult {
  const avoid = new Set(
    (options.avoid
      ? Array.isArray(options.avoid)
        ? options.avoid
        : Array.from(options.avoid)
      : []) as string[],
  );
  const baseFactory = options.idFactory ?? defaultIdFactory;
  const factory = collisionSafeFactory(baseFactory, avoid);

  const ids = Object.keys(input.nodes);
  const oldToNew = new Map<string, string>();

  // Assign fresh ids first (deterministic order, first root forced).
  const rootIds = input.rootIds;
  rootIds.forEach((rootId, index) => {
    oldToNew.set(rootId, index === 0 && options.forceRootId ? options.forceRootId : factory.next(rootId));
  });
  for (const id of ids) {
    if (!oldToNew.has(id)) {
      oldToNew.set(id, factory.next(id));
    }
  }

  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(input.nodes)) {
    const nextId = oldToNew.get(id) ?? id;
    nodes[nextId] = {
      ...JSON.parse(JSON.stringify(node)) as BlockNode,
      id: nextId,
      parentId: node.parentId === null ? null : (oldToNew.get(node.parentId) ?? node.parentId),
      children: node.children.map((childId) => oldToNew.get(childId) ?? childId),
    };
  }

  const tree: BlockTree = {
    rootIds: rootIds.map((rootId) => oldToNew.get(rootId) ?? rootId),
    nodes,
  };

  return { tree, oldToNew };
}

/** Collect every block id in a tree (for collision checks). */
export function collectBlockTreeIds(tree: BlockTree): string[] {
  return Object.keys(tree.nodes);
}

/** Collect every section id on a page (for collision checks). */
export function collectPageSectionIds(sections: ReadonlyArray<{ id: string }>): string[] {
  return sections.map((s) => s.id);
}
