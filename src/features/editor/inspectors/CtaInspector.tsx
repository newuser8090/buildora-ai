"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { SharedSectionControls } from "./SharedSectionControls";
import { InspectorAssetField } from "@/features/assets/components/InspectorAssetField";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, CtaSectionProps } from "@/types/section";

export function CtaInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as CtaSectionProps;
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const update = (partial: Partial<CtaSectionProps>) => {
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
      <Field label="Heading">
        <Input
          value={props.headline}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ headline: e.target.value })}
        />
      </Field>

      <Field label="Description">
        <Textarea
          rows={2}
          value={props.subheadline ?? ""}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => update({ subheadline: e.target.value })}
        />
      </Field>

      <InspectorAssetField
        label="Background image"
        value={props.backgroundImage}
        allowedTypes={["image", "background"]}
        onChange={(ref) => update({ backgroundImage: ref })}
        description="Optional background image. Does not replace theme background color."
      />

      <Field label="Button label">
        <Input
          value={props.ctaText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ ctaText: e.target.value })}
        />
      </Field>

      <Field label="Button href">
        <Input
          value={props.ctaHref ?? "#"}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ ctaHref: e.target.value || "#" })}
        />
      </Field>

      <SharedSectionControls
        section={section}
        onUpdateProps={onUpdateProps}
        onUpdateStyles={onUpdateStyles}
      />
    </div>
  );
}
