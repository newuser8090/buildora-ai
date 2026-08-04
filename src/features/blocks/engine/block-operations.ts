// ---------------------------------------------------------------------------
// Block operations — pure, immutable tree mutations (Phase O)
//
// Every operation returns a NEW tree or a structured error. Nothing is ever
// mutated. History/undo/redo is handled by the existing editor store — these
// functions never touch persistence or store state.
//
// All operations first validate the prospective result with validateTree, so
// a malformed or nesting-invalid result can never escape.
// ---------------------------------------------------------------------------

import type { BlockNode, BlockOperation, BlockResult, BlockTree } from "../types";
import { blockRegistry } from "../registry/block-registry";
import { canNest, validateTree } from "./nesting-rules";
import { getNode, parentOf } from "./tree-traversal";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let idCounter = 0;

/** Deterministic-ish, collision-resistant block id factory. */
export function createBlockId(type: BlockNode["type"]): string {
  idCounter += 1;
  return `${type}-${Date.now().toString(36)}-${idCounter}`;
}

/** Build a fresh block node with default props/styles. */
export function createBlock(
  type: BlockNode["type"],
  options?: { id?: string; props?: Record<string, unknown>; style?: Record<string, unknown> },
): BlockNode {
  const definition = blockRegistry.get(type);
  const props = definition?.createProps() ?? {};
  const style = definition?.createStyles() ?? {};
  return {
    id: options?.id ?? createBlockId(type),
    type,
    parentId: null,
    children: [],
    props: { ...props, ...(options?.props ?? {}) },
    style: { ...style, ...(options?.style ?? {}) },
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneNode(node: BlockNode): BlockNode {
  return {
    ...node,
    props: { ...node.props },
    style: { ...node.style },
    responsive: Object.fromEntries(
      Object.entries(node.responsive).map(([bp, overrides]) => [bp, { ...overrides }]),
    ),
    children: [...node.children],
  };
}

function cloneTree(tree: BlockTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = cloneNode(node);
  }
  return { rootIds: [...tree.rootIds], nodes };
}

function validateResult(tree: BlockTree): BlockResult<BlockTree> {
  const result = validateTree(tree);
  if (!result.valid) {
    const problem = result.problems[0];
    return {
      ok: false,
      error: { code: "INVALID_TREE", message: problem.message },
    };
  }
  return { ok: true, value: tree };
}

/** Shared guard: the operation block must exist. */
function requireNode(tree: BlockTree, blockId: string): BlockResult<BlockNode> {
  const node = tree.nodes[blockId];
  if (!node) {
    return {
      ok: false,
      error: {
        code: "BLOCK_NOT_FOUND",
        message: `Block "${blockId}" does not exist in the tree.`,
      },
    };
  }
  return { ok: true, value: node };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export function insertBlock(
  tree: BlockTree,
  parentId: string,
  block: BlockNode,
  index?: number,
): BlockResult<BlockTree> {
  const parent = tree.nodes[parentId];
  if (!parent) {
    return {
      ok: false,
      error: {
        code: "TARGET_NOT_FOUND",
        message: `Parent block "${parentId}" does not exist.`,
      },
    };
  }
  if (tree.nodes[block.id]) {
    return {
      ok: false,
      error: {
        code: "BLOCK_ID_CONFLICT",
        message: `Block id "${block.id}" already exists in the tree.`,
      },
    };
  }
  if (parent.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Cannot insert into a locked block.",
      },
    };
  }
  if (!canNest(parent.type, block.type)) {
    return {
      ok: false,
      error: {
        code: "NESTING_RULE_VIOLATION",
        message: `A "${block.type}" block cannot be nested inside a "${parent.type}" block.`,
      },
    };
  }

  const next = cloneTree(tree);
  const nextParent = next.nodes[parentId];
  const normalizedIndex = index ?? nextParent.children.length;
  const childId = block.id;

  next.nodes[childId] = { ...cloneNode(block), parentId };
  nextParent.children = [
    ...nextParent.children.slice(0, normalizedIndex),
    childId,
    ...nextParent.children.slice(normalizedIndex),
  ];

  return validateResult(next);
}

export function deleteBlock(tree: BlockTree, blockId: string): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;

  const parent = parentOf(tree, blockId);
  const next = cloneTree(tree);
  delete next.nodes[blockId];

  if (parent) {
    next.nodes[parent.id].children = next.nodes[parent.id].children.filter(
      (c) => c !== blockId,
    );
  } else {
    next.rootIds = next.rootIds.filter((r) => r !== blockId);
  }

  // Remove orphaned descendants (they become unreachable → validateTree would
  // report them as orphans; pruning them keeps the result valid).
  const stack = [...(tree.nodes[blockId]?.children ?? [])];
  while (stack.length > 0) {
    const current = stack.shift() ?? "";
    if (next.nodes[current]) {
      delete next.nodes[current];
      stack.unshift(...(tree.nodes[current]?.children ?? []));
    }
  }

  return validateResult(next);
}

