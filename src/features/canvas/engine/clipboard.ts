// ---------------------------------------------------------------------------
// Canvas clipboard (Phase P22-B) — copy / paste as sanitized data
//
// Copy serializes a deep clone of the selected subtrees (roots AND all
// descendants, in one flat list). Paste rebuilds the subtree by id and
// assigns FRESH ids to every pasted node — pasted elements never share
// mutable references with the originals (deep clone via JSON round-trip; the
// element model is plain JSON by design).
//
// The payload NEVER leaks internal adapter/collaboration metadata:
// `_`-prefixed internal props (bindings, section markers) are stripped, and
// the payload is validated against the element node schema on read.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementNode, ElementTree } from "@/features/elements/types";
import { createElementId, type ElementOperation } from "@/features/elements/engine/element-operations";
import { canNestElement } from "@/features/elements/engine/element-validation";
import { validateElementTree } from "@/features/elements/engine/element-validation";
import { ElementNodeSchema } from "@/features/elements/schemas/element-schemas";
import { topLevelSelection } from "./selection";

export const CANVAS_CLIPBOARD_VERSION = 1;

export interface CanvasClipboardPayload {
  version: number;
  /** Every cloned node (roots + descendants) — children reference these ids. */
  elements: ElementNode[];
  /** Bounding box size of the copied set (logical px) — used for offset. */
  width: number;
  height: number;
}

/** Props keys that must never cross the clipboard (internal adapter metadata). */
function isInternalKey(key: string): boolean {
  return key.startsWith("_");
}

function deepCloneElement(node: ElementNode): ElementNode {
  const clone = JSON.parse(JSON.stringify(node)) as ElementNode;
  const props: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clone.props)) {
    if (!isInternalKey(key)) props[key] = value;
  }
  return { ...clone, props };
}

/**
 * Serialize a selection into a clipboard payload. Only the TOP-LEVEL of the
 * selection is copied; nested descendants ride along with their parents.
 */
export function copySelection(
  tree: ElementTree,
  ids: string[],
): CanvasClipboardPayload {
  const topLevel = topLevelSelection(tree, ids);
  const elements: ElementNode[] = [];

  const cloneSubtree = (node: ElementNode, parentId: string | null): ElementNode => {
    const cloned = deepCloneElement(node);
    cloned.parentId = parentId;
    cloned.children = node.children
      .map((childId) => tree.nodes[childId])
      .filter((child): child is ElementNode => !!child)
      .map((child) => {
        const childClone = cloneSubtree(child, cloned.id);
        elements.push(childClone);
        return childClone.id;
      });
    return cloned;
  };

  const roots: ElementNode[] = [];
  for (const id of topLevel) {
    const node = tree.nodes[id];
    if (!node) continue;
    const rootClone = cloneSubtree(node, null);
    roots.push(rootClone);
    elements.push(rootClone);
  }

  // Bounding box over the copied geometry (falls back to 0 when unknown).
  const withRect = elements.filter((n) => n.geometry && typeof n.geometry.width === "number");
  const minX = withRect.length > 0 ? Math.min(...withRect.map((n) => n.geometry!.x ?? 0)) : 0;
  const minY = withRect.length > 0 ? Math.min(...withRect.map((n) => n.geometry!.y ?? 0)) : 0;
  const maxX = withRect.length > 0 ? Math.max(...withRect.map((n) => (n.geometry!.x ?? 0) + (n.geometry!.width ?? 0))) : 0;
  const maxY = withRect.length > 0 ? Math.max(...withRect.map((n) => (n.geometry!.y ?? 0) + (n.geometry!.height ?? 0))) : 0;

  return {
    version: CANVAS_CLIPBOARD_VERSION,
    elements,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Serialize a clipboard payload to JSON (bounded, never throws for valid input). */
export function serializeClipboard(payload: CanvasClipboardPayload): string {
  return JSON.stringify(payload);
}

/**
 * Parse a clipboard JSON string into a validated payload. Returns null for
 * malformed/unsupported payloads. Every element node is re-validated against
 * the element node schema so hostile clipboard data is rejected at the
 * boundary.
 */
export function parseClipboard(json: string): CanvasClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (candidate.version !== CANVAS_CLIPBOARD_VERSION) return null;
  if (!Array.isArray(candidate.elements) || candidate.elements.length === 0) return null;
  if (candidate.elements.length > 200) return null;

  const elements: ElementNode[] = [];
  for (const raw of candidate.elements) {
    const parsedNode = ElementNodeSchema.safeParse(raw);
    if (!parsedNode.success) return null;
    elements.push(parsedNode.data as unknown as ElementNode);
  }
  return {
    version: CANVAS_CLIPBOARD_VERSION,
    elements,
    width: typeof candidate.width === "number" ? candidate.width : 0,
    height: typeof candidate.height === "number" ? candidate.height : 0,
  };
}

/**
 * Build the insert ops that paste the clipboard under `targetId` with fresh
 * ids for EVERY pasted node (originals are never referenced), a sensible
 * offset (default: 24px down-right), and parent-before-child ordering.
 *
 * The engine's `insert` op inserts a single node whose children must already
 * exist — so paste emits one op PER node, in pre-order (roots first, then
 * descendants). `applyPasteOps` replays them as ONE atomic subtree merge.
 */
export function buildPasteOps(
  tree: ElementTree,
  targetId: string,
  payload: CanvasClipboardPayload,
  offset: { x: number; y: number } = { x: 24, y: 24 },
): ElementOperation[] {
  const target = tree.nodes[targetId];
  if (!target) return [];

  const byId = new Map<string, ElementNode>();
  for (const node of payload.elements) byId.set(node.id, node);

  const idMap = new Map<string, string>();
  const freshId = (originalId: string): string => {
    const existing = idMap.get(originalId);
    if (existing) return existing;
    const source = byId.get(originalId);
    const type = source?.type ?? "container";
    const next = createElementId(type);
    idMap.set(originalId, next);
    return next;
  };

  // Clone ONE node (not its subtree): children re-point to the fresh ids of
  // the descendant ops emitted by the pre-order walk below.
  const cloneNodeOnly = (node: ElementNode): ElementNode => {
    const cloned = JSON.parse(JSON.stringify(node)) as ElementNode;
    const geometry = cloned.geometry
      ? {
          ...cloned.geometry,
          x: (cloned.geometry.x ?? 0) + offset.x,
          y: (cloned.geometry.y ?? 0) + offset.y,
        }
      : undefined;
    return {
      ...cloned,
      id: freshId(node.id),
      parentId: null, // applyPasteOps re-parents
      children: node.children.filter((childId) => byId.has(childId)).map((childId) => freshId(childId)),
      geometry,
    };
  };

  const ops: ElementOperation[] = [];
  const emitSubtree = (node: ElementNode): void => {
    ops.push({ kind: "insert", parentId: targetId, element: cloneNodeOnly(node) });
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child) emitSubtree(child);
    }
  };

  for (const root of payload.elements) {
    if (root.parentId !== null) continue; // roots only (descendants ride along)
    emitSubtree(root);
  }
  return ops;
}

