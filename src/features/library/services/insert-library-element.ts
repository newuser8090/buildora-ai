// ---------------------------------------------------------------------------
// Element Library (Phase P22-D) — canonical insertion
//
// The ONE way a library element becomes persistent project content. It reuses
// the existing creation + commit machinery end to end:
//   - element defaults come from the Phase O block registry (createBlock)
//   - a new section is built through the custom-block schema (buildCustomBlockSection)
//     and inserted via the editor store's insertSection (one history entry)
//   - an insert into a selected custom-block section goes through the Phase O
//     block engine (applyBlockOperation) + commitBlockTree (one history entry)
//
// History/undo/redo, collaboration, and autosave behave exactly like every
// other durable edit — nothing is bypassed. Any failure leaves the project
// untouched.
// ---------------------------------------------------------------------------

import type {
  BlockNode,
  BlockResult,
  BlockTree,
  BlockType,
} from "@/features/blocks/types";
import { blockRegistry } from "@/features/blocks/registry/block-registry";
import {
  applyBlockOperation,
  createBlock,
  createBlockId,
} from "@/features/blocks/engine/block-operations";
import {
  customBlockTreeFromSection,
  isCustomBlockSection,
} from "@/features/blocks/adapters/section-block-adapter";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { buildCustomBlockSection } from "@/features/code-import/services/insert-imported-block-tree";
import { createSectionId } from "@/features/editor/section-library/services/section-factory";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection } from "@/types/section";
import type { InsertLibraryElementResult } from "../types";

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface InsertLibraryElementRequest {
  /** Element/block type to create (must be a registered block type). */
  type: BlockType;
  /** Target page. Defaults to the active page (or the first page). */
  pageId?: string;
  /**
   * When set to a CUSTOM-BLOCK section on the target page, the element is
   * inserted inside that section's tree. When set to any other section, the
   * element is added as a new section AFTER it. When absent, the current
   * selected section (if any) is used; otherwise the element is appended as a
   * new section at the end of the page.
   */
  targetSectionId?: string;
  /** Injectable id factory (deterministic tests). */
  idFactory?: () => string;
}

export type { InsertLibraryElementResult };

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

/**
 * Build a single-root BlockTree for a library element. The root node carries
 * the given rootId (used as the section id for new sections) with the
 * element's fresh defaults. Never shares references.
 */
export function buildLibraryTree(
  type: BlockType,
  rootId: string,
): BlockResult<{ tree: BlockTree; root: BlockNode }> {
  if (!blockRegistry.has(type)) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_BLOCK_TYPE",
        message: `Unknown element "${type}".`,
      },
    };
  }
  const root = createBlock(type, { id: rootId });
  return {
    ok: true,
    value: {
      tree: { rootIds: [root.id], nodes: { [root.id]: root } },
      root,
    },
  };
}

// ---------------------------------------------------------------------------
// Store-backed insertion
// ---------------------------------------------------------------------------

/**
 * Insert a library element into the project. Placement:
 *   - into the selected custom-block section's tree when one is targeted
 *   - otherwise as a NEW custom-block section (after the targeted section, or
 *     appended at the end of the page)
 * On success the section (and the new block inside custom-block targets) is
 * selected. One history entry per insertion.
 */
export function insertLibraryElement(
  request: InsertLibraryElementRequest,
): InsertLibraryElementResult {
  const store = useEditorStore.getState();
  const { project } = store;

  if (!blockRegistry.has(request.type)) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_ELEMENT",
        message: `Unknown element "${request.type}".`,
      },
    };
  }

  const pageId =
    request.pageId ??
    store.selectedPageId ??
    project.pages[0]?.id ??
    null;
  if (!pageId) {
    return {
      ok: false,
      error: { code: "PAGE_NOT_FOUND", message: "No page to add to." },
    };
  }
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) {
    return {
      ok: false,
      error: { code: "PAGE_NOT_FOUND", message: "That page no longer exists." },
    };
  }

  const targetId = request.targetSectionId ?? store.selectedSectionId ?? null;
  const targetSection = targetId
    ? (page.sections.find((s) => s.id === targetId) ?? null)
    : null;

  // Custom-block sections host free-form trees → insert inside.
  if (targetSection && isCustomBlockSection(targetSection)) {
    return insertInsideSection(page.id, targetSection, request.type, request.idFactory);
  }

  return insertAsNewSection(page.id, page.sections, targetSection, request.type);
}

// ---------------------------------------------------------------------------
// Insert inside a selected custom-block section
// ---------------------------------------------------------------------------

function insertInsideSection(
  pageId: string,
  section: BaseSection,
  type: BlockType,
  idFactory?: () => string,
): InsertLibraryElementResult {
  const sectionId = section.id;
  const tree = customBlockTreeFromSection(section);
  if (tree.rootIds.length === 0) {
    return {
      ok: false,
      error: {
        code: "INVALID_TREE",
        message: "The selected design is empty and cannot hold elements yet.",
      },
    };
  }

  const rootId = tree.rootIds[0];
  const blockId = idFactory ? idFactory() : createBlockId(type);
  const built = buildLibraryTree(type, blockId);
  if (!built.ok) return { ok: false, error: built.error };

  const applied = applyBlockOperation(tree, {
    kind: "insert",
    parentId: rootId,
    block: built.value.root,
  });
  if (!applied.ok) {
    return { ok: false, error: applied.error };
  }

  const committed = useEditorStore
    .getState()
    .commitBlockTree(pageId, sectionId, applied.value as BlockTree);
  if (!committed.ok) {
    return { ok: false, error: committed.error };
  }

  // Select the section + highlight the new block (canvas ring + inspector).
  useEditorStore.getState().selectSection(sectionId);
  useBlockEditorStore.getState().selectBlock(built.value.root.id);

  return {
    ok: true,
    sectionId,
    pageId,
    blockId: built.value.root.id,
    mode: "inside-selected",
  };
}

// ---------------------------------------------------------------------------
// Insert as a new custom-block section
// ---------------------------------------------------------------------------

function insertAsNewSection(
  pageId: string,
  sections: { id: string }[],
  targetSection: { id: string } | null,
  type: BlockType,
): InsertLibraryElementResult {
  const definition = blockRegistry.get(type);
  if (!definition) {
    return {
      ok: false,
      error: { code: "UNKNOWN_ELEMENT", message: `Unknown element "${type}".` },
    };
  }

  const sectionId = createSectionId("custom-block");
  const built = buildLibraryTree(type, sectionId);
  if (!built.ok) return { ok: false, error: built.error };

  const section = buildCustomBlockSection({
    tree: built.value.tree,
    name: definition.label,
    sectionId,
  });
  if (!section.ok) return { ok: false, error: section.error };

  // Insert after the targeted section when it exists on the page, else at the
  // end of the page.
  const position =
    targetSection && sections.some((s) => s.id === targetSection.id)
      ? { type: "after" as const, sectionId: targetSection.id }
      : ({ type: "end" as const } as const);

  const inserted = useEditorStore
    .getState()
    .insertSection(pageId, section.value, position);
  if (!inserted.ok) {
    return {
      ok: false,
      error: { code: inserted.error.code, message: inserted.error.message },
    };
  }

  // insertSection already selects the new section.
  return {
    ok: true,
    sectionId,
    pageId,
    blockId: sectionId,
    mode: "new-section",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Re-exported for the UI layer to describe insertion mode. */
export const LIBRARY_SECTION_TYPE = CUSTOM_BLOCK_SECTION_TYPE;
