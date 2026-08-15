// ---------------------------------------------------------------------------
// Element normalizer (Phase P22-A) — deterministic repair
//
// Mirrors the Phase P16 collab tree-normalizer policy:
//   - deterministic  — same input ⇒ same output
//   - idempotent     — normalize(normalize(x)) === normalize(x)
//   - bounded        — depth/node/text/children caps clamp pathological input
//   - schema-safe    — output always parses the element schemas
//
// Repair policy:
//   - NEVER invent content. Invalid references are DROPPED.
//   - Duplicate ids → first wins; duplicate children → first wins.
//   - Unknown element types → node dropped (with its subtree).
//   - Invalid element metadata (geometry/animation/…) → the FIELD is dropped,
//     the node's base fields survive.
//   - Cycles broken; orphans pruned; dangling parents cleared.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import {
  ELEMENT_MAX_CHILDREN,
  ELEMENT_MAX_DEPTH,
  ELEMENT_MAX_NODES,
  ELEMENT_MAX_PROPS_KEYS,
  ELEMENT_MAX_STYLE_KEYS,
  ELEMENT_MAX_TEXT_LENGTH,
  ElementNodeSchema,
  isKnownElementType,
  isSafeElementCssValue,
} from "../schemas/element-schemas";
import type { ElementNode, ElementTree, ElementType } from "../types";

const ELEMENT_METADATA_KEYS = [
  "geometry",
  "viewport",
  "animation",
  "interaction",
  "binding",
  "a11y",
  "customCode",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

function isUnsafeKey(key: string): boolean {
  return (
    key === "__proto__" ||
    key === "prototype" ||
    key === "constructor" ||
    key === "toString" ||
    key === "valueOf"
  );
}

function clampText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > ELEMENT_MAX_TEXT_LENGTH
    ? value.slice(0, ELEMENT_MAX_TEXT_LENGTH)
    : value;
}

/** Recursively sanitize arbitrary JSON (drop unsafe keys + unsafe values + cap text). */
function sanitizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeJson).filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (isUnsafeKey(key)) continue;
      const cleaned = sanitizeJson(val);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  if (typeof value === "string") {
    // Unsafe CSS values (javascript:/expression/…) are never part of the
    // model — drop the value entirely so the boundary stays clean.
    if (!isSafeElementCssValue(value)) return undefined;
    return clampText(value) ?? "";
  }
  return value;
}

function sanitizeRecord(
  value: unknown,
  maxKeys: number,
): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, val] of Object.entries(value)) {
    if (isUnsafeKey(key)) continue;
    if (count >= maxKeys) break;
    const cleaned = sanitizeJson(val);
    if (cleaned === undefined) continue;
    out[key] = cleaned;
    count += 1;
  }
  return out;
}

function sanitizeNestedRecord(
  value: unknown,
): Record<string, Record<string, unknown>> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  let count = 0;
  for (const [bp, overrides] of Object.entries(value)) {
    if (isUnsafeKey(bp)) continue;
    if (count >= 5) break;
    const clean = sanitizeRecord(overrides, ELEMENT_MAX_STYLE_KEYS);
    if (Object.keys(clean).length > 0) out[bp] = clean;
    count += 1;
  }
  return out;
}

/** Build a valid element node from a raw record (metadata dropped on failure). */
function buildElementNode(
  raw: Record<string, unknown>,
  id: string,
  parentId: string | null,
  children: string[],
): ElementNode | null {
  const candidate: Record<string, unknown> = {
    id,
    type: (typeof raw.type === "string" && raw.type ? raw.type : "container") as ElementType,
    parentId,
    children,
    props: sanitizeRecord(raw.props, ELEMENT_MAX_PROPS_KEYS),
    style: sanitizeRecord(raw.style, ELEMENT_MAX_STYLE_KEYS),
    responsive: sanitizeNestedRecord(raw.responsive),
    visible: raw.visible !== false,
    locked: raw.locked === true,
    hidden: raw.hidden === true,
  };

  // Carry element metadata through (schema-validated below; never trusted).
  for (const key of ELEMENT_METADATA_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null) {
      candidate[key] = sanitizeJson(raw[key]);
    }
  }

  const parsed = ElementNodeSchema.safeParse(candidate);
  if (parsed.success) return parsed.data as unknown as ElementNode;

  // Invalid metadata must not take the node down: drop the metadata fields
  // and retry with the (already sanitized) base fields.
  for (const key of ELEMENT_METADATA_KEYS) {
    delete candidate[key];
  }
  const fallback = ElementNodeSchema.safeParse(candidate);
  return fallback.success ? (fallback.data as unknown as ElementNode) : null;
}

/**
 * Normalize an element tree deterministically. Returns a new tree (never
 * mutates). Returns null when nothing usable survives (not an object / no
 * roots / no nodes).
 */