export function duplicateBlock(
  tree: BlockTree,
  blockId: string,
): BlockResult<{ tree: BlockTree; newId: string }> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;

  const source = nodeResult.value;
  if (source.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Locked blocks cannot be duplicated.",
      },
    };
  }

  const parent = parentOf(tree, blockId);

  // Build the deep-cloned subtree in isolation first: map old ids → fresh ids,
  // then clone nodes with remapped children/parent references.
  const idMap = new Map<string, string>();
  const collectIds = (node: BlockNode): void => {
    idMap.set(node.id, createBlockId(node.type));
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) collectIds(child);
    }
  };
  collectIds(source);

  const clonedNodes = new Map<string, BlockNode>();
  const cloneSubtree = (node: BlockNode): BlockNode => {
    const cloned: BlockNode = {
      ...cloneNode(node),
      id: idMap.get(node.id) ?? createBlockId(node.type),
      parentId: idMap.get(node.parentId ?? "") ?? node.parentId,
      children: node.children.map((c) => idMap.get(c) ?? createBlockId("container")),
    };
    clonedNodes.set(cloned.id, cloned);
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) cloneSubtree(child);
    }
    return cloned;
  };
  const cloned = cloneSubtree(source);

  // Merge the isolated subtree into a fresh clone of the original tree.
  const next = cloneTree(tree);
  for (const [id, node] of clonedNodes) {
    next.nodes[id] = node;
  }

  // Root-level duplicate or sibling under parent.
  if (parent) {
    const index = next.nodes[parent.id].children.indexOf(blockId);
    next.nodes[parent.id].children = [
      ...next.nodes[parent.id].children.slice(0, index + 1),
      cloned.id,
      ...next.nodes[parent.id].children.slice(index + 1),
    ];
  } else {
    const index = next.rootIds.indexOf(blockId);
    next.rootIds = [
      ...next.rootIds.slice(0, index + 1),
      cloned.id,
      ...next.rootIds.slice(index + 1),
    ];
  }

  const result = validateResult(next);
  if (!result.ok) return result;
  return { ok: true, value: { tree: result.value, newId: cloned.id } };
}

export function moveBlock(
  tree: BlockTree,
  blockId: string,
  toParentId: string,
  toIndex?: number,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;

  const node = nodeResult.value;
  if (node.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Locked blocks cannot be moved.",
      },
    };
  }
  if (!tree.nodes[toParentId]) {
    return {
      ok: false,
      error: {
        code: "TARGET_NOT_FOUND",
        message: `Target parent "${toParentId}" does not exist.`,
      },
    };
  }

  // Cannot move a node into its own descendant (would create a cycle).
  const isDescendant = node.children.some((c) => {
    let current: BlockNode | undefined = tree.nodes[c];
    while (current) {
      if (current.id === toParentId) return true;
      current = current.parentId !== null ? tree.nodes[current.parentId] : undefined;
    }
    return false;
  });
  if (isDescendant) {
    return {
      ok: false,
      error: {
        code: "NESTING_RULE_VIOLATION",
        message: "A block cannot be moved into one of its own children.",
      },
    };
  }

  const targetParent = tree.nodes[toParentId];
  if (targetParent.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Cannot move into a locked block.",
      },
    };
  }
  if (!canNest(targetParent.type, node.type)) {
    return {
      ok: false,
      error: {
        code: "NESTING_RULE_VIOLATION",
        message: `A "${node.type}" block cannot be nested inside a "${targetParent.type}" block.`,
      },
    };
  }

  const next = cloneTree(tree);
  const oldParentId = node.parentId;

  // Detach from the old parent (or roots).
  if (oldParentId !== null && next.nodes[oldParentId]) {
    next.nodes[oldParentId].children = next.nodes[oldParentId].children.filter(
      (c) => c !== blockId,
    );
  } else {
    next.rootIds = next.rootIds.filter((r) => r !== blockId);
  }

  // Attach under the new parent.
  next.nodes[blockId] = { ...next.nodes[blockId], parentId: toParentId };
  const index = toIndex ?? next.nodes[toParentId].children.length;
  next.nodes[toParentId].children = [
    ...next.nodes[toParentId].children.slice(0, index),
    blockId,
    ...next.nodes[toParentId].children.slice(index),
  ];

  return validateResult(next);
}

export function setBlockLocked(
  tree: BlockTree,
  blockId: string,
  locked: boolean,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;
  const next = cloneTree(tree);
  next.nodes[blockId] = { ...next.nodes[blockId], locked };
  return validateResult(next);
}

