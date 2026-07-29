"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { SharedSectionControls } from "./SharedSectionControls";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, FeaturesSectionProps } from "@/types/section";

export function FeaturesInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as FeaturesSectionProps;
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const update = (partial: Partial<FeaturesSectionProps>) => {
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
      <Field label="Section heading">
        <Input
          value={props.title}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ title: e.target.value })}
        />
      </Field>

      <Field label="Section description">
        <Textarea
          rows={2}
          value={props.subtitle ?? ""}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => update({ subtitle: e.target.value })}
        />
      </Field>

      <Field label="Features">
        <div className="flex flex-col gap-3">
          {props.features.map((feature, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/40 bg-base/50 p-3"
            >
              <Field label={`Feature ${i + 1} title`}>
                <Input
                  value={feature.title}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.features];
                    updated[i] = { ...updated[i], title: e.target.value };
                    update({ features: updated });
                  }}
                />
              </Field>
              <Field label="Description" className="mt-2">
                <Textarea
                  rows={2}
                  value={feature.description}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onChange={(e) => {
                    const updated = [...props.features];
                    updated[i] = {
                      ...updated[i],
                      description: e.target.value,
                    };
                    update({ features: updated });
                  }}
                />
              </Field>
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
