// ---------------------------------------------------------------------------
// useBlockForest — derive the block forest for the current page (Phase O)
//
// The block tree is a VIEW-MODEL: it is derived from the stable section model
// via the adapter and never persisted itself. Session "preview" trees from the
// block editor store are layered on top when their fingerprint still matches
// the section props (they are cleared by any real project change).
//
// Memoized so that unrelated store updates (selection, viewport, …) never
// rebuild the tree.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "../store/block-editor-store";
import {
  buildPageForest,
  extractSectionTree,
  propsFingerprint,
  replaceSectionTree,
} from "../adapters/section-block-adapter";
import type { BlockTree } from "../types";

/** Block forest for the current (or given) page, with session overlays. */
export function useBlockForest(pageId?: string | null): BlockTree {
  const project = useEditorStore((s) => s.project);
  const selectedPageId = useEditorStore((s) => s.selectedPageId);
  const sessionTrees = useBlockEditorStore((s) => s.sessionTrees);

  return useMemo(() => {
    const activePageId = pageId ?? selectedPageId;
    const page = project.pages.find((p) => p.id === activePageId);
    if (!page) return { rootIds: [], nodes: {} };

    let forest = buildPageForest(page.sections);

    // Layer session preview trees on top when still valid.
    for (const section of page.sections) {
      const session = sessionTrees[section.id];
      if (!session) continue;
      if (session.fingerprint !== propsFingerprint(section)) continue;
      forest = replaceSectionTree(forest, session.tree);
    }

    return forest;
  }, [project, selectedPageId, pageId, sessionTrees]);
}

/** The block tree for one section (extracted from the page forest). */
export function useSectionBlockTree(
  sectionId: string | null,
  pageId?: string | null,
): BlockTree {
  const forest = useBlockForest(pageId);
  return useMemo(
    () => (sectionId ? extractSectionTree(forest, sectionId) : { rootIds: [], nodes: {} }),
    [forest, sectionId],
  );
}
