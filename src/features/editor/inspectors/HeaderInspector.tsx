"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Field } from "@/components/ui/Field";
import { SharedSectionControls } from "./SharedSectionControls";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, HeaderSectionProps } from "@/types/section";

export function HeaderInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as HeaderSectionProps;
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const update = (partial: Partial<HeaderSectionProps>) => {
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
      <Field label="Brand name">
        <Input
          value={props.logoText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ logoText: e.target.value })}
        />
      </Field>

      <Field label="Navigation links">
        <div className="flex flex-col gap-2">
          {props.navLinks.map((link, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex gap-2">
                <Input
                  value={link.text}
                  onFocus={handleFocus}
                  onBlur={handleBlur}
                  onKeyDown={handleKeyDown}
                  onChange={(e) => {
                    const updated = [...props.navLinks];
                    updated[i] = { ...updated[i], text: e.target.value };
                    update({ navLinks: updated });
                  }}
                  placeholder="Label"
                  className="flex-1"
                />
              </div>
              <Input
                value={link.href ?? "#"}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                onChange={(e) => {
                  const updated = [...props.navLinks];
                  updated[i] = { ...updated[i], href: e.target.value || "#" };
                  update({ navLinks: updated });
                }}
                placeholder="/path"
                className="w-full text-xs text-text-dim"
              />
            </div>
          ))}
        </div>
      </Field>

      <Field label="CTA label">
        <Input
          value={props.ctaText ?? ""}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) => update({ ctaText: e.target.value })}
        />
      </Field>

      <Field label="CTA href">
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
