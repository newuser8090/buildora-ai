// ---------------------------------------------------------------------------
// Element validation (Phase P22-A) — registry-aware tree validation
//
// Mirrors the Phase O nesting-rules validator but resolves types through the
// ELEMENT registry (block types + element-only families), so element-only
// types can be nested and validated without touching the block engine.
//
// Every validated tree also runs the structural + field schemas
// (element-schemas.ts) so malformed element data can never escape.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import { elementRegistry } from "../registry/element-registry";
import { ElementNodeSchema } from "../schemas/element-schemas";
import type { ElementError, ElementNode, ElementTree, ElementType } from "../types";

/** Field-only node schema (skips the static type refine — registry is live). */
const ElementNodeFieldsSchema = ElementNodeSchema.omit({ type: true });

// ---------------------------------------------------------------------------
// Pairwise nesting
// ---------------------------------------------------------------------------

/** Can an element of `childType` be nested inside `parentType`? */
export function canNestElement(
  parentType: ElementType,
  childType: ElementType,
): boolean {
  const parent = elementRegistry.get(parentType);
  const child = elementRegistry.get(childType);
  if (!parent || !child) return false;
  if (!parent.canHaveChildren) return false;

  const allowed = parent.nesting.allowedChildTypes;
  if (allowed === "*") return true;
  if (!allowed) return false;
  return allowed.includes(childType);
}

/** Human-readable reason when nesting is rejected (or null when allowed). */
export function nestingViolationElement(
  parentType: ElementType,
  childType: ElementType,
): string | null {
  const parent = elementRegistry.get(parentType);
  const child = elementRegistry.get(childType);
  if (!parent) return `Unknown element type "${parentType}".`;
  if (!child) return `Unknown element type "${childType}".`;
  if (!parent.canHaveChildren) {
    return `A "${parentType}" element cannot contain other elements.`;
  }
  const allowed = parent.nesting.allowedChildTypes;
  if (allowed !== "*" && allowed && !allowed.includes(childType)) {
    return `A "${childType}" element cannot be placed inside a "${parentType}" element.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tree invariants
// ---------------------------------------------------------------------------

export interface ElementValidationProblem {
  elementId: string;
  type: string;
  parentId: string | null;
  message: string;
}

export interface ElementValidationResult {
  valid: boolean;
  problems: ElementValidationProblem[];
}

/** Validate every invariant of an element tree without mutating it. */
export function validateElementTree(tree: ElementTree): ElementValidationResult {
  const problems: ElementValidationProblem[] = [];
  const seen = new Set<string>();

  for (const rootId of tree.rootIds) {
    const node = tree.nodes[rootId];
    if (!node) {
      problems.push({
        elementId: rootId,
        type: "container",
        parentId: null,
        message: `Root "${rootId}" is missing from the node map.`,
      });
      continue;
    }
    if (node.parentId !== null) {
      problems.push({
        elementId: rootId,
        type: node.type,
        parentId: node.parentId,
        message: `Root "${rootId}" has a parent — it must be a tree root.`,
      });
    }
  }

  const walk = (nodeId: string, ancestors: Set<string>): void => {
    const node = tree.nodes[nodeId];
    if (!node) {
      problems.push({
        elementId: nodeId,
        type: "container",
        parentId: null,
        message: `Element "${nodeId}" is referenced but missing.`,
      });
      return;
    }

    if (seen.has(nodeId)) {
      problems.push({
        elementId: nodeId,
        type: node.type,
        parentId: node.parentId,
        message: `Element "${nodeId}" is reachable more than once (cycle or duplicate reference).`,
      });
      return;
    }
    if (ancestors.has(nodeId)) {
      problems.push({
        elementId: nodeId,
        type: node.type,
        parentId: node.parentId,
        message: `Cycle detected at "${nodeId}".`,
      });
      return;
    }
    seen.add(nodeId);

    // Type registration (live registry).
    if (!elementRegistry.has(node.type)) {
      problems.push({
        elementId: nodeId,
        type: node.type,
        parentId: node.parentId,
        message: `Element "${nodeId}" has unknown type "${node.type}".`,
      });
    }

    // Field-level validation (structure + safety + bounds).
    const fields = ElementNodeFieldsSchema.safeParse(node);
    if (!fields.success) {
      const issue = fields.error.issues[0];
      problems.push({
        elementId: nodeId,
        type: node.type,
        parentId: node.parentId,
        message: `Element "${nodeId}" failed validation: ${
          issue ? (issue.path.length > 0 ? issue.path.join(".") + ": " : "") + issue.message : "invalid data"
        }`,
      });
    }

    // Children consistency + nesting rules.
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (!child) {
        problems.push({
          elementId: nodeId,
          type: node.type,
          parentId: node.parentId,
          message: `Element "${nodeId}" references a missing child "${childId}".`,
        });
        continue;
      }
      if (child.parentId !== nodeId) {
        problems.push({
          elementId: childId,
          type: child.type,
          parentId: child.parentId ?? null,
          message: `Child "${childId}" does not point back to its parent "${nodeId}".`,
        });
      }
      const violation = nestingViolationElement(node.type, child.type);
      if (violation) {
        problems.push({
          elementId: childId,
          type: child.type,
          parentId: nodeId,
          message: violation,
        });
      }
      const maxChildren = elementRegistry.get(node.type)?.nesting.maxChildren;
      if (maxChildren !== undefined && node.children.length > maxChildren) {
        problems.push({
          elementId: nodeId,
          type: node.type,
          parentId: node.parentId,
          message: `A "${node.type}" element allows at most ${maxChildren} children (has ${node.children.length}).`,
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

  for (const id of Object.keys(tree.nodes)) {
    if (!seen.has(id)) {
      problems.push({
        elementId: id,
        type: tree.nodes[id].type,
        parentId: tree.nodes[id].parentId,
        message: `Element "${id}" is orphaned (not reachable from any root).`,
      });
    }
  }

  return { valid: problems.length === 0, problems };
}

/** Convenience: a single structured error describing the first problem. */
export function firstElementTreeError(tree: ElementTree): ElementError | null {
  const result = validateElementTree(tree);
  if (result.valid) return null;
  const p = result.problems[0];
  return {
    code: "ELEMENT_TREE_INVALID",
    message: p.message,
  };
}

/** Validate a single element node against the full schema (typed refine). */
export function validateElementNode(node: unknown): node is ElementNode {
  return ElementNodeSchema.safeParse(node).success;
}