export function normalizeElementTree(input: unknown): ElementTree | null {
  if (!isPlainObject(input)) return null;
  const rawRootIds = Array.isArray(input.rootIds)
    ? input.rootIds.filter((r): r is string => typeof r === "string")
    : [];
  const rawNodes = isPlainObject(input.nodes) ? input.nodes : {};

  // 1. Collect valid node records with unique ids + known types (first wins).
  const nodes = new Map<string, Record<string, unknown>>();
  for (const [id, node] of Object.entries(rawNodes)) {
    if (!isPlainObject(node) || typeof node.id !== "string") continue;
    if (!isKnownElementType(String(node.type ?? ""))) continue;
    if (nodes.has(id)) continue; // duplicate — keep first
    nodes.set(id, node);
  }

  // 2. Determine reachability from roots, breaking cycles and pruning orphans.
  const reachable = new Set<string>();
  const visit = (
    id: string,
    depth: number,
    visiting: Set<string>,
  ): void => {
    if (depth > ELEMENT_MAX_DEPTH) return;
    if (reachable.has(id)) return;
    if (visiting.has(id)) return; // cycle — break the back edge
    const node = nodes.get(id);
    if (!node) return;
    reachable.add(id);
    const nextVisiting = new Set(visiting).add(id);
    const children = Array.isArray(node.children)
      ? node.children.filter((c): c is string => typeof c === "string")
      : [];
    for (const childId of children) visit(childId, depth + 1, nextVisiting);
  };

  const seenRoots = new Set<string>();
  const rootIds: string[] = [];
  for (const rootId of rawRootIds) {
    if (seenRoots.has(rootId)) continue; // duplicate root — drop
    seenRoots.add(rootId);
    visit(rootId, 0, new Set());
    if (reachable.has(rootId)) rootIds.push(rootId);
  }
  // Promote unreferenced root candidates deterministically (by id order).
  if (rootIds.length === 0) {
    const sortedIds = [...nodes.keys()].sort();
    for (const id of sortedIds) {
      if (reachable.has(id)) continue;
      visit(id, 0, new Set());
      if (reachable.has(id)) rootIds.push(id);
    }
  }
  if (rootIds.length === 0) return null;

  // 3. Rebuild each reachable node with repaired references and bounds.
  //    `actualParent` is the node that actually references this one, so the
  //    canonical parent/child relationship is never ambiguous — a dangling
  //    raw.parentId is replaced by the true parent (or null for roots).
  //    `ancestors` carries the root→parent chain so BACK-EDGE children (the
  //    source of cycles) are dropped from children lists, not just detected.
  const normalizedNodes: Record<string, ElementNode> = {};
  let count = 0;
  const buildNode = (
    id: string,
    depth: number,
    actualParent: string | null,
    ancestors: Set<string>,
  ): void => {
    if (depth > ELEMENT_MAX_DEPTH) return;
    if (normalizedNodes[id] !== undefined) return;
    if (count >= ELEMENT_MAX_NODES) return;
    const raw = nodes.get(id);
    if (!raw) return;
    count += 1;

    const children: string[] = [];
    const rawChildren = Array.isArray(raw.children)
      ? raw.children.filter((c): c is string => typeof c === "string")
      : [];
    for (const childId of rawChildren) {
      if (children.includes(childId)) continue; // duplicate child — drop
      if (ancestors.has(childId)) continue; // back-edge — drop (cycle break)
      if (!reachable.has(childId)) continue;
      if (children.length >= ELEMENT_MAX_CHILDREN) break;
      children.push(childId);
    }

    const node = buildElementNode(raw, id, actualParent, children);
    if (node) {
      normalizedNodes[id] = node;
      const nextAncestors = new Set(ancestors).add(id);
      for (const childId of children) buildNode(childId, depth + 1, id, nextAncestors);
    }
  };

  for (const id of rootIds) {
    buildNode(id, 0, null, new Set());
  }

  if (Object.keys(normalizedNodes).length === 0) return null;

  // Recompute roots that actually survived normalization.
  const finalRootIds = rootIds.filter((id) => normalizedNodes[id] !== undefined);
  if (finalRootIds.length === 0) return null;

  return { rootIds: finalRootIds, nodes: normalizedNodes };
}

/** Normalize a single element node (repair + validate), or null. */
export function normalizeElementNode(input: unknown): ElementNode | null {
  if (!isPlainObject(input)) return null;
  const id = typeof input.id === "string" ? input.id : "";
  if (!id) return null;
  const children = Array.isArray(input.children)
    ? input.children.filter((c): c is string => typeof c === "string").slice(0, ELEMENT_MAX_CHILDREN)
    : [];
  const parentId =
    typeof input.parentId === "string" ? input.parentId : null;
  return buildElementNode(input, id, parentId, children);
}

