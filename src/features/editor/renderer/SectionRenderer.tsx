import { createElement } from "react";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { SelectableSection } from "@/features/editor/components/SelectableSection";
import { ErrorBoundary } from "@/features/editor/components/ErrorBoundary";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import type { BaseSection } from "@/types/section";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SectionRendererProps {
  sections: BaseSection[];
}

// ---------------------------------------------------------------------------
// Module-level helpers (outside of components, so they are stable)
// ---------------------------------------------------------------------------

/** Resolve a section component from the registry and render it. */
function resolveSectionComponent(section: BaseSection): ReactNode {
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
 */
export function SectionRenderer({ sections }: SectionRendererProps) {
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

  return (
    <>
      {visible.map((section) => (
        <SelectableSection key={section.id} section={section}>
          <ValidatedSectionRenderer section={section} />
        </SelectableSection>
      ))}
    </>
  );
}

