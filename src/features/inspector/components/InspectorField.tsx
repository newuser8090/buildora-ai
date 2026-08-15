"use client";

// ---------------------------------------------------------------------------
// InspectorField (Phase P22-C) — the single control dispatcher
//
// One field definition + one resolved value → the correct control. This is
// the heart of the "universal" inspector: element types declare fields, the
// dispatcher renders them — there is no per-type editing code here.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { Page } from "@/types/project";
import type { InspectorFieldDef, InspectorResolvedValue } from "@/features/elements/inspector/types";
import { validateInspectorFieldValue } from "@/features/elements/inspector/mutate";
import type { Collection } from "@/features/elements/collections/types";
import type { ElementNode, ElementTree } from "@/features/elements/types";
import { NumberField } from "./controls/NumberField";
import { TextField } from "./controls/TextField";
import {
  AlignmentField,
  FontFamilyField,
  SegmentedField,
  SelectField,
  ToggleField,
} from "./controls/ChoiceField";
import { ColorField, SliderField } from "./controls/ColorField";
import { RadiusField, ShadowField, SpacingField } from "./controls/SurfaceFields";
import { AnimationField } from "./controls/AnimationField";
import { InteractionField } from "./controls/InteractionField";
import { BindingField } from "./controls/BindingField";

export interface InspectorFieldProps {
  field: InspectorFieldDef;
  resolved: InspectorResolvedValue;
  palette: string[];
  disabled?: boolean;
  /**
   * Phase P22-G — project pages (NavTarget authoring) and the section's
   * element tree (scroll-to targets) for the composite controls.
   */
  pages?: Page[];
  tree?: ElementTree;
  sectionId?: string;
  /**
   * Phase P22-J — project collections + the inspected node for the data
   * binding composite control.
   */
  collections?: Collection[];
  node?: ElementNode;
  onCommit: (value: unknown) => boolean;
  onResetOverride: () => void;
  onCommitSpacingSide: (side: "top" | "right" | "bottom" | "left", value: string | undefined) => boolean;
}

export function InspectorField({
  field,
  resolved,
  palette,
  disabled,
  pages,
  tree,
  sectionId,
  collections,
  node,
  onCommit,
  onResetOverride,
  onCommitSpacingSide,
}: InspectorFieldProps) {
  const [error, setError] = useState<string | null>(null);

  const handleCommit = (raw: unknown): boolean => {
    const validated = validateInspectorFieldValue(field, raw);
    if (!validated.ok) {
      setError(validated.error ?? "Invalid value.");
      return false;
    }
    setError(null);
    return onCommit(validated.value);
  };

  const showReset = field.responsiveCapable && resolved.overridden;
  const common = {
    field,
    error,
    overridden: showReset,
    onResetOverride: showReset ? onResetOverride : undefined,
    disabled,
  };

  switch (field.kind) {
    case "text":
    case "textarea":
      return <TextField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "number":
      return <NumberField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "slider":
      return <SliderField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "color":
      return <ColorField {...common} value={resolved.value} palette={palette} onCommit={handleCommit} />;

    case "select":
      return <SelectField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "font-family":
      return <FontFamilyField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "alignment":
      return <AlignmentField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "grid-columns":
      return <SegmentedField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "segmented":
      return <SegmentedField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "toggle": {
      // The "Visible" toggle is the inverse of the stored `hidden` flag.
      const checked = field.key === "hidden" ? resolved.value !== true : resolved.value === true;
      return (
        <ToggleField
          field={field}
          checked={checked}
          error={error}
          disabled={disabled}
          onCommit={(next) => {
            setError(null);
            onCommit(field.key === "hidden" ? !next : next);
          }}
        />
      );
    }

    case "spacing":
      return (
        <SpacingField
          field={field}
          value={resolved.value as import("@/features/elements/inspector/resolver").SpacingSidesDisplay | null}
          error={error}
          overridden={showReset}
          onResetOverride={showReset ? onResetOverride : undefined}
          disabled={disabled}
          onCommitSide={(side, value) => {
            if (value === undefined) return;
            setError(null);
            onCommitSpacingSide(side, value);
          }}
        />
      );

    case "radius":
      return <RadiusField {...common} value={resolved.value} onCommit={handleCommit} />;

    case "shadow":
      return <ShadowField {...common} value={resolved.value} onCommit={handleCommit} />;

    // Phase P22-G — composite declarative animation / interaction editors.
    // They author the whole object and commit through the same validated path.
    case "animation":
      return (
        <AnimationField
          field={field}
          value={resolved.value}
          disabled={disabled}
          onCommit={handleCommit}
        />
      );

    case "interaction":
      return (
        <InteractionField
          field={field}
          value={resolved.value}
          pages={pages ?? []}
          tree={tree ?? { rootIds: [], nodes: {} }}
          sectionId={sectionId ?? ""}
          disabled={disabled}
          onCommit={handleCommit}
        />
      );

    // Phase P22-J — composite declarative data binding editor.
    case "binding":
      return (
        <BindingField
          field={field}
          value={resolved.value}
          node={node}
          collections={collections ?? []}
          disabled={disabled}
          onCommit={handleCommit}
        />
      );

    default:
      return null;
  }
}
