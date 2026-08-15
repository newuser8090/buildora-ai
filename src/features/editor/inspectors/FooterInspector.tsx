"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { SharedSectionControls } from "./SharedSectionControls";
import { InspectorAssetField } from "@/features/assets/components/InspectorAssetField";
import { NavigateToPicker } from "@/features/editor/components/NavigateToPicker";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, FooterSectionProps } from "@/types/section";

export function FooterInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as FooterSectionProps;
  const pages = useEditorStore((s) => s.project.pages);
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const update = (partial: Partial<FooterSectionProps>) => {
    onUpdateProps(partial as unknown as Record<string, unknown>);
  };

  const handleFocus = useCallback(() => {
    beginEditSession();
  }, [beginEditSession]);

  const handleBlur = useCallback(() => {
    commitEditSession();
  }, [commitEditSession]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        (e.target as HTMLElement).blur();
      }
    },
    [],
  );

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <Field label="Copyright text">
        <Input
          value={props.text}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ text: e.target.value })}
        />
      </Field>

      <InspectorAssetField
        label="Logo image"
        value={props.logoImage}
        allowedTypes={["image", "logo"]}
        onChange={(ref) => update({ logoImage: ref })}
        description="Optional footer logo. Falls back to site name text."
        allowAltText
      />

      <Field label="Links">
        <div className="flex flex-col gap-2">
          {props.links.map((link, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <Input
                  value={link.text}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.links];
                    updated[i] = { ...updated[i], text: e.target.value };
                    update({ links: updated });
                  }}
                  placeholder="Label"
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={link.href ?? "#"}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.links];
                    updated[i] = { ...updated[i], href: e.target.value || "#" };
                    update({ links: updated });
                  }}
                  placeholder="/path"
                  className="min-w-0 flex-1 text-xs text-text-dim"
                />
                <NavigateToPicker
                  pages={pages}
                  value={link.href ?? "#"}
                  onChange={(href) => {
                    const updated = [...props.links];
                    updated[i] = { ...updated[i], href };
                    update({ links: updated });
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </Field>

      <SharedSectionControls
        section={section}
        onUpdateProps={onUpdateProps}
        onUpdateStyles={onUpdateStyles}
      />
    </div>
  );
}
