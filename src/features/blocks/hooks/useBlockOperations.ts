// ---------------------------------------------------------------------------
// useBlockOperations — wire pure block operations to the editor store (Phase O)
//
// Each operation resolves the owning section from the block id (via the page
// forest root), so the build tree can operate across every section on the
// current page.
//
// Persistence policy (honest, deterministic, documented):
//   - bound text edits        → commitBlockTree (one atomic history entry)
//   - array-group delete/dup  → props-level fold + updateSectionProps (one entry)
//   - structural ops (insert, move, lock, hide, rename, presets) are SESSION
//     PREVIEWS in the block editor store — the section model cannot represent
//     free-form blocks yet (Phase P persistence candidate). They are clearly
//     labelled as "Preview only" in the UI and cleared when the section props
//     change.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "../store/block-editor-store";
import { applyBlockOperation, createBlock } from "../engine/block-operations";
import { getNode, rootIdOf } from "../engine/tree-traversal";
import {
  bindingOf,
  buildPageForest,
  deleteGroupFromProps,
  duplicateGroupInProps,
  extractSectionTree,
  propsFingerprint,
  validatePropsChange,
} from "../adapters/section-block-adapter";
import type { BaseSection } from "@/types/section";
import type { BlockTree, BlockType } from "../types";

const SESSION_WARNING =
  "Block structure changes are previewed in-session only. They will be saved once the free-form block engine is enabled (Phase P).";

export interface BlockOperations {
  /** Persist a bound text edit (one history entry). */
  updateBlockText: (nodeId: string, value: string) => void;
  /** Delete a bound array-item block (persisted) or a session block. */
  deleteBlock: (nodeId: string) => void;
  /** Duplicate a bound array-item block (persisted) or a session block. */
  duplicateBlock: (nodeId: string) => void;
  /** Insert a block under a parent (session preview). */
  insertBlock: (type: BlockType, parentId?: string) => void;
  /** Session-only structural ops. */
  renameBlock: (nodeId: string, label: string) => void;
  setLocked: (nodeId: string, locked: boolean) => void;
  setHidden: (nodeId: string, hidden: boolean) => void;
  applyPreset: (nodeId: string, presetId: string) => void;
}

