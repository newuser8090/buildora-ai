"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { SharedSectionControls } from "./SharedSectionControls";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, FaqSectionProps } from "@/types/section";

export function FaqInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as FaqSectionProps;
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const update = (partial: Partial<FaqSectionProps>) => {
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

      <Field label="FAQ items">
        <div className="flex flex-col gap-3">
          {props.items.map((item, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/40 bg-base/50 p-3"
            >
              <Field label={`Question ${i + 1}`}>
                <Input
                  value={item.question}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.items];
                    updated[i] = { ...updated[i], question: e.target.value };
                    update({ items: updated });
                  }}
                />
              </Field>

              <Field label="Answer" className="mt-2">
                <Textarea
                  rows={2}
                  value={item.answer}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onChange={(e) => {
                    const updated = [...props.items];
                    updated[i] = { ...updated[i], answer: e.target.value };
                    update({ items: updated });
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
