// ---------------------------------------------------------------------------
// Section ↔ Element adapter (Phase P22-A)
//
// Reuses the EXISTING section-block-adapter as the materialization engine:
//
//   sectionToElementTree   — section → BlockTree (existing) → ElementTree (upcast)
//   elementTreeToBlockTree — ElementTree → BlockTree (deep-strips element fields)
//   elementTreeToSection   — fold a section-derived element tree back into the
//                            validated section model (existing fold path)
//   materializeSectionElement — the future additive durable shape (NOT wired)
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
 * The section markers (`_sectionType`, `_sectionId`) carried by the existing
 * adapter are preserved so the tree can be folded back later.
 */
export function sectionToElementTree(section: BaseSection): ElementTree {
  const blockTree =
    isCustomBlockSection(section)
      ? sectionToBlockTree(section) // handles custom-block projection
      : sectionToBlockTree(section);
  // Upcast: every BlockNode is structurally an ElementNode (all fields
  // optional), so no transformation is required.
  return blockTree as unknown as ElementTree;
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
 * Materialize a section as a root element: returns the future durable shape
 * (section + tree). P22-A does NOT persist this — durability wiring is a
 * later sub-phase. Materialization is additive: `props`/`styles` are kept.
 */
export function materializeSectionElement(
  section: BaseSection,
  tree: ElementTree,
): SectionElement {
  return { ...section, tree };
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