export function useBlockOperations(pageId: string | null): BlockOperations {
  const project = useEditorStore((s) => s.project);
  const commitBlockTree = useEditorStore((s) => s.commitBlockTree);
  const updateSectionProps = useEditorStore((s) => s.updateSectionProps);

  const sessionTrees = useBlockEditorStore((s) => s.sessionTrees);
  const setSessionTree = useBlockEditorStore((s) => s.setSessionTree);
  const setFeedback = useBlockEditorStore((s) => s.setFeedback);
  const addRecent = useBlockEditorStore((s) => s.addRecent);
  const selectBlock = useBlockEditorStore((s) => s.selectBlock);

  const page = project.pages.find((p) => p.id === pageId) ?? null;

  // Resolve the owning section for a block id.
  const sectionFor = useCallback(
    (nodeId: string): BaseSection | null => {
      if (!page) return null;
      const forest = buildPageForest(page.sections);
      const rootId = rootIdOf(forest, nodeId);
      if (!rootId) return null;
      return page.sections.find((s) => s.id === rootId) ?? null;
    },
    [page],
  );

  // Current tree for a section: session preview when valid, else derived.
  const treeFor = useCallback(
    (section: BaseSection): { tree: BlockTree; sessionActive: boolean } => {
      if (!page) return { tree: { rootIds: [], nodes: {} }, sessionActive: false };
      const derived = extractSectionTree(buildPageForest(page.sections), section.id);
      const session = sessionTrees[section.id];
      if (session && session.fingerprint === propsFingerprint(section)) {
        return { tree: session.tree, sessionActive: true };
      }
      return { tree: derived, sessionActive: false };
    },
    [page, sessionTrees],
  );

  const storeSession = useCallback(
    (section: BaseSection, tree: BlockTree) => {
      setSessionTree(section.id, { fingerprint: propsFingerprint(section), tree });
    },
    [setSessionTree],
  );

  const updateBlockText = useCallback(
    (nodeId: string, value: string) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree, sessionActive } = treeFor(section);
      const node = getNode(tree, nodeId);
      if (!node) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });

      const binding = bindingOf(node);
      if (!binding) {
        // Unbound block — session preview only.
        const result = applyBlockOperation(tree, {
          kind: "update-props",
          blockId: nodeId,
          props: { text: value },
        });
        if (!result.ok) return setFeedback(result.error);
        storeSession(section, result.value as BlockTree);
        return setFeedback(null, [SESSION_WARNING]);
      }

      const result = applyBlockOperation(tree, {
        kind: "update-props",
        blockId: nodeId,
        props: { [binding.valueKey]: value },
      });
      if (!result.ok) return setFeedback(result.error);
      const nextTree = result.value as BlockTree;
      const commit = commitBlockTree(page?.id ?? "", section.id, nextTree);
      if (!commit.ok) {
        return setFeedback({ code: "INVALID_TREE", message: commit.error.message });
      }
      // Keep a live session preview if one was active (so unbound blocks
      // survive a bound text edit).
      if (sessionActive) storeSession(section, nextTree);
      setFeedback(null);
    },
    [sectionFor, treeFor, storeSession, commitBlockTree, page, setFeedback],
  );

  const deleteBlock = useCallback(
    (nodeId: string) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree, sessionActive } = treeFor(section);
      const node = getNode(tree, nodeId);
      if (!node) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });

      const binding = bindingOf(node);
      if (binding?.groupPath) {
        const result = deleteGroupFromProps(section.props, binding.groupPath);
        if (!result.ok) return setFeedback(result.error);
        const validated = validatePropsChange(section, result.value);
        if (!validated.ok) return setFeedback(validated.error);
        updateSectionProps(section.id, result.value);
        return setFeedback(null);
      }
      if (!sessionActive) {
        return setFeedback({
          code: "CANNOT_EDIT_LEAF",
          message: "This block cannot be deleted from the section model.",
        });
      }
      const result = applyBlockOperation(tree, { kind: "delete", blockId: nodeId });
      if (!result.ok) return setFeedback(result.error);
      storeSession(section, result.value as BlockTree);
      selectBlock(null);
      setFeedback(null, [SESSION_WARNING]);
    },
    [sectionFor, treeFor, storeSession, updateSectionProps, selectBlock, setFeedback],
  );

  const duplicateBlock = useCallback(
    (nodeId: string) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree, sessionActive } = treeFor(section);
      const node = getNode(tree, nodeId);
      if (!node) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });

      const binding = bindingOf(node);
      if (binding?.groupPath) {
        const result = duplicateGroupInProps(section.props, binding.groupPath);
        if (!result.ok) return setFeedback(result.error);
        const validated = validatePropsChange(section, result.value);
        if (!validated.ok) return setFeedback(validated.error);
        updateSectionProps(section.id, result.value);
        return setFeedback(null);
      }
      if (!sessionActive) {
        return setFeedback({
          code: "CANNOT_EDIT_LEAF",
          message: "This block cannot be duplicated into the section model.",
        });
      }
      const result = applyBlockOperation(tree, { kind: "duplicate", blockId: nodeId });
      if (!result.ok) return setFeedback(result.error);
      const value = result.value as { tree: BlockTree; newId: string };
      storeSession(section, value.tree);
      selectBlock(value.newId);
      setFeedback(null, [SESSION_WARNING]);
    },
    [sectionFor, treeFor, storeSession, updateSectionProps, selectBlock, setFeedback],
  );

  const insertBlock = useCallback(
    (type: BlockType, parentId?: string) => {
      const section = parentId ? sectionFor(parentId) : page?.sections[0] ?? null;
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "No section to insert into." });
      const { tree } = treeFor(section);
      const target = parentId && getNode(tree, parentId) ? parentId : section.id;
      const block = createBlock(type);
      const result = applyBlockOperation(tree, {
        kind: "insert",
        parentId: target,
        block,
      });
      if (!result.ok) return setFeedback(result.error);
      storeSession(section, result.value as BlockTree);
      selectBlock(block.id);
      addRecent(type);
      setFeedback(null, [SESSION_WARNING]);
    },
    [page, sectionFor, treeFor, storeSession, selectBlock, addRecent, setFeedback],
  );

  const renameBlock = useCallback(
    (nodeId: string, label: string) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree } = treeFor(section);
      const result = applyBlockOperation(tree, { kind: "rename", blockId: nodeId, label });
      if (!result.ok) return setFeedback(result.error);
      storeSession(section, result.value as BlockTree);
      setFeedback(null, [SESSION_WARNING]);
    },
    [sectionFor, treeFor, storeSession, setFeedback],
  );

  const setLocked = useCallback(
    (nodeId: string, locked: boolean) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree } = treeFor(section);
      const result = applyBlockOperation(tree, { kind: "lock", blockId: nodeId, locked });
      if (!result.ok) return setFeedback(result.error);
      storeSession(section, result.value as BlockTree);
      setFeedback(null, [SESSION_WARNING]);
    },
    [sectionFor, treeFor, storeSession, setFeedback],
  );

  const setHidden = useCallback(
    (nodeId: string, hidden: boolean) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree } = treeFor(section);
      const result = applyBlockOperation(tree, { kind: "hide", blockId: nodeId, hidden });
      if (!result.ok) return setFeedback(result.error);
      storeSession(section, result.value as BlockTree);
      setFeedback(null, [SESSION_WARNING]);
    },
    [sectionFor, treeFor, storeSession, setFeedback],
  );

  const applyPreset = useCallback(
    (nodeId: string, presetId: string) => {
      const section = sectionFor(nodeId);
      if (!section) return setFeedback({ code: "BLOCK_NOT_FOUND", message: "This block no longer exists." });
      const { tree } = treeFor(section);
      const result = applyBlockOperation(tree, {
        kind: "apply-preset",
        blockId: nodeId,
        presetId,
      });
      if (!result.ok) return setFeedback(result.error);
      storeSession(section, result.value as BlockTree);
      setFeedback(null, [SESSION_WARNING]);
    },
    [sectionFor, treeFor, storeSession, setFeedback],
  );

  return {
    updateBlockText,
    deleteBlock,
    duplicateBlock,
    insertBlock,
    renameBlock,
    setLocked,
    setHidden,
    applyPreset,
  };
}
