// ---------------------------------------------------------------------------
// Canvas batch ops (Phase P22-B) — apply a gesture's ops atomically
//
// A single user gesture (move / resize / rotate / align / duplicate / delete /
// paste) produces ONE list of ElementOperations. This module applies them
// sequentially over the P22-A engine (never mutating the input), returning
// the final validated tree — the caller folds it back through the existing
// store boundary as ONE history entry.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementResult, ElementTree } from "@/features/elements/types";
import {
  applyElementOperation,
  type ElementOperation,
} from "@/features/elements/engine/element-operations";
import { validateElementTree } from "@/features/elements/engine/element-validation";

export interface BatchResult {
  ok: boolean;
  tree?: ElementTree;
  /** Number of ops applied before a failure (0 on immediate failure). */
  applied: number;
  error?: string;
  code?: string;
}

/**
 * Apply an ordered batch of element operations to a tree. Stops at the first
 * failure (the tree is then left untouched — callers never commit a partial
 * batch). The final tree is validated against the element registry.
 */
export function applyElementOpBatch(
  tree: ElementTree,
  ops: ElementOperation[],
): BatchResult {
  let current: ElementTree = tree;
  let applied = 0;
  for (const op of ops) {
    const result: ElementResult<ElementTree | { tree: ElementTree; newId: string }> =
      applyElementOperation(current, op);
    if (!result.ok) {
      return {
        ok: false,
        applied,
        error: result.error.message,
        code: result.error.code,
      };
    }
    const value = result.value;
    current = "tree" in value && "newId" in value ? value.tree : value;
    applied += 1;
  }
  const validation = validateElementTree(current);
  if (!validation.valid) {
    return {
      ok: false,
      applied,
      error: validation.problems[0]?.message ?? "Invalid element tree.",
      code: "ELEMENT_TREE_INVALID",
    };
  }
  return { ok: true, tree: current, applied };
}

/** True when a batch contains no ops (no commit should happen). */
export function isEmptyBatch(ops: ElementOperation[]): boolean {
  return ops.length === 0;
}
