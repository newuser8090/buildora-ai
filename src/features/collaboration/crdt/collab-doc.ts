// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — Y.Doc ↔ Project bridge
//
// One Y.Doc per workspace project is the live collaborative source of truth.
// This module owns the mapping between the canonical Project payload and the
// CRDT document:
//
//   initFromProject   — build/replace the doc from a canonical Project
//   toProject         — pure projection Y.Doc → normalized Project
//   reconcileProject  — apply a local next-Project as minimal Yjs ops in ONE
//                       transaction (origin supplied by the caller)
//   projectFromDoc    — alias of toProject (used by consumers)
//
// Representation rules (architecture §8/§9/§13):
//   - every JSON object   → Y.Map
//   - every JSON array    → Y.Array
//   - every JSON string   → Y.Text  (character-level CRDT merge)
//   - numbers/booleans    → plain scalars
//   - null / undefined    → omitted
//   - identity fields (page/section/block/asset ids) are preserved as scalars
//     inside their Y.Map; arrays of objects are diffed by stable id when the
//     elements carry one (pages, sections, assets, block nodes).
//
// Idempotence: reconcile(doc, toProject(doc)) applies zero ops.
// ---------------------------------------------------------------------------

import * as Y from "yjs";
import type { Project } from "@/types/project";
import { normalizeProject } from "./tree-normalizer";
import { diffText, applyTextDiffToYText } from "./text-diff";

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

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

/** Stable element id for array diffing (null when the element has none). */
function elementId(value: unknown): string | null {
  if (isPlainObject(value) && typeof value.id === "string" && value.id) {
    return value.id;
  }
  return null;
}

/**
 * Read the id of a LIVE Yjs element (a Y.Map whose "id" key holds a scalar or
 * Y.Text). The JSON snapshot path uses `elementId`; live elements are Y.Map
 * instances, so `.id` is not a property — it must be read via map.get() and
 * unwrapped from Y.Text. Without this, by-id array alignment never finds an
 * existing element and rebuilds the whole subtree, which destroys Yjs
 * mergeability (concurrent edits to the same subtree get lost).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function liveElementId(el: any): string | null {
  if (el instanceof Y.Map) {
    const id = el.get("id");
    if (typeof id === "string" && id) return id;
    if (id instanceof Y.Text) {
      const text = id.toString();
      return text || null;
    }
    return null;
  }
  return elementId(el);
}

/** True when every element of the array carries a unique non-empty id. */
function isIdArray(values: unknown[]): boolean {
  if (values.length === 0) return false;
  const seen = new Set<string>();
  for (const value of values) {
    const id = elementId(value);
    if (id === null || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// ---------------------------------------------------------------------------
// JSON → Yjs (fresh builders; used for inserts and init)
// ---------------------------------------------------------------------------

function jsonToYjs(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    for (const item of value) arr.push([jsonToYjs(item)]);
    return arr;
  }
  if (isPlainObject(value)) {
    const map = new Y.Map<unknown>();
    for (const [key, val] of Object.entries(value)) {
      if (isUnsafeKey(key)) continue;
      if (val === null || val === undefined) continue;
      map.set(key, jsonToYjs(val));
    }
    return map;
  }
  if (typeof value === "string") {
    const text = new Y.Text();
    text.insert(0, value);
    return text;
  }
  return value; // number | boolean
}

// ---------------------------------------------------------------------------
// Yjs → JSON (pure read; used for projection and current-state diffs)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function yjsToJson(value: any): unknown {
  if (value instanceof Y.Map) {
    const out: Record<string, unknown> = {};
    value.forEach((child, key) => {
      if (isUnsafeKey(key)) return;
      out[key] = yjsToJson(child);
    });
    return out;
  }
  if (value instanceof Y.Array) {
    return value.toArray().map((item) => yjsToJson(item));
  }
  if (value instanceof Y.Text) {
    return value.toString();
  }
  return value; // scalar
}

// ---------------------------------------------------------------------------
// Deep sync (minimal ops)
// ---------------------------------------------------------------------------

/**
 * Make `yvalue`'s subtree equal to `target` by applying minimal Yjs operations.
 * `currentJson` is the yjsToJson snapshot of `yvalue` (avoids repeated reads).
 */
function syncInto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yvalue: any,
  currentJson: unknown,
  target: unknown,
): void {
  // Array → Y.Array
  if (Array.isArray(target)) {
    if (yvalue instanceof Y.Array) {
      syncArray(yvalue, currentJson, target);
    } else {
      replaceYValue(yvalue, () => jsonToYjs(target));
    }
    return;
  }
  // Object → Y.Map
  if (isPlainObject(target)) {
    if (yvalue instanceof Y.Map) {
      syncMap(yvalue, currentJson, target);
    } else {
      replaceYValue(yvalue, () => jsonToYjs(target));
    }
    return;
  }
  // String → Y.Text (character-level merge)
  if (typeof target === "string") {
    if (yvalue instanceof Y.Text) {
      const op = diffText(yvalue.toString(), target);
      applyTextDiffToYText(yvalue, op);
    } else {
      replaceYValue(yvalue, () => {
        const text = new Y.Text();
        text.insert(0, target);
        return text;
      });
    }
    return;
  }
  // Scalars (number | boolean)
  if (yvalue !== target) {
    replaceYValue(yvalue, () => target);
  }
}

