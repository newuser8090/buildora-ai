// ---------------------------------------------------------------------------
// Nesting rules — pure validation of block tree parent/child relationships
//
// Deterministic, framework-independent, no mutation. Uses the registry's
// declarative nesting rules. Also validates the broader tree invariants
// (unique ids, parentId/children consistency, acyclic).
// ---------------------------------------------------------------------------

import { blockRegistry } from "../registry/block-registry";
import type { BlockTree, BlockType } from "../types";
import type { BlockError } from "../types";

// ---------------------------------------------------------------------------
// Pairwise check
// ---------------------------------------------------------------------------

/**
 * Can a block of `childType` be nested inside a block of `parentType`?
 * Unknown types are rejected (the registry must know every type).
 */
export function canNest(parentType: BlockType, childType: BlockType): boolean {
  const parent = blockRegistry.get(parentType);
  const child = blockRegistry.get(childType);
  if (!parent || !child) return false;
  if (!parent.nesting.allowsChildren) return false;

  const allowed = parent.nesting.allowedChildTypes;
  if (allowed === "*") return true;
  if (!allowed) return false;
  return allowed.includes(childType);
}

/** Human-readable reason when nesting is rejected (or null when allowed). */
export function nestingViolation(
  parentType: BlockType,
  childType: BlockType,
): string | null {
  const parent = blockRegistry.get(parentType);
  const child = blockRegistry.get(childType);
  if (!parent || !child) return "Unknown block type.";
  if (!parent.nesting.allowsChildren) {
    return `A "${parentType}" block cannot contain other blocks.`;
  }
  const allowed = parent.nesting.allowedChildTypes;
  if (allowed !== "*" && allowed && !allowed.includes(childType)) {
    return `A "${childType}" block cannot be placed inside a "${parentType}" block.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tree invariants
// ---------------------------------------------------------------------------

export interface NestingViolationDetail {
  blockId: string;
  type: BlockType;
  parentId: string | null;
  message: string;
}

export interface TreeValidationResult {
  valid: boolean;
  /** List of every problem found (empty when valid). */
  problems: NestingViolationDetail[];
}

/** Validate all invariants of a block tree without mutating it. */
export function validateTree(tree: BlockTree): TreeValidationResult {
  const problems: NestingViolationDetail[] = [];
  const seen = new Set<string>();

  // Every root must exist in nodes and have no parent. Roots are NOT marked
  // seen here — the walk below marks reachable nodes, so a root listed twice
  // is reported as "reachable more than once".
  for (const rootId of tree.rootIds) {
    const node = tree.nodes[rootId];
    if (!node) {
      problems.push({
        blockId: rootId,
        type: "container" as BlockType,
        parentId: null,
        message: `Root "${rootId}" is missing from the node map.`,
      });
      continue;
    }
    if (node.parentId !== null) {
      problems.push({
        blockId: rootId,
        type: node.type,
        parentId: node.parentId,
        message: `Root "${rootId}" has a parent — it must be a tree root.`,
      });
    }
  }

  // Walk every node, checking children consistency + nesting rules.
  const walk = (nodeId: string, ancestors: Set<string>): void => {
    const node = tree.nodes[nodeId];
    if (!node) {
      problems.push({
        blockId: nodeId,
        type: "container" as BlockType,
        parentId: null,
        message: `Node "${nodeId}" is referenced but missing.`,
      });
      return;
    }

    if (seen.has(nodeId)) {
      problems.push({
        blockId: nodeId,
        type: node.type,
        parentId: node.parentId,
        message: `Node "${nodeId}" is reachable more than once (cycle or duplicate reference).`,
      });
      return;
    }
    if (ancestors.has(nodeId)) {
      problems.push({
        blockId: nodeId,
        type: node.type,
        parentId: node.parentId,
        message: `Cycle detected at "${nodeId}".`,
      });
      return;
    }
    seen.add(nodeId);

    // parentId consistency.
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (!child) {
        problems.push({
          blockId: nodeId,
          type: node.type,
          parentId: node.parentId,
          message: `Block "${nodeId}" references a missing child "${childId}".`,
        });
        continue;
      }
      if (child.parentId !== nodeId) {
        problems.push({
          blockId: childId,
          type: child.type,
          parentId: child.parentId ?? null,
          message: `Child "${childId}" does not point back to its parent "${nodeId}".`,
        });
      }
      // Nesting rule check.
      const violation = nestingViolation(node.type, child.type);
      if (violation) {
        problems.push({
          blockId: childId,
          type: child.type,
          parentId: nodeId,
          message: violation,
        });
      }
      const maxChildren = blockRegistry.get(node.type)?.nesting.maxChildren;
      if (maxChildren !== undefined && node.children.length > maxChildren) {
        problems.push({
          blockId: nodeId,
          type: node.type,
          parentId: node.parentId,
          message: `A "${node.type}" block allows at most ${maxChildren} children (has ${node.children.length}).`,
        });
      }
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(nodeId);
      walk(childId, nextAncestors);
    }
  };

  for (const rootId of tree.rootIds) {
    walk(rootId, new Set());
  }

  // Any node not reachable from a root is orphaned.
  for (const id of Object.keys(tree.nodes)) {
    if (!seen.has(id)) {
      problems.push({
        blockId: id,
        type: tree.nodes[id].type,
        parentId: tree.nodes[id].parentId,
        message: `Node "${id}" is orphaned (not reachable from any root).`,
      });
    }
  }

  return { valid: problems.length === 0, problems };
}

/** Convenience: a single structured error describing the first problem. */
export function firstTreeError(tree: BlockTree): BlockError | null {
  const result = validateTree(tree);
  if (result.valid) return null;
  const p = result.problems[0];
  return { code: "INVALID_TREE", message: p.message };
}
