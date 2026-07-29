"use client";

import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Select } from "@/components/ui/Select";
import { Field, FieldRow } from "@/components/ui/Field";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection } from "@/types/section";

// ---------------------------------------------------------------------------
// SharedSectionControls
// ---------------------------------------------------------------------------

export interface SharedSectionControlsProps {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}

export function SharedSectionControls({
  section,
  onUpdateStyles,
}: SharedSectionControlsProps) {
  const deleteSection = useEditorStore((s) => s.deleteSection);
  const duplicateSection = useEditorStore((s) => s.duplicateSection);
  const updateSection = useEditorStore((s) => s.updateSection);
  const project = useEditorStore((s) => s.project);

  const page = project.pages.find((p) =>
    p.sections.some((s) => s.id === section.id),
  );
  const isLastSection = page ? page.sections.length <= 1 : true;

  // Derive vertical padding from styles.padding or default
  const currentPadding =
    typeof section.styles.padding === "string"
      ? section.styles.padding
      : "";

  const alignmentOptions = [
    { value: "left", label: "Left" },
    { value: "center", label: "Center" },
    { value: "right", label: "Right" },
  ];

  return (
    <div className="flex flex-col gap-3 border-t border-border/40 pt-3 mt-3">
      {/* Visibility — section-level field, use updateSection */}
      <FieldRow label="Visible">
        <Switch
          checked={section.visible}
          onChange={(v) => updateSection(section.id, { visible: v })}
        />
      </FieldRow>

      {/* Text alignment */}
      <Field label="Text alignment">
        <Select
          options={alignmentOptions}
          value={
            (section.styles.textAlign as string) ?? "center"
          }
          onChange={(e) =>
            onUpdateStyles({ textAlign: e.target.value })
          }
        />
      </Field>

      {/* Vertical padding */}
      <Field label="Vertical padding">
        <Input
          type="text"
          placeholder="e.g. 5rem 0"
          value={currentPadding}
          onChange={(e) =>
            onUpdateStyles({ padding: e.target.value })
          }
        />
      </Field>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => duplicateSection(section.id)}
          className="flex h-7 flex-1 items-center justify-center rounded-md bg-card text-xs font-medium text-text-muted transition-all duration-200 hover:bg-accent/10 hover:text-accent active:scale-95"
        >
          Duplicate
        </button>

        <button
          type="button"
          onClick={() => !isLastSection && deleteSection(section.id)}
          disabled={isLastSection}
          className="flex h-7 flex-1 items-center justify-center rounded-md bg-card text-xs font-medium text-text-muted transition-all duration-200 hover:bg-red-500/10 hover:text-red-400 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          title={
            isLastSection ? "Cannot delete the final section" : "Delete section"
          }
        >
          Delete
        </button>
      </div>

      {isLastSection && (
        <p className="text-[11px] text-text-dim/60 text-center">
          Cannot delete the last section on this page.
        </p>
      )}
    </div>
  );
}