/**
 * Replace the value at yvalue's parent/key. Yjs requires removing the old node
 * and setting/inserting the new one at the same position.
 */
function replaceYValue(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yvalue: any,
  build: () => unknown,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parent = yvalue?.parent as any;
  const index = yvalue?.parentSub ?? null;
  if (!parent) return;
  if (parent instanceof Y.Map) {
    parent.set(index as string, build());
  } else if (parent instanceof Y.Array) {
    const at = index as number;
    parent.delete(at, 1);
    parent.insert(at, [build()]);
  }
}

/** Sync a Y.Map's keys to match `target` (add/update/remove). */
function syncMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ymap: any,
  currentJson: unknown,
  target: Record<string, unknown>,
): void {
  const current =
    isPlainObject(currentJson) ? currentJson : {};

  // Remove keys absent from target.
  for (const key of [...currentJsonKeys(current)]) {
    if (!(key in target) || isUnsafeKey(key)) {
      ymap.delete(key);
    }
  }
  // Add/update keys present in target.
  for (const [key, targetValue] of Object.entries(target)) {
    if (isUnsafeKey(key)) continue;
    if (targetValue === null || targetValue === undefined) {
      if (key in current) ymap.delete(key);
      continue;
    }
    const ychild = ymap.get(key);
    if (ychild === undefined || ychild === null) {
      ymap.set(key, jsonToYjs(targetValue));
    } else {
      syncInto(ychild, current[key], targetValue);
    }
  }
}

function currentJsonKeys(current: Record<string, unknown>): string[] {
  return Object.keys(current);
}

/**
 * Sync a Y.Array to match `target`. Arrays of objects with stable ids are
 * diffed by id (insert/delete/move — concurrent inserts both survive in
 * deterministic order). Other arrays (nav links, feature lists, plan lists,
 * faq items, …) are diffed by position: in-place element sync when lengths
 * match, tail insert/remove when they differ.
 */
function syncArray(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yarray: any,
  currentJson: unknown,
  target: unknown[],
): void {
  const current = Array.isArray(currentJson) ? currentJson : [];

  if (isIdArray(current) || isIdArray(target)) {
    syncArrayById(yarray, current, target);
    return;
  }
  syncArrayByPosition(yarray, current, target);
}