/**
 * Apply paste ops as ONE atomic subtree merge: every fresh node is inserted
 * into a single clone of the tree, then the whole result is validated against
 * the element registry. A failure leaves the input tree untouched. Nesting is
 * enforced at the boundary (same policy as the engine's insert op).
 */
export function applyPasteOps(
  tree: ElementTree,
  ops: ElementOperation[],
): { ok: boolean; tree?: ElementTree; error?: string; inserted?: string[] } {
  const freshNodes = new Map<string, ElementNode>();
  for (const op of ops) {
    if (op.kind === "insert") freshNodes.set(op.element.id, op.element);
  }
  if (freshNodes.size === 0) return { ok: true, tree, inserted: [] };

  // Roots are the ops not referenced as a child by any other fresh node.
  const referenced = new Set<string>();
  for (const node of freshNodes.values()) {
    for (const childId of node.children) referenced.add(childId);
  }
  const rootOps = ops.filter(
    (op) => op.kind === "insert" && !referenced.has(op.element.id),
  );

  const toInsert = new Map<string, ElementNode>();
  const inserted: string[] = [];
  for (const op of rootOps) {
    if (op.kind !== "insert") continue;
    const target = tree.nodes[op.parentId];
    if (!target) {
      return { ok: false, error: `Parent element "${op.parentId}" does not exist.` };
    }
    const rootNode = freshNodes.get(op.element.id);
    if (!rootNode) continue;
    if (tree.nodes[op.element.id] || toInsert.has(op.element.id)) {
      return { ok: false, error: `Element id "${op.element.id}" already exists.` };
    }
    if (!canNestElement(target.type, rootNode.type)) {
      return {
        ok: false,
        error: `A "${rootNode.type}" element cannot be pasted inside a "${target.type}" element.`,
      };
    }

    // Breadth-first: re-parent every fresh node under its fresh parent.
    const stack: Array<{ node: ElementNode; parentId: string | null }> = [
      { node: rootNode, parentId: op.parentId },
    ];
    while (stack.length > 0) {
      const { node, parentId } = stack.shift()!;
      if (tree.nodes[node.id] || toInsert.has(node.id)) {
        return { ok: false, error: `Element id "${node.id}" already exists.` };
      }
      toInsert.set(node.id, { ...node, parentId });
      for (const childId of node.children) {
        const child = freshNodes.get(childId);
        if (child) stack.push({ node: child, parentId: node.id });
      }
    }
    inserted.push(op.element.id);
  }

  // Merge into ONE atomic clone and validate once.
  const next: ElementTree = { rootIds: [...tree.rootIds], nodes: { ...tree.nodes } };
  for (const node of toInsert.values()) {
    next.nodes[node.id] = node;
  }
  for (const op of rootOps) {
    if (op.kind !== "insert") continue;
    next.nodes[op.parentId].children = [
      ...next.nodes[op.parentId].children,
      op.element.id,
    ];
  }
  const validation = validateElementTree(next);
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.problems[0]?.message ?? "Pasted element tree is invalid.",
    };
  }
  return { ok: true, tree: next, inserted };
}
