// ---------------------------------------------------------------------------
// Durable section-tree export projection (Phase P24-C, decisions D4/D5)
//
// A REGULAR section may carry a durable element tree (`BaseSection.tree`,
// Phase P24-B). When that tree enables custom code, the exported page mounts
// the same bounded, sandboxed block runtime the custom-block sections use.
//
// Two hard rules live here:
//
//   1. NEVER route a durable tree through `elementTreeToBlockTree()` on an
//      export path. That adapter is a general downcast that strips EVERY
//      element-only node key — including `customCode` (the payload this phase
//      exists to emit), plus `viewport` / `animation` / `interaction`, which
//      the generated block runtime DOES consume. Using it here would silently
//      delete custom code, responsive overrides, animations and interactions
//      from the exported site. (REQ-6 anti-regression invariant.)
//
//   2. The emitted node carries exactly the keys the generated `BlockNode`
//      type declares (see `custom-block-generator.ts`), so the exported module
//      type-checks: id, type, parentId, children, props, style, responsive,
//      viewport, animation, interaction, customCode, visible, locked, hidden.
//      Element-only keys with no export-side consumer (geometry, binding, a11y)
//      are dropped; custom code is reduced to `{ enabled: true }` so the page
//      module never contains user code text (the validated documents travel
//      separately in the `srcdocs` prop).
//
// Pure, deterministic and non-mutating.
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "@/features/blocks/types";
import type { ElementTree } from "@/features/elements/types";
import { buildValidatedCustomCodeSrcdoc } from "@/features/elements/custom-code/srcdoc";

// ---------------------------------------------------------------------------
// Node projection
// ---------------------------------------------------------------------------

/**
 * The node keys the generated block runtime understands and its emitted
 * `BlockNode` type declares — in a stable order so output is deterministic.
 */
const EXPORT_NODE_KEYS = [
  "id",
  "type",
  "parentId",
  "children",
  "props",
  "style",
  "responsive",
  "viewport",
  "animation",
  "interaction",
  "visible",
  "locked",
  "hidden",
] as const;

/** The custom-code opt-in flag shape the generated `BlockNode` declares. */
export interface ProjectedCustomCode {
  enabled?: boolean;
}

/**
 * Project ONE element node into its export shape.
 *
 * Keeps the runtime-consumed keys, reduces `customCode` to its opt-in flag
 * (`{ enabled: true }`) and drops it entirely when not explicitly enabled, and
 * drops element-only keys with no export consumer. Non-custom-code values are
 * passed through by reference (never cloned or rewritten).
 */
export function projectNodeForExport(node: unknown): Record<string, unknown> {
  const source = (node ?? {}) as Record<string, unknown>;
  const projected: Record<string, unknown> = {};

  for (const key of EXPORT_NODE_KEYS) {
    if (source[key] !== undefined) projected[key] = source[key];
  }

  const customCode = source.customCode;
  if (
    customCode &&
    typeof customCode === "object" &&
    !Array.isArray(customCode) &&
    (customCode as { enabled?: unknown }).enabled === true
  ) {
    projected.customCode = { enabled: true } satisfies ProjectedCustomCode;
  }

  return projected;
}

/**
 * Project a durable section tree into the block-shaped tree the generated
 * runtime consumes, PRESERVING the custom-code opt-in flag on every node.
 *
 * This is the export projection REQ-6 requires: it is intentionally NOT
 * `elementTreeToBlockTree()`, which would strip `customCode` (and the
 * viewport/animation/interaction data the runtime renders).
 */
export function projectSectionTreeForExport(tree: ElementTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};

  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = projectNodeForExport(node) as unknown as BlockNode;
  }

  return { rootIds: [...tree.rootIds], nodes };
}

// ---------------------------------------------------------------------------
// Custom-code srcdoc discovery (any tree-shaped payload)
// ---------------------------------------------------------------------------

/**
 * Build the `srcdocs` map (nodeId → validated sandbox document) for ANY
 * tree-shaped payload — a legacy custom-block `props.tree` or a Phase P24-B
 * durable `section.tree` (nested children included, since every node is
 * scanned).
 *
 * The ONLY document construction path is `buildValidatedCustomCodeSrcdoc`
 * (schema validation → `enabled === true` → deterministic per-field/aggregate
 * re-clamping → `buildCustomCodeDocument`), so export always re-clamps the
 * payload — it never trusts what was stored. Disabled, absent or
 * schema-invalid custom code contributes no entry.
 *
 * Returns null when no node qualifies, so callers omit the `srcdocs` prop
 * entirely and projects without custom code stay byte-identical.
 */
export function buildSrcdocsForTreeRecord(tree: unknown): Record<string, string> | null {
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return null;
  const nodes = (tree as { nodes?: unknown }).nodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return null;

  const srcdocs: Record<string, string> = {};
  for (const [nodeId, node] of Object.entries(nodes as Record<string, unknown>)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const customCode = (node as Record<string, unknown>).customCode;
    if (customCode === undefined || customCode === null) continue;
    const srcdoc = buildValidatedCustomCodeSrcdoc(customCode);
    if (srcdoc === null) continue;
    srcdocs[nodeId] = srcdoc;
  }

  return Object.keys(srcdocs).length > 0 ? srcdocs : null;
}
