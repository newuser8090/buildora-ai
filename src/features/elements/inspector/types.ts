// ---------------------------------------------------------------------------
// Universal Inspector domain (Phase P22-C) — pure, framework-independent types
//
// The inspector is a READ/WRITE view over the P22-A ElementNode model, driven
// by a declarative per-element-type schema. There are no per-element bespoke
// editors: an element type declares its editable surface through capability
// groups and fields, and a single dispatcher renders the controls.
//
// Every field declares where its value lives ("source") and which key to
// read/write, so the mutation adapter can route changes to the correct
// element operation without the UI knowing anything about the model.
//
// Pure model: no React, no DOM, no store.
// ---------------------------------------------------------------------------

import type { ElementType } from "../types";

// ---------------------------------------------------------------------------
// Field kinds — the universe of controls the panel can render
// ---------------------------------------------------------------------------

export type InspectorFieldKind =
  | "text" // single-line string
  | "textarea" // multi-line string
  | "number" // numeric input with steppers + unit
  | "slider" // numeric slider (0..100 style ranges)
  | "select" // dropdown
  | "segmented" // segmented control
  | "toggle" // boolean switch
  | "color" // color swatches + native picker
  | "spacing" // 4-way top/right/bottom/left group
  | "radius" // radius presets + free value
  | "shadow" // shadow presets
  | "font-family" // curated font list
  | "alignment" // left / center / right buttons
  // Grid columns (Phase P22-F): base writes props.columns, tablet/mobile
  // writes/reads the viewport gridTemplateColumns override.
  | "grid-columns"
  // Phase P22-G — composite declarative controls: the whole ElementAnimation
  // / ElementInteraction object is authored in a bespoke control and committed
  // through the same validated field path (source "animation" / "interaction").
  | "animation"
  | "interaction"
  // Phase P22-J — the whole ElementBinding object (source/collectionId/path/
  // field) authored in a bespoke control and committed through the same
  // validated field path (source "binding" → updateElementBinding).
  | "binding";

// ---------------------------------------------------------------------------
// Value source — where a field's value lives on the ElementNode
// ---------------------------------------------------------------------------

export type InspectorValueSource =
  | "style"
  | "geometry"
  | "props"
  | "a11y"
  /** Node-level booleans (hidden / locked). */
  | "node"
  /** Phase P22-G — the whole ElementAnimation object on the node. */
  | "animation"
  /** Phase P22-G — the whole ElementInteraction object on the node. */
  | "interaction"
  /** Phase P22-J — the whole ElementBinding object on the node. */
  | "binding";

export interface InspectorFieldOption {
  value: string;
  label: string;
}

export interface InspectorFieldDef {
  /** Stable field id (e.g. "fontSize"). */
  id: string;
  /** User-facing label. */
  label: string;
  kind: InspectorFieldKind;
  /** Where the value lives on the node. */
  source: InspectorValueSource;
  /** Token / geometry key / prop key to read and write. */
  key: string;
  /**
   * When true, the value may be overridden per viewport (style fields only).
   * Editing while tablet/mobile writes node.viewport.<breakpoint>[key]
   * instead of node.style[key].
   */
  responsiveCapable?: boolean;
  /** Default/placeholder value. */
  default?: unknown;
  // ---- Number bounds ----
  min?: number;
  max?: number;
  step?: number;
  /** Display unit suffix ("px", "%", "deg"). */
  unit?: string;
  // ---- Choice fields ----
  options?: InspectorFieldOption[];
  // ---- Text fields ----
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  /** Per-field validation: returns an error message or null. */
  validate?: (value: unknown) => string | null;
}

// ---------------------------------------------------------------------------
// Sections — progressive disclosure groups
// ---------------------------------------------------------------------------

export type InspectorSectionId =
  | "content"
  | "typography"
  | "appearance"
  | "layout"
  | "spacing"
  | "advanced"
  // Phase P22-G — declarative animations + interactions (universal groups).
  | "animation"
  | "interactions"
  // Phase P22-J — data binding (universal group).
  | "data";

export interface InspectorSectionDef {
  id: InspectorSectionId;
  label: string;
  fields: InspectorFieldDef[];
}

export interface ElementInspectorSchema {
  elementType: ElementType;
  /** Human label (from the element registry definition). */
  label: string;
  sections: InspectorSectionDef[];
}

// ---------------------------------------------------------------------------
// Resolved values — what the UI renders at a given breakpoint
// ---------------------------------------------------------------------------

/** The viewport context an inspector field is edited/resolved under. */
export type InspectorBreakpoint = "base" | "tablet" | "mobile";

export type InspectorValueOrigin = "base" | "override" | "absent";

export interface InspectorResolvedValue {
  /** Effective value at the current breakpoint (what the control shows). */
  value: unknown;
  /** Where the displayed value comes from. */
  origin: InspectorValueOrigin;
  /** True when an override exists at the current breakpoint. */
  overridden: boolean;
  /** True when the value is inherited from the base style. */
  inherited: boolean;
}

export interface InspectorModel {
  schema: ElementInspectorSchema;
  values: Record<string, InspectorResolvedValue>;
}

/** Result of validating one field change. */
export interface InspectorFieldValidation {
  ok: boolean;
  /** Normalized value to commit (when ok). */
  value?: unknown;
  error?: string;
}
