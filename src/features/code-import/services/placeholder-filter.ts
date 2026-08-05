// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — supported-parts-only filter
//
// When the user chooses "Convert supported parts only", the Review step shows
// and inserts a tree WITHOUT the empty placeholder wrappers left by parts
// Buildora could not convert (tables, iframes, unsupported embeds).
//
// Deterministic and honest: only EMPTY placeholder containers are removed —
// anything carrying text, an image/link, or meaningful styles is kept.
// ---------------------------------------------------------------------------

import type { BlockTree } from "@/features/blocks/types";
import { allNodes } from "@/features/blocks/engine/tree-traversal";
import { applyBlockOperation } from "@/features/blocks/engine/block-operations";

const CONTENT_KEYS = new Set([
  "text",
  "href",
  "src",
  "alt",
  "price",
  "label",
  "placeholder",
  "name",
  "logoText",
  "icon",
  "links",
]);

/** True when a node is an empty placeholder wrapper (safe to drop). */
export function isEmptyPlaceholder(node: {
  type: string;
  children: string[];
  style: Record<string, unknown>;
  props: Record<string, unknown>;
  parentId: string | null;
}): boolean {
  if (node.type !== "container") return false;
  if (node.children.length > 0) return false;
  if (node.parentId === null) return false; // never drop roots
  // Any user-visible content or styling means it is NOT an empty placeholder.
  for (const key of Object.keys(node.props)) {
    if (key.startsWith("_")) continue;
    if (CONTENT_KEYS.has(key)) {
      const value = node.props[key];
      if (typeof value === "string" && value.trim().length > 0) return false;
      if (typeof value === "number") return false;
      if (Array.isArray(value) && value.length > 0) return false;
    }
  }
  if (Object.keys(node.style).length > 0) return false;
  return true;
}

export interface FilterResult {
  tree: BlockTree;
  removed: number;
}

/**
 * Remove empty placeholder containers from a tree. Returns the filtered tree
 * (validated through block operations) and the number of removed nodes.
 * Falls back to the original tree when the filtered tree would be invalid.
 */
export function filterSupportedOnly(tree: BlockTree): FilterResult {
  const removals: string[] = [];
  for (const node of allNodes(tree)) {
    if (isEmptyPlaceholder(node)) removals.push(node.id);
  }
  if (removals.length === 0) {
    return { tree, removed: 0 };
  }

  let next: BlockTree = tree;
  for (const id of removals) {
    const result = applyBlockOperation(next, { kind: "delete", blockId: id });
    if (!result.ok) return { tree, removed: 0 };
    next = result.value as BlockTree;
  }
  return { tree: next, removed: removals.length };
}
