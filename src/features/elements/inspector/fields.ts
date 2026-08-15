// ---------------------------------------------------------------------------
// Inspector field factories (Phase P22-C) — pure, deterministic builders
//
// Shared field definitions used by every element schema. Values live in the
// node's style tokens, geometry, props, or a11y record — the `source`/`key`
// pair routes each change to the right element operation.
// ---------------------------------------------------------------------------

import type { InspectorFieldDef } from "./types";
import { isSafeColorValue } from "./validation";

// ---------------------------------------------------------------------------
// Choice option sets
// ---------------------------------------------------------------------------

export const FONT_FAMILY_OPTIONS = [
  { value: "Geist, system-ui, sans-serif", label: "System (Geist)" },
  { value: "Inter, system-ui, sans-serif", label: "Inter" },
  { value: "Roboto, system-ui, sans-serif", label: "Roboto" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "ui-monospace, monospace", label: "Mono (system)" },
] as const;

const FONT_WEIGHT_OPTIONS = [
  { value: "400", label: "400" },
  { value: "500", label: "500" },
  { value: "600", label: "600" },
  { value: "700", label: "700" },
  { value: "800", label: "800" },
];

const TEXT_ALIGN_OPTIONS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
  { value: "justify", label: "Justify" },
];

const TEXT_DECORATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "underline", label: "Underline" },
  { value: "line-through", label: "Strikethrough" },
];

const TEXT_TRANSFORM_OPTIONS = [
  { value: "none", label: "None" },
  { value: "uppercase", label: "UPPERCASE" },
  { value: "lowercase", label: "lowercase" },
  { value: "capitalize", label: "Capitalize" },
];

const BORDER_OPTIONS = [
  { value: "none", label: "None" },
  { value: "1px solid var(--border, #e5e5e5)", label: "Thin" },
  { value: "1px solid var(--foreground, #0a0a0a)", label: "Thin dark" },
  { value: "2px solid var(--border, #e5e5e5)", label: "Thick" },
  { value: "2px solid var(--accent, #7c5cfc)", label: "Thick accent" },
];

