"use client";

// ---------------------------------------------------------------------------
// CustomBlockSection — renders a persisted custom-block section (Phase P3)
//
// The stored BlockTree is rendered natively through the Phase O block registry
// semantics (BlockRenderer). In the editor preview it supports:
//   - canvas selection of individual blocks (syncs the build tree + inspector)
//   - inline text editing on text-bearing blocks (persisted via block ops)
//   - responsive overrides resolved against the current viewport
//
// Never executes imported code. When pageId is absent (thumbnails, import
// previews) all interactions are disabled.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { BaseSection } from "@/types/section";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import { BlockRenderer } from "@/features/blocks/render/BlockRenderer";
import { styleTokensToCss } from "@/features/blocks/render/block-style-to-css";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { useBlockOperations } from "@/features/blocks/hooks/useBlockOperations";
import { rootIdOf } from "@/features/blocks/engine/tree-traversal";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useInlineEditPageId } from "@/features/inline-editing/context/InlineEditPageContext";

const VIEWPORT_WIDTHS: Record<string, number> = {
  desktop: 1440,
  tablet: 768,
  mobile: 390,
};

export function CustomBlockSection({ section }: { section: BaseSection }) {
  const pageId = useInlineEditPageId();
  const viewport = useEditorStore((s) => s.viewport);
  const selectedBlockId = useBlockEditorStore((s) => s.selectedBlockId);
  const selectBlock = useBlockEditorStore((s) => s.selectBlock);
  const selectSection = useEditorStore((s) => s.selectSection);
  const ops = useBlockOperations(pageId);

  const tree = useMemo(() => customBlockTreeFromSection(section), [section]);

  const interactive = !!pageId;

  if (tree.rootIds.length === 0) {
    return (
      <section
        data-testid="custom-block-section"
        style={{
          ...styleTokensToCss(section.styles ?? {}),
          padding: "3rem 1rem",
          textAlign: "center",
          color: "var(--muted-foreground, #737373)",
        }}
      >
        This imported design is empty.
      </section>
    );
  }

  return (
    <section data-testid="custom-block-section" style={styleTokensToCss(section.styles ?? {})}>
      <BlockRenderer
        tree={tree}
        viewportWidth={VIEWPORT_WIDTHS[viewport] ?? 1440}
        selectedBlockId={selectedBlockId}
        editable={interactive}
        onSelectBlock={
          interactive
            ? (nodeId) => {
                selectBlock(nodeId);
                const rootId = rootIdOf(tree, nodeId);
                if (rootId) selectSection(rootId);
              }
            : undefined
        }
        onEditText={
          interactive
            ? (nodeId, next) => ops.updateBlockText(nodeId, next)
            : undefined
        }
      />
    </section>
  );
}
