import { createElement } from "react";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { SelectableSection } from "@/features/editor/components/SelectableSection";
import { ErrorBoundary } from "@/features/editor/components/ErrorBoundary";
import { DurableTreeSection } from "@/features/editor/sections/DurableTreeSection";
import { durableTreeEnablesCustomCode } from "@/features/elements/adapters/section-element-adapter";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import { InlineEditPageProvider } from "@/features/inline-editing/context/InlineEditPageContext";
import { InsertionPoint } from "@/features/guided-builder/components/InsertionPoint";
import { MyBlockDropZone } from "@/features/my-blocks/drag/MyBlockDropZone";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import type { BaseSection } from "@/types/section";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SectionRendererProps {
  sections: BaseSection[];
  /** Active page id — enables inline editing bindings inside the preview. */
  pageId?: string;
  /**
   * When true (Guided mode in the editor), renders "+ Add something here"
   * affordances between sections. Never enabled for thumbnails/exports.
   */
  showInsertionPoints?: boolean;
  /**
   * Phase P5: when a My Block drag is active, renders visible drop zones
   * before/after each section, inside compatible custom-block sections, and
   * at the end of the page. Purely visual — the canvas never mutates during
   * hover; insertion happens once on drop.
   */
  myBlockDragActive?: boolean;
}

// ---------------------------------------------------------------------------
// Module-level helpers (outside of components, so they are stable)
// ---------------------------------------------------------------------------

/**
 * Resolve how a section renders (Phase P25, decisions D1/D2/D8).
 *
 * Additive dispatch — exactly one of two paths, never a third state:
 *
 *   1. TREE PATH — a non-`custom-block` section whose durable tree carries
 *      custom code that the export would emit renders through the block
 *      runtime (`DurableTreeSection` → `BlockRenderer`), so the inert
 *      custom-code placeholder is visible on the canvas. The predicate is the
 *      SAME emission gate the export pipeline consults, so the section the
 *      canvas renders as a tree is exactly the section the export emits as a
 *      sandboxed frame (OQ-1 resolved export-aligned).
 *   2. REGISTRY PATH — everything else, unchanged: `custom-block` keeps its
 *      dedicated `CustomBlockSection` (itself a `BlockRenderer` surface), and
 *      every other section keeps its props-driven component, so a durable
 *      section WITHOUT custom code (and every legacy section) preserves its
 *      bespoke layout byte-for-byte.
 *
 * `custom-block` is excluded from the tree path on purpose: its durable tree
 * lives in `props.tree` and its registered component also carries the section
 * chrome (empty-state, save-to-library). Routing it through the tree path would
 * silently drop that behaviour.
 */
function resolveSectionComponent(section: BaseSection): ReactNode {
  if (
    section.type !== CUSTOM_BLOCK_SECTION_TYPE &&
    durableTreeEnablesCustomCode(section)
  ) {
    return <DurableTreeSection section={section} />;
  }

  const Component = sectionRegistry.get(section.type);
  if (!Component) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: "var(--muted-foreground, #737373)",
          fontSize: "0.875rem",
          border: "1px dashed var(--border, #e5e5e5)",
          margin: "0.5rem",
          borderRadius: "0.5rem",
        }}
      >
        Unknown section type: &ldquo;{section.type}&rdquo;
      </div>
    );
  }
  return createElement(Component, { section });
}

// ---------------------------------------------------------------------------
// Individual section renderer with validation and error boundary
// ---------------------------------------------------------------------------

function ValidatedSectionRenderer({ section }: { section: BaseSection }) {
  const validation = validateSectionSafe(section);
  const validSection = validation.success
    ? (validation.data as BaseSection)
    : section;

  return (
    <ErrorBoundary>
      {resolveSectionComponent(validSection)}
    </ErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Renderer — renders an ordered list of visible sections
// ---------------------------------------------------------------------------

/**
 * Renders an ordered list of visible sections by dynamically resolving
 * each section's component from the **SectionRegistry**.
 *
 * Each section is wrapped in a **SelectableSection** that provides
 * hover/selection outlines and a floating type label.
 *
 * Each section rendering is protected by an **ErrorBoundary** to ensure
 * a crash in one section does not take down the entire preview.
 *
 * Every section is validated against its **section-specific Zod schema**
 * before rendering to catch malformed data.
 *
 * When `showInsertionPoints` is set (Guided mode), a "+ Add something here"
 * affordance is rendered after each visible section. It is purely visual
 * until clicked and never touches project/history state by itself.
 */
export function SectionRenderer({
  sections,
  pageId,
  showInsertionPoints = false,
  myBlockDragActive = false,
}: SectionRendererProps) {
  const visible = sections
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order);

  if (visible.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 2rem",
          color: "var(--muted-foreground, #737373)",
          fontSize: "0.9375rem",
        }}
      >
        No sections to display.
      </div>
    );
  }

  const content: ReactNode[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const section = visible[index];
    const isLast = index === visible.length - 1;

    if (myBlockDragActive && pageId) {
      content.push(
        <MyBlockDropZone
          key={`drop-before-${section.id}`}
          zone={{
            kind: "before-section",
            pageId,
            sectionId: section.id,
            label: "Add here",
          }}
        />,
      );
      if (section.type === CUSTOM_BLOCK_SECTION_TYPE) {
        content.push(
          <MyBlockDropZone
            key={`drop-inside-${section.id}`}
            zone={{
              kind: "inside-custom-block",
              pageId,
              sectionId: section.id,
              parentBlockId: section.id,
              label: "Place inside this group",
            }}
          />,
        );
      }
    }

    content.push(
      <SelectableSection key={section.id} section={section}>
        <ValidatedSectionRenderer section={section} />
      </SelectableSection>,
    );

    if (myBlockDragActive && pageId) {
      content.push(
        <MyBlockDropZone
          key={`drop-after-${section.id}`}
          zone={{
            kind: "after-section",
            pageId,
            sectionId: section.id,
            label: "Add below this section",
          }}
        />,
      );
      if (isLast) {
        content.push(
          <MyBlockDropZone
            key="drop-end"
            zone={{
              kind: "end-of-page",
              pageId,
              label: "Add at end of page",
            }}
          />,
        );
      }
    }

    if (showInsertionPoints) {
      content.push(
        <InsertionPoint key={`insert-${section.id}`} afterSectionId={section.id} />,
      );
    }
  }

  // The page context powers inline field bindings in the editor preview.
  // Absent (thumbnails), section components render plain text with no
  // data attributes or handlers.
  return pageId ? (
    <InlineEditPageProvider pageId={pageId}>{content}</InlineEditPageProvider>
  ) : (
    <>{content}</>
  );
}