export function setBlockHidden(
  tree: BlockTree,
  blockId: string,
  hidden: boolean,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;
  const next = cloneTree(tree);
  next.nodes[blockId] = { ...next.nodes[blockId], hidden };
  return validateResult(next);
}

export function setBlockVisible(
  tree: BlockTree,
  blockId: string,
  visible: boolean,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;
  const next = cloneTree(tree);
  next.nodes[blockId] = { ...next.nodes[blockId], visible };
  return validateResult(next);
}

export function renameBlock(
  tree: BlockTree,
  blockId: string,
  label: string,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;
  const trimmed = label.trim();
  const next = cloneTree(tree);
  next.nodes[blockId] = {
    ...next.nodes[blockId],
    props: { ...next.nodes[blockId].props, name: trimmed },
  };
  return validateResult(next);
}

export function updateBlockProps(
  tree: BlockTree,
  blockId: string,
  props: Record<string, unknown>,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Locked blocks cannot be edited.",
      },
    };
  }
  const next = cloneTree(tree);
  next.nodes[blockId] = {
    ...next.nodes[blockId],
    props: { ...next.nodes[blockId].props, ...props },
  };
  return validateResult(next);
}

export function updateBlockStyle(
  tree: BlockTree,
  blockId: string,
  style: Record<string, unknown>,
): BlockResult<BlockTree> {
  const nodeResult = requireNode(tree, blockId);
  if (!nodeResult.ok) return nodeResult;
  if (nodeResult.value.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Locked blocks cannot be edited.",
      },
    };
  }
  const next = cloneTree(tree);
  next.nodes[blockId] = {
    ...next.nodes[blockId],
    style: { ...next.nodes[blockId].style, ...style },
  };
  return validateResult(next);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Apply a single BlockOperation immutably. Returns the new tree (validated)
 * or a structured error. History/undo/redo belong to the caller's store.
 */
export function applyBlockOperation(
  tree: BlockTree,
  operation: BlockOperation,
): BlockResult<BlockTree | { tree: BlockTree; newId: string }> {
  switch (operation.kind) {
    case "insert":
      return insertBlock(tree, operation.parentId, operation.block, operation.index);
    case "delete":
      return deleteBlock(tree, operation.blockId);
    case "duplicate":
      return duplicateBlock(tree, operation.blockId);
    case "move":
      return moveBlock(tree, operation.blockId, operation.toParentId, operation.toIndex);
    case "lock":
      return setBlockLocked(tree, operation.blockId, operation.locked);
    case "hide":
      return setBlockHidden(tree, operation.blockId, operation.hidden);
    case "set-visible":
      return setBlockVisible(tree, operation.blockId, operation.visible);
    case "rename":
      return renameBlock(tree, operation.blockId, operation.label);
    case "update-props":
      return updateBlockProps(tree, operation.blockId, operation.props);
    case "update-style":
      return updateBlockStyle(tree, operation.blockId, operation.style);
    case "apply-preset": {
      const block = getNode(tree, operation.blockId);
      if (!block) {
        return {
          ok: false,
          error: {
            code: "BLOCK_NOT_FOUND",
            message: `Block "${operation.blockId}" does not exist.`,
          },
        };
      }
      return applyPresetToBlock(tree, operation.blockId, operation.presetId);
    }
    default:
      return {
        ok: false,
        error: { code: "INVALID_TREE", message: "Unknown block operation." },
      };
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

import { getButtonPreset, getCardPreset, getImagePreset, listPresets } from "./block-presets";

/** Apply a named preset's style/prop overrides to a block. */
export function applyPresetToBlock(
  tree: BlockTree,
  blockId: string,
  presetId: string,
): BlockResult<BlockTree> {
  const node = getNode(tree, blockId);
  if (!node) {
    return {
      ok: false,
      error: {
        code: "BLOCK_NOT_FOUND",
        message: `Block "${blockId}" does not exist.`,
      },
    };
  }
  if (node.locked) {
    return {
      ok: false,
      error: {
        code: "LOCKED_BLOCK",
        message: "Locked blocks cannot be restyled.",
      },
    };
  }
  const preset =
    getButtonPreset(presetId) ?? getCardPreset(presetId) ?? getImagePreset(presetId);
  if (!preset) {
    return {
      ok: false,
      error: {
        code: "INVALID_TREE",
        message: `Unknown preset "${presetId}".`,
      },
    };
  }
  const next = cloneTree(tree);
  next.nodes[blockId] = {
    ...next.nodes[blockId],
    style: { ...next.nodes[blockId].style, ...preset.applyStyles },
    props: { ...next.nodes[blockId].props, ...(preset.applyProps ?? {}) },
  };
  return validateResult(next);
}

/** List every registered preset (for the block library "Presets" chips). */
export function allPresets() {
  return listPresets();
}
