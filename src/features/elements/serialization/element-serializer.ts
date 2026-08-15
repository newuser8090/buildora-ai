// ---------------------------------------------------------------------------
// Element serializer (Phase P22-A)
//
// The element model is plain, schema-validated JSON — the same shape the
// existing persistence (IndexedDB), version history, collaboration (Yjs
// bridge) and export pipelines already consume. Serialization is a thin
// envelope:
//
//   serializeElementTree   → canonical JSON string (data only)
//   deserializeElementTree → parse → normalize (repair + clamp) → validated tree
//
// P22-A does not wire this into the durable Project payload — it establishes
// the conversion primitives a later sub-phase will call from the persistence
// layer (which stays additive and backward compatible).
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { ElementResult, ElementTree } from "../types";
import { normalizeElementTree } from "./element-normalizer";

/** Serialize an element tree to canonical JSON. Never throws for valid trees. */
export function serializeElementTree(tree: ElementTree): string {
  return JSON.stringify(tree);
}

/** Serialize an element node to canonical JSON. */
export function serializeElementNode(node: ElementTree["nodes"][string]): string {
  return JSON.stringify(node);
}

/**
 * Deserialize + normalize an element tree from JSON.
 * Returns a structured error when the payload cannot be parsed or nothing
 * usable survives normalization. Never throws.
 */
export function deserializeElementTree(json: string): ElementResult<ElementTree> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {
      ok: false,
      error: {
        code: "ELEMENT_SERIALIZATION_FAILED",
        message: "The element tree payload is not valid JSON.",
      },
    };
  }
  const normalized = normalizeElementTree(parsed);
  if (!normalized) {
    return {
      ok: false,
      error: {
        code: "ELEMENT_SERIALIZATION_FAILED",
        message: "The element tree payload could not be normalized.",
      },
    };
  }
  return { ok: true, value: normalized };
}

/**
 * Deep-clone an element tree via JSON round-trip. Safe because the model is
 * data-only (no functions, no DOM nodes, no prototypes).
 */
export function cloneElementTree(tree: ElementTree): ElementTree {
  return JSON.parse(JSON.stringify(tree)) as ElementTree;
}
