"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { Switch } from "@/components/ui/Switch";
import { SharedSectionControls } from "./SharedSectionControls";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, PricingSectionProps } from "@/types/section";

export function PricingInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as PricingSectionProps;
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);
  const cancelEditSession = useEditorStore((s) => s.cancelEditSession);

  const update = (partial: Partial<PricingSectionProps>) => {
    onUpdateProps(partial as unknown as Record<string, unknown>);
  };

  const toggleHighlight = (planIndex: number) => {
    beginEditSession();
    const updated = props.plans.map((plan, i) => ({
      ...plan,
      highlighted: i === planIndex,
    }));
    update({ plans: updated });
    commitEditSession();
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
      if (e.key === "Escape") {
        (e.target as HTMLElement).blur();
        cancelEditSession();
      }
    },
    [cancelEditSession],
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

      <Field label="Plans">
        <div className="flex flex-col gap-3">
          {props.plans.map((plan, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/40 bg-base/50 p-3"
            >
              <Field label={`Plan ${i + 1} name`}>
                <Input
                  value={plan.name}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.plans];
                    updated[i] = { ...updated[i], name: e.target.value };
                    update({ plans: updated });
                  }}
                />
              </Field>

              <Field label="Price" className="mt-2">
                <Input
                  value={plan.price}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.plans];
                    updated[i] = { ...updated[i], price: e.target.value };
                    update({ plans: updated });
                  }}
                />
              </Field>

              <Field label="CTA label" className="mt-2">
                <Input
                  value={plan.cta}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.plans];
                    updated[i] = { ...updated[i], cta: e.target.value };
                    update({ plans: updated });
                  }}
                />
              </Field>

              <div className="mt-2">
                <Switch
                  label="Popular / highlighted"
                  checked={plan.highlighted ?? false}
                  onChange={() => toggleHighlight(i)}
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
