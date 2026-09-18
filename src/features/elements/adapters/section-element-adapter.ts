// ---------------------------------------------------------------------------
// Section ↔ Element adapter (Phase P22-A / P24-B)
//
// Reuses the EXISTING section-block-adapter as the materialization engine:
//
//   sectionToElementTree   — section → BlockTree (existing) → ElementTree (upcast).
//                            Phase P24-B: when the section already carries a
//                            durable tree, that tree is returned (content
//                            reconciled from the current props) instead of
//                            re-materializing from scratch.
//   elementTreeToBlockTree — ElementTree → BlockTree (deep-strips element fields)
//   elementTreeToSection   — fold a section-derived element tree back into the
//                            validated section model (existing fold path)
//   materializeSectionElement — the durable additive shape (Phase P24-B): a
//                            legacy section plus its persisted element tree.
//
// Because every element field is optional, the upcast is structurally free;
// the downcast strips element-only metadata so the existing block pipeline
// (validation, persistence, folding) accepts the tree unchanged.
//
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import {
  blockTreeToSection,
  isCustomBlockSection,
  sectionToBlockTree,
  type BlockCommitResult,
} from "@/features/blocks/adapters/section-block-adapter";
import type { BlockNode, BlockTree, BlockResult } from "@/features/blocks/types";
import {
  SECTION_ELEMENT_ID_KEY,
  SECTION_ELEMENT_TYPE_KEY,
  type ElementNode,
  type ElementTree,
  type SectionElement,
} from "../types";

/** Keys owned by the element model that the block pipeline does not know. */
const ELEMENT_ONLY_NODE_KEYS = [
  "geometry",
  "viewport",
  "animation",
  "interaction",
  "binding",
  "a11y",
  "customCode",
] as const;

/**
 * Project a section into a one-root element tree.
 *
 * Phase P24-B — durable preference: once a section carries a durable tree it
 * is authoritative for element data (geometry, animation, interaction, …) and
 * is returned directly. Bound-child CONTENT is reconciled from the current
 * section props so content edits made outside the element-tree path (inline
 * editing, AI plans, prop updates) are never silently reverted by a later
 * tree commit. Legacy sections (no durable tree) still materialize through
 * the existing block adapter.
 *
 * The section markers (`_sectionType`, `_sectionId`) carried by the existing
 * adapter are preserved so the tree can be folded back later.
 */
export function sectionToElementTree(section: BaseSection): ElementTree {
  const durable = (section as SectionElement).tree;
  if (durable) {
    return reconcileDurableTreeWithProps(durable, section);
  }
  const blockTree = sectionToBlockTree(section); // handles custom-block projection
  // Upcast: every BlockNode is structurally an ElementNode (all fields
  // optional), so no transformation is required.
  return blockTree as unknown as ElementTree;
}

/**
 * Refresh bound-child text on a durable tree from the CURRENT section props.
 * Only nodes carrying the block binding markers (`_bindPath` / `_bindValueKey`)
 * are touched — element-only metadata and structural edits survive untouched.
 * Returns the input tree unchanged when nothing differs.
 */
function reconcileDurableTreeWithProps(
  tree: ElementTree,
  section: BaseSection,
): ElementTree {
  let changed = false;
  const nodes: Record<string, ElementNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    const path = node.props["_bindPath"];
    const valueKey = node.props["_bindValueKey"];
    let next: ElementNode = node;
    if (Array.isArray(path) && typeof valueKey === "string") {
      const current = getSectionPropAtPath(section.props, path as (string | number)[]);
      if (typeof current === "string" && current !== node.props[valueKey]) {
        next = { ...node, props: { ...node.props, [valueKey]: current } };
        changed = true;
      }
    }
    nodes[id] = next;
  }
  return changed ? { rootIds: [...tree.rootIds], nodes } : tree;
}

/** Read a value at a section.props path (numeric entries index arrays). */
function getSectionPropAtPath(
  props: Record<string, unknown>,
  path: (string | number)[],
): unknown {
  let current: unknown = props;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/**
 * Deep-strip element-only metadata from a tree (block pipeline compatible).
 *
 * NOTE: this is a pure downcast utility. Element-only node types ("text",
 * "section", …) are NOT understood by the block pipeline — callers must
 * guard (as elementTreeToSection does via the `_sectionId` marker) before
 * feeding the result to block-engine functions.
 */
export function elementTreeToBlockTree(tree: ElementTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    const block: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if ((ELEMENT_ONLY_NODE_KEYS as readonly string[]).includes(key)) continue;
      block[key] = value;
    }
    nodes[id] = block as unknown as BlockNode;
  }
  return { rootIds: [...tree.rootIds], nodes };
}

/** True when the tree's root carries the section-id marker of the section. */
export function isSectionDerivedElementTree(
  tree: ElementTree,
  sectionId: string,
): boolean {
  const root = tree.nodes[tree.rootIds[0]];
  return !!root && root.props[SECTION_ELEMENT_ID_KEY] === sectionId;
}

/** The section type marker of a tree's root (or null). */
export function sectionTypeOfElementTree(tree: ElementTree): string | null {
  const root = tree.nodes[tree.rootIds[0]];
  const value = root?.props[SECTION_ELEMENT_TYPE_KEY];
  return typeof value === "string" ? value : null;
}

/**
 * Materialize a section as a root element: returns the durable shape
 * (section + tree). Phase P24-B wires this into the persistence path — the
 * store's commitSectionTree persists exactly this shape on regular sections
 * so the tree survives reload, sync, collaboration, and export. Materialization
 * is additive: `props`/`styles` are kept for backward-compatible rendering.
 */
export function materializeSectionElement(
  section: BaseSection,
  tree: ElementTree,
): SectionElement {
  return { ...section, tree };
}

/** True when a section already carries a durable element tree. */
export function sectionHasDurableTree(section: BaseSection): boolean {
  return (section as SectionElement).tree !== undefined;
}

/**
 * Fold a section-derived element tree back into the validated section model
 * via the existing block adapter. Trees that are NOT derived from the given
 * section are rejected (they cannot map to the section model).
 *
 * Custom-block sections persist the WHOLE tree, so element metadata (geometry
 * etc.) is preserved through the fold; regular sections fold only their bound
 * fields, so element-only metadata is stripped before the fold (it has no
 * durable home there until tree persistence lands in a later sub-phase).
 */
export function elementTreeToSection(
  tree: ElementTree,
  original: BaseSection,
): BlockResult<BlockCommitResult> {
  if (!isSectionDerivedElementTree(tree, original.id)) {
    return {
      ok: false,
      error: {
        code: "BLOCK_NOT_FOUND",
        message: "The element tree does not belong to this section.",
      },
    };
  }
  const blockTree = isCustomBlockSection(original)
    ? (tree as unknown as BlockTree)
    : elementTreeToBlockTree(tree);
  return blockTreeToSection(blockTree, original);
}

/** Resolve an element node reference from an element tree (or undefined). */
export function elementNodeOf(
  tree: ElementTree,
  id: string,
): ElementNode | undefined {
  return tree.nodes[id];
}
