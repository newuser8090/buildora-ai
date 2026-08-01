"use client";

import { useCallback } from "react";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Field } from "@/components/ui/Field";
import { SharedSectionControls } from "./SharedSectionControls";
import { InspectorAssetField } from "@/features/assets/components/InspectorAssetField";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { BaseSection, HeroSectionProps } from "@/types/section";

export function HeroInspector({
  section,
  onUpdateProps,
  onUpdateStyles,
}: {
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}) {
  const props = section.props as unknown as HeroSectionProps;
  const beginEditSession = useEditorStore((s) => s.beginEditSession);
  const commitEditSession = useEditorStore((s) => s.commitEditSession);

  const update = (partial: Partial<HeroSectionProps>) => {
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
      <Field label="Headline">
        <Textarea
          rows={3}
          value={props.headline}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => update({ headline: e.target.value })}
        />
      </Field>

      <Field label="Subheadline">
        <Textarea
          rows={3}
          value={props.subheadline}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={(e) => update({ subheadline: e.target.value })}
        />
      </Field>

      <InspectorAssetField
        label="Content image"
        value={props.heroImage}
        allowedTypes={["image"]}
        onChange={(ref) => update({ heroImage: ref })}
        description="Main hero image. AssetRef takes precedence over legacy image URL."
        recommendedDimensions="1200×800px"
        allowAltText
        onFocus={handleFocus}
        onBlur={handleBlur}
      />

      <InspectorAssetField
        label="Background image"
        value={props.backgroundImage}
        allowedTypes={["image", "background"]}
        onChange={(ref) => update({ backgroundImage: ref })}
        description="Decorative background. Falls back to theme background color."
      />

      <Field label="Primary button label">
        <Input
          value={props.primaryCta.text}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) =>
            update({
              primaryCta: { ...props.primaryCta, text: e.target.value },
            })
          }
        />
      </Field>

      <Field label="Primary button href">
        <Input
          value={props.primaryCta.href ?? "#"}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) =>
            update({
              primaryCta: { ...props.primaryCta, href: e.target.value || "#" },
            })
          }
        />
      </Field>

      <Field label="Secondary button label">
        <Input
          value={props.secondaryCta?.text ?? ""}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) =>
            update({
              secondaryCta: props.secondaryCta
                ? { ...props.secondaryCta, text: e.target.value }
                : { text: e.target.value, href: "#" },
            })
          }
        />
      </Field>

      <Field label="Secondary button href">
        <Input
          value={props.secondaryCta?.href ?? "#"}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={(e) =>
            update({
              secondaryCta: props.secondaryCta
                ? { ...props.secondaryCta, href: e.target.value || "#" }
                : { text: "Learn More", href: e.target.value || "#" },
            })
          }
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