const SHADOW_OPTIONS = [
  { value: "none", label: "None" },
  { value: "var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))", label: "Small" },
  { value: "var(--shadow-md, 0 4px 6px rgba(0,0,0,0.07))", label: "Medium" },
  { value: "var(--shadow-lg, 0 10px 15px rgba(0,0,0,0.1))", label: "Large" },
  { value: "var(--shadow-xl, 0 20px 25px rgba(0,0,0,0.15))", label: "Extra large" },
];

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export function typographyFields(): InspectorFieldDef[] {
  return [
    {
      id: "fontFamily",
      label: "Font",
      kind: "font-family",
      source: "style",
      key: "fontFamily",
      responsiveCapable: true,
      options: [...FONT_FAMILY_OPTIONS],
    },
    {
      id: "fontSize",
      label: "Size",
      kind: "number",
      source: "style",
      key: "fontSize",
      responsiveCapable: true,
      unit: "px",
      min: 6,
      max: 200,
      step: 1,
      default: 16,
    },
    {
      id: "fontWeight",
      label: "Weight",
      kind: "segmented",
      source: "style",
      key: "fontWeight",
      responsiveCapable: true,
      options: FONT_WEIGHT_OPTIONS,
      default: 400,
    },
    {
      id: "fontStyle",
      label: "Italic",
      kind: "toggle",
      source: "style",
      key: "fontStyle",
      responsiveCapable: true,
      default: "normal",
    },
    {
      id: "lineHeight",
      label: "Line height",
      kind: "number",
      source: "style",
      key: "lineHeight",
      responsiveCapable: true,
      unit: "",
      min: 0.5,
      max: 4,
      step: 0.1,
      default: 1.6,
    },
    {
      id: "letterSpacing",
      label: "Letter spacing",
      kind: "number",
      source: "style",
      key: "letterSpacing",
      responsiveCapable: true,
      unit: "px",
      min: -10,
      max: 50,
      step: 0.5,
      default: 0,
    },
    {
      id: "textAlign",
      label: "Alignment",
      kind: "alignment",
      source: "style",
      key: "textAlign",
      responsiveCapable: true,
      options: TEXT_ALIGN_OPTIONS,
      default: "left",
    },
    {
      id: "color",
      label: "Text color",
      kind: "color",
      source: "style",
      key: "color",
      responsiveCapable: true,
      default: "var(--foreground, #0a0a0a)",
      validate: (value) => (isSafeColorValue(value) ? null : "Enter a valid color."),
    },
    {
      id: "textDecoration",
      label: "Decoration",
      kind: "select",
      source: "style",
      key: "textDecoration",
      responsiveCapable: true,
      options: TEXT_DECORATION_OPTIONS,
      default: "none",
    },
    {
      id: "textTransform",
      label: "Case",
      kind: "select",
      source: "style",
      key: "textTransform",
      responsiveCapable: true,
      options: TEXT_TRANSFORM_OPTIONS,
      default: "none",
    },
  ];
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export function appearanceFields(): InspectorFieldDef[] {
  return [
    {
      id: "backgroundColor",
      label: "Background",
      kind: "color",
      source: "style",
      key: "backgroundColor",
      responsiveCapable: true,
      default: "transparent",
      validate: (value) => (isSafeColorValue(value) ? null : "Enter a valid color."),
    },
    {
      id: "opacity",
      label: "Opacity",
      kind: "slider",
      source: "style",
      key: "opacity",
      responsiveCapable: true,
      min: 0,
      max: 100,
      step: 1,
      default: 100,
    },
    {
      id: "border",
      label: "Border",
      kind: "select",
      source: "style",
      key: "border",
      responsiveCapable: true,
      options: BORDER_OPTIONS,
      default: "none",
    },
    {
      id: "borderColor",
      label: "Border color",
      kind: "color",
      source: "style",
      key: "borderColor",
      responsiveCapable: true,
      default: "var(--border, #e5e5e5)",
      validate: (value) => (isSafeColorValue(value) ? null : "Enter a valid color."),
    },
    {
      id: "borderRadius",
      label: "Radius",
      kind: "radius",
      source: "style",
      key: "borderRadius",
      responsiveCapable: true,
      min: 0,
      max: 200,
      step: 1,
      default: 0,
    },
    {
      id: "boxShadow",
      label: "Shadow",
      kind: "shadow",
      source: "style",
      key: "boxShadow",
      responsiveCapable: true,
      options: SHADOW_OPTIONS,
      default: "none",
    },
  ];
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function layoutFields(
  includeFlexDirection: boolean,
  includeGridColumns?: boolean,
): InspectorFieldDef[] {
  const fields: InspectorFieldDef[] = [
    {
      id: "width",
      label: "Width",
      kind: "number",
      source: "geometry",
      key: "width",
      min: 0,
      max: 10000,
      step: 1,
      unit: "px",
      placeholder: "Auto",
    },
    {
      id: "height",
      label: "Height",
      kind: "number",
      source: "geometry",
      key: "height",
      min: 0,
      max: 10000,
      step: 1,
      unit: "px",
      placeholder: "Auto",
    },
    {
      id: "rotation",
      label: "Rotation",
      kind: "number",
      source: "geometry",
      key: "rotation",
      min: -360,
      max: 360,
      step: 1,
      unit: "deg",
      default: 0,
    },
  ];
  if (includeFlexDirection) {
    fields.push({
      id: "flexDirection",
      label: "Direction",
      kind: "segmented",
      source: "style",
      key: "flexDirection",
      responsiveCapable: true,
      options: [
        { value: "row", label: "Row" },
        { value: "column", label: "Column" },
        { value: "row-reverse", label: "Row reverse" },
        { value: "column-reverse", label: "Column reverse" },
      ],
      default: "row",
    });
  }
  if (includeGridColumns) {
    fields.push(gridColumnsField());
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Grid columns (Phase P22-F) — responsive on the existing viewport model
//
// Base (desktop) writes props.columns (the block renderer's default);
// tablet/mobile write/read a `gridTemplateColumns` viewport override so the
// same element resolution path used by the canvas and export applies.
// ---------------------------------------------------------------------------

const GRID_COLUMN_OPTIONS = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: String(n),
  label: String(n),
}));

export function gridColumnsField(): InspectorFieldDef {
  return {
    id: "columns",
    label: "Columns",
    kind: "grid-columns",
    source: "props",
    key: "columns",
    responsiveCapable: true,
    min: 1,
    max: 6,
    step: 1,
    default: 3,
    options: GRID_COLUMN_OPTIONS,
    hint: "Columns at the current breakpoint",
  };
}

// ---------------------------------------------------------------------------
// Spacing (4-way groups)
// ---------------------------------------------------------------------------

export function spacingFields(): InspectorFieldDef[] {
  return [
    {
      id: "padding",
      label: "Padding",
      kind: "spacing",
      source: "style",
      key: "padding",
      responsiveCapable: true,
      default: "0",
      hint: "Space inside the element",
    },
    {
      id: "margin",
      label: "Margin",
      kind: "spacing",
      source: "style",
      key: "margin",
      responsiveCapable: true,
      default: "0",
      hint: "Space outside the element",
    },
  ];
}

// ---------------------------------------------------------------------------
// Phase P22-G — animation + interaction (composite declarative controls)
//
// The whole ElementAnimation / ElementInteraction object is authored in a
// bespoke control component and committed through the same validated field
// path (source "animation" / "interaction" → updateElementAnimation /
// updateElementInteraction). Values are schema-bounded; clearing commits null.
// ---------------------------------------------------------------------------

export function animationField(): InspectorFieldDef {
  return {
    id: "animation",
    label: "Animation",
    kind: "animation",
    source: "animation",
    key: "animation",
    hint: "Entrance and interaction animations",
  };
}

export function interactionField(): InspectorFieldDef {
  return {
    id: "interaction",
    label: "Interactions",
    kind: "interaction",
    source: "interaction",
    key: "interaction",
    hint: "Click, hover and focus behavior",
  };
}

// ---------------------------------------------------------------------------
// Phase P22-J — data binding (composite declarative control)
//
// The whole ElementBinding object (source/collectionId/path/field) is authored
// in a bespoke control and committed through the same validated field path
// (source "binding" → updateElementBinding). null clears the binding.
// ---------------------------------------------------------------------------

export function bindingField(): InspectorFieldDef {
  return {
    id: "binding",
    label: "Data binding",
    kind: "binding",
    source: "binding",
    key: "binding",
    hint: "Pull values from a collection into this element",
  };
}

// ---------------------------------------------------------------------------
// Phase P23-D — custom code (composite declarative control)
//
// The whole ElementCustomCode object (html/css/js) is authored in a bespoke
// control and committed through the same validated field path (source
// "customCode" → updateElementCustomCode). The field is only ever attached
// to the curated leaf content blocks (schemas.ts gates on
// elementSupportsCustomCode) — never broad. `enabled` defaults false, so
// authored code stays inert until the user explicitly opts in.
// ---------------------------------------------------------------------------

export function customCodeField(): InspectorFieldDef {
  return {
    id: "customCode",
    label: "Custom code",
    kind: "custom-code",
    source: "customCode",
    key: "customCode",
    hint: "Advanced HTML/CSS/JS — runs only in the published site",
  };
}

// ---------------------------------------------------------------------------
// Advanced (positioning / visibility / lock)
// ---------------------------------------------------------------------------

export function advancedFields(): InspectorFieldDef[] {
  return [
    {
      id: "positionMode",
      label: "Position",
      kind: "segmented",
      source: "geometry",
      key: "mode",
      options: [
        { value: "flow", label: "Flow" },
        { value: "absolute", label: "Absolute" },
      ],
      default: "flow",
    },
    {
      id: "x",
      label: "X",
      kind: "number",
      source: "geometry",
      key: "x",
      min: -10000,
      max: 10000,
      step: 1,
      unit: "px",
      placeholder: "Auto",
    },
    {
      id: "y",
      label: "Y",
      kind: "number",
      source: "geometry",
      key: "y",
      min: -10000,
      max: 10000,
      step: 1,
      unit: "px",
      placeholder: "Auto",
    },
    {
      id: "hidden",
      label: "Visible",
      kind: "toggle",
      source: "node",
      key: "hidden",
      default: false,
      hint: "Hides the element from the page",
    },
    {
      id: "locked",
      label: "Locked",
      kind: "toggle",
      source: "node",
      key: "locked",
      default: false,
      hint: "Prevents moving, resizing and editing",
    },
  ];
}

// ---------------------------------------------------------------------------
// Content — derived from the registry definition's editable fields
// ---------------------------------------------------------------------------

const EDITABLE_KIND_TO_FIELD: Record<string, InspectorFieldDef["kind"]> = {
  text: "text",
  "link-text": "text",
  "button-text": "text",
  heading: "text",
  description: "textarea",
  textarea: "textarea",
};

/**
 * Prop keys that carry structural/styling data rather than visible copy —
 * editing them through the universal inspector would be misleading (the
 * renderer does not consume them as content).
 */
const NON_CONTENT_PROPS = new Set(["align", "style", "level", "columns"]);

/**
 * Build content fields from an element definition's editable fields, with an
 * image fallback (src/alt) for media elements that have none registered.
 */
export function contentFields(
  editableFields: Array<{ id: string; fieldPath: string[]; kind: string; label: string; maxLength?: number }>,
  type: string,
): InspectorFieldDef[] {
  const fields: InspectorFieldDef[] = [];

  for (const field of editableFields) {
    // Only simple single-key prop paths are inspector-editable today, and
    // only props that are genuinely visible copy.
    if (field.fieldPath.length !== 1) continue;
    if (NON_CONTENT_PROPS.has(field.fieldPath[0])) continue;
    fields.push({
      id: `content-${field.id}`,
      label: field.label,
      kind: EDITABLE_KIND_TO_FIELD[field.kind] ?? "text",
      source: "props",
      key: field.fieldPath[0],
      maxLength: field.maxLength ?? 4000,
      responsiveCapable: false,
    });
  }

  // Media fallback — src/alt are safe bounded props on image/video/logo.
  // Fill any missing ones (image blocks often register only alt).
  if (type === "image" || type === "video" || type === "logo") {
    if (!fields.some((f) => f.key === "src")) {
      fields.unshift({
        id: "content-src",
        label: "Source",
        kind: "text",
        source: "props",
        key: "src",
        maxLength: 2048,
        responsiveCapable: false,
        placeholder: "https://…",
      });
    }
    if (!fields.some((f) => f.key === "alt")) {
      fields.push({
        id: "content-alt",
        label: "Alt text",
        kind: "text",
        source: "props",
        key: "alt",
        maxLength: 2048,
        responsiveCapable: false,
      });
    }
  }

  return fields;
}
