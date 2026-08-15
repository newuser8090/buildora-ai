"use client";

// ---------------------------------------------------------------------------
// Selected element helper (Phase P22-H) — ONE shared definition of the AI
// element target
//
// Resolves the current element the AI should act on, normalizing three
// sources into a single answer:
//   1. the canvas element selection (transient interaction store) — a SINGLE
//      NESTED element id (the manipulation layer also syncs the section root
//      there, which is treated as the section-level fallback, not a nested
//      element)
//   2. the inspector's selected element (block-editor-store.selectedBlockId,
//      set by clicking blocks on canvas / in the build tree)
//   3. the selected section's ROOT element (matches the inspector's root
//      fallback when nothing nested is selected)
//
// Rules (approved decisions):
//   - ONLY custom-block sections (the durable element-tree surface) qualify
//   - ONLY a single selected element is accepted
//   - the element must be RENDERABLE/durable (registered block-derived type;
//     element-only families have no renderer or persistence path)
//   - a valid canvas element selection wins; the inspector target falls back;
//     the section root is the last resort
//
// This is the ONLY place these sources are combined — the inspector AI entry
// and the copilot both consume `resolveElementEditTarget`.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { isCustomBlockSection } from "@/features/blocks/adapters/section-block-adapter";
import { isRenderableElementType } from "@/features/elements/registry/element-registry";
import type { ElementNode, ElementTree } from "@/features/elements/types";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useCanvasInteractionStore } from "@/features/canvas/store/canvas-interaction-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";

export interface ElementEditTarget {
  pageId: string;
  sectionId: string;
  elementId: string;
  section: BaseSection;
  tree: ElementTree;
  node: ElementNode;
}

export interface ResolveElementEditTargetInput {
  project: Project;
  selectedPageId: string | null;
  selectedSectionId: string | null;
  /** Canvas element selection (transient interaction store). */
  canvasSelectionIds: string[];
  /** Inspector/block selection (block-editor-store). */
  inspectorSelectedId: string | null;
}

function targetFor(
  pageId: string,
  section: BaseSection,
  tree: ElementTree,
  elementId: string,
): ElementEditTarget | null {
  const node = tree.nodes[elementId];
  if (!node) return null;
  if (!isRenderableElementType(node.type)) return null;
  return { pageId, sectionId: section.id, elementId, section, tree, node };
}

/**
 * Resolve the single current element the AI should target, or null.
 * Pure + deterministic: never touches stores, never mutates state.
 */
export function resolveElementEditTarget(
  input: ResolveElementEditTargetInput,
): ElementEditTarget | null {
  const { project, selectedPageId, selectedSectionId } = input;
  const page = project.pages.find((p) => p.id === selectedPageId) ?? project.pages[0] ?? null;
  if (!page) return null;
  const section = selectedSectionId
    ? page.sections.find((s) => s.id === selectedSectionId)
    : null;
  if (!section) return null;

  // Element AI targets custom-block sections only (durable element trees).
  if (!isCustomBlockSection(section)) return null;

  const tree = sectionToElementTree(section);
  if (tree.rootIds.length === 0) return null;
  const rootId = tree.rootIds[0];

  // 1. Canvas element selection wins when it holds a single NESTED element
  //    (the manipulation layer also mirrors the section id there — that is
  //    the section-level selection, handled by the root fallback below).
  if (input.canvasSelectionIds.length === 1) {
    const canvasId = input.canvasSelectionIds[0];
    if (canvasId !== rootId) {
      const target = targetFor(page.id, section, tree, canvasId);
      if (target) return target;
    }
  }

  // 2. Fall back to the inspector's selected element (canvas clicks / build
  //    tree set this).
  if (input.inspectorSelectedId) {
    const target = targetFor(page.id, section, tree, input.inspectorSelectedId);
    if (target) return target;
  }

  // 3. Last resort: the section root (the inspector's own fallback target).
  return targetFor(page.id, section, tree, rootId);
}

/**
 * Imperative store read — the editor's current AI element target. Safe to
 * call inside event callbacks (unlike the hook). Null when no valid
 * renderable element is targeted.
 */
export function getElementEditTarget(): ElementEditTarget | null {
  const editor = useEditorStore.getState();
  const interaction = useCanvasInteractionStore.getState();
  const blocks = useBlockEditorStore.getState();
  return resolveElementEditTarget({
    project: editor.project,
    selectedPageId: editor.selectedPageId,
    selectedSectionId: editor.selectedSectionId,
    canvasSelectionIds: interaction.selection.ids,
    inspectorSelectedId: blocks.selectedBlockId,
  });
}

/**
 * React binding — the editor's current AI element target, resolved from the
 * live stores. Null when no valid renderable element is targeted.
 */
export function useElementEditTarget(): ElementEditTarget | null {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const selectedSectionId = useEditorStore((s) => s.selectedSectionId);
  const canvasSelectionIds = useCanvasInteractionStore((s) => s.selection.ids);
  const inspectorSelectedId = useBlockEditorStore((s) => s.selectedBlockId);

  return useMemo(
    () =>
      resolveElementEditTarget({
        project,
        selectedPageId,
        selectedSectionId,
        canvasSelectionIds,
        inspectorSelectedId,
      }),
    [project, selectedPageId, selectedSectionId, canvasSelectionIds, inspectorSelectedId],
  );
}