function syncArrayById(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yarray: any,
  current: unknown[],
  target: unknown[],
): void {
  // 1. Build current id → index map.
  const currentById = new Map<string, number>();
  current.forEach((value, index) => {
    const id = elementId(value);
    if (id !== null) currentById.set(id, index);
  });

  // 2. Delete current elements whose id is not in target (backwards).
  const targetIds = new Set<string>();
  for (const value of target) {
    const id = elementId(value);
    if (id !== null) targetIds.add(id);
  }
  for (let i = current.length - 1; i >= 0; i -= 1) {
    const id = elementId(current[i]);
    if (id === null || !targetIds.has(id)) {
      yarray.delete(i, 1);
    }
  }

  // 3. Align order + sync content. Track cursor over the live array; move
  // out-of-order elements to the cursor position.
  let cursor = 0;
  const liveIndex = (id: string | null): number => {
    if (id === null) return -1;
    const arr = yarray.toArray();
    for (let i = cursor; i < arr.length; i += 1) {
      const el = arr[i];
      if (liveElementId(el) === id) return i;
    }
    for (let i = 0; i < cursor && i < arr.length; i += 1) {
      const el = arr[i];
      if (liveElementId(el) === id) return i;
    }
    return -1;
  };

  for (const targetValue of target) {
    const id = elementId(targetValue);
    let li = id === null ? -1 : liveIndex(id);
    if (li === -1) {
      // Insert the missing element at the cursor.
      yarray.insert(cursor, [jsonToYjs(targetValue)]);
      cursor += 1;
      continue;
    }
    if (li > cursor) {
      // Out of order → move to cursor. Yjs v13 CANNOT re-insert an already
      // integrated type (its _prelimContent is nulled on first integration, so
      // delete → re-insert of the same live element throws "Cannot read
      // properties of null"). The move therefore rebuilds the element from its
      // CURRENT (already merged) content — identical content, fresh structs.
      // Concurrent edits to OTHER elements still merge normally; edits inside
      // the moved element follow the documented delete-wins structural policy.
      const movedJson = yjsToJson(yarray.get(li));
      yarray.delete(li, 1);
      yarray.insert(cursor, [jsonToYjs(movedJson)]);
      li = cursor;
    }
    // Sync content in place.
    const ychild = yarray.get(li);
    const currentChild = current[currentById.get(id ?? "") ?? -1];
    syncInto(ychild, currentChild, targetValue);
    cursor += 1;
  }
}

function syncArrayByPosition(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  yarray: any,
  current: unknown[],
  target: unknown[],
): void {
  const common = Math.min(current.length, target.length);
  // In-place sync of the shared prefix.
  for (let i = 0; i < common; i += 1) {
    syncInto(yarray.get(i), current[i], target[i]);
  }
  if (target.length > current.length) {
    for (let i = common; i < target.length; i += 1) {
      yarray.insert(i, [jsonToYjs(target[i])]);
    }
  } else if (target.length < current.length) {
    yarray.delete(common, current.length - common);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const COLLAB_DOC_ROOT = "project";

/**
 * Build (or fully replace) the document from a canonical Project. Used on open,
 * version restore, and import. Runs in one transaction with the given origin.
 */
export function initFromProject(
  doc: Y.Doc,
  project: Project,
  origin: unknown = "collab-init",
): void {
  const root = doc.getMap(COLLAB_DOC_ROOT);
  doc.transact(() => {
    root.clear();
    // Iterate the SOURCE project's entries (never a Y.Map's own properties) and
    // set each converted value directly into the root map.
    for (const [key, value] of Object.entries(project)) {
      if (isUnsafeKey(key)) continue;
      if (value === null || value === undefined) continue;
      root.set(key, jsonToYjs(value));
    }
  }, origin);
}

/**
 * Project the document to a normalized canonical Project. Deterministic and
 * idempotent. Does NOT throw — the normalizer repairs references and clamps
 * bounds; schema validation is the caller's boundary decision.
 */
export function toProject(doc: Y.Doc): Project {
  const root = doc.getMap(COLLAB_DOC_ROOT);
  const json = yjsToJson(root);
  return normalizeProject(json);
}

/** Alias used by consumers that think in terms of "projecting the doc". */
export function projectFromDoc(doc: Y.Doc): Project {
  return toProject(doc);
}

/**
 * Apply a local `nextProject` to the document as minimal operations in ONE
 * transaction with the given origin (the collab session passes its local
 * origin so Y.UndoManager captures it and remote clients never do).
 */
export function reconcileProject(
  doc: Y.Doc,
  nextProject: Project,
  origin: unknown = "collab-local",
): void {
  const root = doc.getMap(COLLAB_DOC_ROOT);
  doc.transact(() => {
    const current = yjsToJson(root);
    if (isPlainObject(current)) {
      syncMap(root, current, nextProject as unknown as Record<string, unknown>);
    } else {
      root.clear();
      for (const [key, value] of Object.entries(nextProject)) {
        if (isUnsafeKey(key)) continue;
        if (value === null || value === undefined) continue;
        root.set(key, jsonToYjs(value));
      }
    }
  }, origin);
}
