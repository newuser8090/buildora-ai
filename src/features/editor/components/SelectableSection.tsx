"use client";

import { type ReactNode, useCallback, useRef } from "react";
import { Copy, Trash2 } from "lucide-react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// Label lookup helper
// ---------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  header: "Header",
  hero: "Hero",
  features: "Features",
  pricing: "Pricing",
  faq: "FAQ",
  cta: "CTA",
  footer: "Footer",
};

function getSectionLabel(type: string): string {
  return LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

// ---------------------------------------------------------------------------
// SelectableSection
// ---------------------------------------------------------------------------

export interface SelectableSectionProps {
  section: BaseSection;
  children: ReactNode;
}

export function SelectableSection({
  section,
  children,
}: SelectableSectionProps) {
  const selectedId = useEditorStore((s) => s.selectedSectionId);
  const selectSection = useEditorStore((s) => s.selectSection);
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const deleteSection = useEditorStore((s) => s.deleteSection);

  const isSelected = selectedId === section.id;
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      selectSection(section.id);
    },
    [section.id, selectSection],
  );

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      duplicateSection(section.id);
    },
    [section.id, duplicateSection],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteSection(section.id);
    },
    [section.id, deleteSection],
  );

  return (
    <div
      ref={containerRef}
      data-testid={isSelected ? "selected-section" : "section-wrapper"}
      onClick={handleClick}
      className="group/selectable relative transition-all duration-200 motion-reduce:transition-none"
      style={{
        outline: isSelected
          ? "2px solid #7c5cfc"
          : "2px solid transparent",
        outlineOffset: isSelected ? "-2px" : "-1px",
      }}
    >
      {/* Hover outline (subtle purple) */}
      <div
        className="pointer-events-none absolute inset-0 rounded-none transition-all duration-200 motion-reduce:transition-none group-hover/selectable:outline group-hover/selectable:outline-2 group-hover/selectable:outline-purple-500/30"
        aria-hidden="true"
        style={{
          outline: isSelected ? "none" : undefined,
        }}
      />

      {/* Floating label */}
      <div
        className="pointer-events-none absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md px-2 text-[11px] font-semibold uppercase tracking-wider opacity-0 shadow-sm transition-all duration-200 motion-reduce:transition-none group-hover/selectable:opacity-100"
        style={{
          opacity: isSelected ? 1 : undefined,
          background: isSelected ? "#7c5cfc" : "#1a2235",
          color: "#ffffff",
        }}
        aria-hidden="true"
      >
        <span>{getSectionLabel(section.type)}</span>

        {/* Compact action buttons (only visible when selected) */}
        {isSelected && (
          <span className="ml-1.5 flex items-center gap-0.5">
            <span
              data-testid="duplicate-section"
              role="button"
              tabIndex={0}
              onClick={handleDuplicate}
              onKeyDown={(e) => e.key === "Enter" && handleDuplicate(e as unknown as React.MouseEvent)}
              className="pointer-events-auto ml-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded hover:bg-white/20"
              aria-label={`Duplicate ${getSectionLabel(section.type)}`}
            >
              <Copy className="h-2.5 w-2.5" />
            </span>
            <span
              data-testid="delete-section"
              role="button"
              tabIndex={0}
              onClick={handleDelete}
              onKeyDown={(e) => e.key === "Enter" && handleDelete(e as unknown as React.MouseEvent)}
              className="pointer-events-auto flex h-4 w-4 cursor-pointer items-center justify-center rounded hover:bg-white/20"
              aria-label={`Delete ${getSectionLabel(section.type)}`}
            >
              <Trash2 className="h-2.5 w-2.5" />
            </span>
          </span>
        )}
      </div>

      {children}
    </div>
  );
}
