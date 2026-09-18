"use client";

// ---------------------------------------------------------------------------
// DurableTreeSection — renders a REGULAR section's durable element tree
// (Phase P25, Slice 1 — decisions D1/D4/D8, OQ-1 resolved export-aligned)
//
// A section with a Phase-P24-B durable tree (`BaseSection.tree`) whose tree
// carries custom code renders here instead of its bespoke props component, so
// the inert custom-code placeholder is visible on the editor canvas.
//
// Why this component and not a projection:
//   - The tree is materialized through `sectionToElementTree`, the SINGLE
//     materialization entry, which keeps `reconcileDurableTreeWithProps` active
//     — bound text edited inline or via the inspector can never be reverted by
//     a later tree commit.
//   - `elementTreeToBlockTree()` is deliberately NOT used: it deep-strips
//     `customCode` (the payload this phase exists to surface) plus
//     `viewport`/`animation`/`interaction`, which `BlockRenderer` genuinely
//     consumes. The export projection is not used either — it is a flag-only,
//     distribution-boundary projection with no text, geometry or code text.
//     `ElementNode` is structurally a `BlockNode`, so the tree renders as-is.
//
// Safety: this component NEVER executes user code and never mounts an iframe.
// An element with enabled custom code renders `BlockRenderer`'s inert
// placeholder; execution stays in the published site's sandbox (P23-C).
//
// Slice-1 scope note: interactivity (element focus, inline text editing) is
// intentionally NOT wired here yet — that is Phase P25 Slice 2. Rendering is
// read-only, which also guarantees no lossy block-pipeline commit can ever be
// routed at a durable tree.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import type { BaseSection } from "@/types/section";
import type { BlockTree } from "@/features/blocks/types";
import { BlockRenderer } from "@/features/blocks/render/BlockRenderer";
import { styleTokensToCss } from "@/features/blocks/render/block-style-to-css";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useDataIntegrationStore } from "@/features/integrations/store/data-integration-store";

/** Same viewport→width map the custom-block canvas surface uses. */
const VIEWPORT_WIDTHS: Record<string, number> = {
  desktop: 1440,
  tablet: 768,
  mobile: 390,
};

export function DurableTreeSection({ section }: { section: BaseSection }) {
  const viewport = useEditorStore((s) => s.viewport);
  const pages = useEditorStore((s) => s.project.pages);
  // Phase P22-J — durable collection definitions + runtime records so bound
  // elements resolve against real (mock/Supabase) data in the canvas preview.
  const collections = useEditorStore((s) => s.project.collections);
  const integrationRecords = useDataIntegrationStore((s) => s.records);

  // The reconciled durable tree (live props → bound child content).
  const tree = useMemo(() => sectionToElementTree(section), [section]);

  return (
    <section
      data-testid="durable-tree-section"
      style={{ position: "relative", ...styleTokensToCss(section.styles ?? {}) }}
    >
      <BlockRenderer
        tree={tree as unknown as BlockTree}
        viewportWidth={VIEWPORT_WIDTHS[viewport] ?? 1440}
        pages={pages}
        collections={collections}
        records={integrationRecords}
      />
    </section>
  );
}
