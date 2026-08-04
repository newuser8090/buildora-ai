// ---------------------------------------------------------------------------
// Tree traversal — pure read helpers over a BlockTree
//
// No mutation, no store. Deterministic ordering follows node.children order.
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "../types";

/** Resolve a node, or undefined. */
export function getNode(tree: BlockTree, id: string): BlockNode | undefined {
  return tree.nodes[id];
}

/** True when a node exists in the tree. */
export function hasNode(tree: BlockTree, id: string): boolean {
  return id in tree.nodes;
}

/** Parent node of a node (undefined for roots/orphans). */
export function parentOf(tree: BlockTree, id: string): BlockNode | undefined {
  const node = tree.nodes[id];
  if (!node || node.parentId === null) return undefined;
  return tree.nodes[node.parentId];
}

/** Ordered list of a node's children. */
export function childrenOf(tree: BlockTree, id: string): BlockNode[] {
  const node = tree.nodes[id];
  if (!node) return [];
  return node.children.map((childId) => tree.nodes[childId]).filter(Boolean);
}

/** Root nodes in order. */
export function rootsOf(tree: BlockTree): BlockNode[] {
  return tree.rootIds.map((id) => tree.nodes[id]).filter(Boolean);
}

/** All descendants of a node in depth-first order (excludes the node itself). */
export function descendantsOf(tree: BlockTree, id: string): BlockNode[] {
  const result: BlockNode[] = [];
  const stack = [...(tree.nodes[id]?.children ?? [])];
  while (stack.length > 0) {
    const current = tree.nodes[stack.shift() ?? ""];
    if (!current) continue;
    result.push(current);
    stack.unshift(...current.children);
  }
  return result;
}

/** Count of every node in the tree (roots + descendants). */
export function nodeCount(tree: BlockTree): number {
  let count = 0;
  const visit = (node: BlockNode): void => {
    count += 1;
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) visit(child);
    }
  };
  for (const root of rootsOf(tree)) visit(root);
  return count;
}

/** Depth of a node (root = 0). Returns -1 when missing. */
export function depthOf(tree: BlockTree, id: string): number {
  let depth = 0;
  let current = tree.nodes[id];
  while (current && current.parentId !== null) {
    depth += 1;
    current = tree.nodes[current.parentId];
  }
  return current ? depth : -1;
}

/** All visible (unlocked) ancestor ids of a node, closest first. */
export function ancestorIdsOf(tree: BlockTree, id: string): string[] {
  const result: string[] = [];
  let current = tree.nodes[id];
  while (current && current.parentId !== null) {
    result.push(current.parentId);
    current = tree.nodes[current.parentId];
  }
  return result;
}

/** Ordered list of every node in depth-first order (roots first). */
export function allNodes(tree: BlockTree): BlockNode[] {
  const result: BlockNode[] = [];
  const visit = (node: BlockNode): void => {
    result.push(node);
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) visit(child);
    }
  };
  for (const root of rootsOf(tree)) visit(root);
  return result;
}

/** Find the root id that owns a node (its section container). */
export function rootIdOf(tree: BlockTree, id: string): string | null {
  let current = tree.nodes[id];
  if (!current) return null;
  while (current.parentId !== null) {
    current = tree.nodes[current.parentId];
    if (!current) return null;
  }
  return current.id;
}

/** True when a node is a leaf (has no children). */
export function isLeaf(tree: BlockTree, id: string): boolean {
  const node = tree.nodes[id];
  return node ? node.children.length === 0 : false;
}

/** True when a node is an ancestor of another (or the same node). */
export function isAncestorOrSelf(
  tree: BlockTree,
  ancestorId: string,
  nodeId: string,
): boolean {
  let current: BlockNode | undefined = tree.nodes[nodeId];
  while (current) {
    if (current.id === ancestorId) return true;
    current = current.parentId !== null ? tree.nodes[current.parentId] : undefined;
  }
  return false;
}
