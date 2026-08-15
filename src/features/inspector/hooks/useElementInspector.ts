"use client";

// ---------------------------------------------------------------------------
// useElementInspector (Phase P22-C) — selection → node → model → commit
//
// The inspector's target element is:
//   1. the block selected on canvas / in the build tree (block-editor-store)
//      when it belongs to the selected section's element tree, else
//   2. the selected section's ROOT element.
//
// The model (schema + resolved values) is derived from the materialized
// element tree; every commit re-materializes the tree from the FRESHEST store
// state and applies ONE validated element op, then commits through
// commitElementTree → withHistory (one atomic history entry). The panel never
// mutates project state directly.
// ---------------------------------------------------------------------------

import { useCallback, useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import {
  applyInspectorFieldChange,
  applySpacingSideChange,
  resetInspectorField,
  validateInspectorFieldValue,
} from "@/features/elements/inspector/mutate";
import { resolveInspectorModel } from "@/features/elements/inspector/resolver";
import type {
  InspectorBreakpoint,
  InspectorFieldDef,
  InspectorModel,
} from "@/features/elements/inspector/types";
import type { ElementNode, ElementResult, ElementTree } from "@/features/elements/types";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import type { BaseSection } from "@/types/section";

const VIEWPORT_TO_BREAKPOINT: Record<string, InspectorBreakpoint> = {
  desktop: "base",
  tablet: "tablet",
  mobile: "mobile",
};

export interface ElementInspectorApi {
  /** The materialized element tree of the selected section. */
  tree: ElementTree;
  /** The node being inspected. */
  node: ElementNode;
  /** The node's root id (the section). */
  rootId: string;
  /** True when inspecting a nested block (not the root). */
  isNested: boolean;
  /** The current breakpoint context. */
  breakpoint: InspectorBreakpoint;
  /** The resolved model (schema + values). */
  model: InspectorModel;
  /** Commit one validated field change. Returns ok. */
  commitField: (field: InspectorFieldDef, value: unknown) => boolean;
  /** Commit a per-side spacing change. */
  commitSpacingSide: (
    field: InspectorFieldDef,
    side: "top" | "right" | "bottom" | "left",
    value: string,
  ) => boolean;
  /** Reset a field (delete base value or the current override). */
  resetField: (field: InspectorFieldDef) => boolean;
  /** Jump the inspector back to the section root. */
  selectRoot: () => void;
}

export function useElementInspector(
  pageId: string,
  section: BaseSection | null,
): ElementInspectorApi | null {
  const viewport = useEditorStore((s) => s.viewport);
  const commitElementTree = useEditorStore((s) => s.commitElementTree);
  const selectedBlockId = useBlockEditorStore((s) => s.selectedBlockId);

  const sectionId = section?.id ?? "";
  const breakpoint: InspectorBreakpoint = VIEWPORT_TO_BREAKPOINT[viewport] ?? "base";

  // Materialize the section's element tree (reading surface).
  const tree = useMemo(
    () => (section ? sectionToElementTree(section) : { rootIds: [], nodes: {} }),
    [section],
  );

  // Target element: the selected block when it belongs to this section's tree.
  const targetId =
    selectedBlockId && tree.nodes[selectedBlockId] ? selectedBlockId : sectionId;
  const node = tree.nodes[targetId];

  const model = useMemo(
    () => (node ? resolveInspectorModel(node, breakpoint) : null),
    [node, breakpoint],
  );

  // ---- Commit path — always re-materializes from the freshest store state ----
  const commitTree = useCallback(
    (nextTree: ElementTree): boolean => {
      const result = commitElementTree(pageId, sectionId, nextTree);
      return result.ok === true;
    },
    [pageId, sectionId, commitElementTree],
  );

  const applyToFreshest = useCallback(
    (apply: (tree: ElementTree, nodeId: string) => ElementResult<ElementTree>): boolean => {
      const state = useEditorStore.getState();
      const page = state.project.pages.find((p) => p.id === pageId);
      const freshest = page?.sections.find((s) => s.id === sectionId);
      if (!page || !freshest) return false;
      const freshestTree = sectionToElementTree(freshest);
      const nodeId =
        selectedBlockId && freshestTree.nodes[selectedBlockId] ? selectedBlockId : sectionId;
      const result = apply(freshestTree, nodeId);
      if (!result.ok) return false;
      return commitTree(result.value);
    },
    [pageId, sectionId, selectedBlockId, commitTree],
  );

  const commitField = useCallback(
    (field: InspectorFieldDef, value: unknown): boolean => {
      const validated = validateInspectorFieldValue(field, value);
      if (!validated.ok) return false;
      return applyToFreshest((tree, nodeId) =>
        applyInspectorFieldChange(tree, nodeId, field, validated.value, breakpoint),
      );
    },
    [applyToFreshest, breakpoint],
  );

  const commitSpacingSide = useCallback(
    (field: InspectorFieldDef, side: "top" | "right" | "bottom" | "left", value: string): boolean =>
      applyToFreshest((tree, nodeId) =>
        applySpacingSideChange(tree, nodeId, field, side, value, breakpoint),
      ),
    [applyToFreshest, breakpoint],
  );

  const resetField = useCallback(
    (field: InspectorFieldDef): boolean =>
      applyToFreshest((tree, nodeId) => resetInspectorField(tree, nodeId, field, breakpoint)),
    [applyToFreshest, breakpoint],
  );

  const selectRoot = useCallback(() => {
    useBlockEditorStore.getState().selectBlock(null);
  }, []);

  if (!node || !model) return null;
  return {
    tree,
    node,
    rootId: sectionId,
    isNested: targetId !== sectionId,
    breakpoint,
    model,
    commitField,
    commitSpacingSide,
    resetField,
    selectRoot,
  };
}
