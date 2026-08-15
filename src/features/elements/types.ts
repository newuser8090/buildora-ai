// ---------------------------------------------------------------------------
// Universal Element Model (Phase P22-A) — framework-independent core types
//
// The element model is an ADDITIVE, migration-friendly evolution of the Phase O
// BlockNode model. It does NOT throw BlockNode away:
//
//   ElementNode extends BlockNode   (all BlockNode fields preserved 1:1)
//     + optional geometry           (x/y/width/height/rotation/z-index)
//     + optional viewport           (Canva-first responsive overrides)
//     + optional animation          (declarative, data-only)
//     + optional interaction        (click/hover/focus/scroll actions, data-only)
//     + optional binding            (future data-binding foundation)
//     + optional a11y               (accessibility metadata)
//     + optional customCode         (advanced, data-only — NEVER executed here)
//
// Because every new field is OPTIONAL, every existing BlockNode value is
// structurally a valid ElementNode and every existing BlockTree is a valid
// ElementTree. New element types are added through the ElementRegistry
// (type/registry approach) — never by editing this file per element.
//
// Pure model: no React, no DOM, no Zustand, no persistence.
// ---------------------------------------------------------------------------

import type {
  BlockNode,
  BlockType,
  BlockCategory,
  ResizePolicy,
} from "@/features/blocks/types";
import type { ElementViewportStyles, ResponsiveDecision } from "./responsive/types";
import type { ElementAnimation } from "./animation/types";
import type { ElementInteraction } from "./interaction/types";
import type { ElementBinding } from "./binding/types";

// ---------------------------------------------------------------------------
// Element categories — a superset of the Phase O block categories
// ---------------------------------------------------------------------------

export type ElementCategory = BlockCategory | "media" | "commerce" | "advanced";

// ---------------------------------------------------------------------------
// Element types — block types PLUS element-only families
// ---------------------------------------------------------------------------

/**
 * Element-only types that do not exist in the Phase O block catalogue. These
 * represent the Canva-style element families the product vision requires.
 * Each is backed by a registry definition (defaults + nesting + schema), so
 * the list can grow without changing the model.
 */
export const ELEMENT_ONLY_TYPES = [
  "section", // root-level container — the future "section" element
  "text", // rich text element (typography lives in style tokens)
  "logo", // brand logo (image or text)
  "list", // ordered/unordered list of items
  "carousel", // horizontal slide container
  "product-card", // commerce product card
  "price", // commerce price display
  "custom-component", // registered advanced component (data-driven)
] as const;

export type ElementOnlyType = (typeof ELEMENT_ONLY_TYPES)[number];

export type ElementType = BlockType | ElementOnlyType;

export function isElementOnlyType(type: string): type is ElementOnlyType {
  return (ELEMENT_ONLY_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Geometry — prepared for freeform manipulation (UI arrives in P22-B)
// ---------------------------------------------------------------------------

/** "flow" = document flow (responsive-safe default). "absolute" = explicit freeform. */
export type ElementPositionMode = "flow" | "absolute";

export interface ElementGeometry {
  mode: ElementPositionMode;
  /** Absolute position within the parent (flow mode ignores x/y). */
  x?: number;
  y?: number;
  /** Width/height act as constraints in flow mode, exact size in absolute mode. */
  width?: number;
  height?: number;
  /** Degrees. Applied as a transform; 0 = none. */
  rotation?: number;
  /** Layer order within the parent (higher = on top). */
  zIndex?: number;
}

// ---------------------------------------------------------------------------
// Style tokens — the universal styling surface
//
// Typed known keys give the future inspector guidance; the passthrough index
// keeps full compatibility with the existing Phase O style-token system
// (camelCase CSS values, sanitized at render time by block-style-to-css).
// ---------------------------------------------------------------------------

export interface ElementStyleTokens {
  // ---- Typography ----
  fontFamily?: string;
  fontSize?: string | number;
  fontWeight?: string | number;
  lineHeight?: string | number;
  letterSpacing?: string | number;
  textAlign?: "left" | "center" | "right" | "justify";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textDecoration?: "none" | "underline" | "line-through" | string;

  // ---- Colors ----
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  /** Gradient or background image reference (data). */
  backgroundImage?: string;

  // ---- Layout ----
  width?: string | number;
  height?: string | number;
  minWidth?: string | number;
  maxWidth?: string | number;
  minHeight?: string | number;
  maxHeight?: string | number;
  margin?: string | number;
  padding?: string | number;
  gap?: string | number;
  alignItems?: string;
  justifyContent?: string;
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse" | string;
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse" | string;
  display?: string;
  position?: string;

  // ---- Visual ----
  opacity?: number;
  border?: string;
  borderRadius?: string | number;
  boxShadow?: string;
  filter?: string;
  overflow?: string;

  // ---- Transform ----
  transform?: string;
  transformOrigin?: string;
  rotate?: number;
  scale?: number;

  /**
   * Passthrough compatibility with the Phase O style-token system
   * (e.g. "gridTemplateColumns", "flex", "background", "marginLeft").
   * Values are primitives only; unsafe CSS values are dropped at render.
   */
  [key: string]: string | number | undefined;
}

// ---------------------------------------------------------------------------
// Accessibility metadata
// ---------------------------------------------------------------------------

export interface ElementAccessibility {
  alt?: string;
  label?: string;
  role?: string;
  ariaHidden?: boolean;
  focusable?: boolean;
}

// ---------------------------------------------------------------------------
// Custom code — ADVANCED, OPT-IN, DATA ONLY
//
// P22-A never executes custom code anywhere. It is represented as inert data
// with hard length caps; execution belongs to a future sandboxed publish
// container behind an explicit advanced flag (see the P22 architecture).
// ---------------------------------------------------------------------------

export interface ElementCustomCode {
  /**
   * Opt-in execution flag (Phase P23). Custom code is INERT DATA until this
   * is explicitly true — imported/legacy payloads stay disabled by default.
   * Absent/false means the code is never emitted or run anywhere.
   */
  enabled?: boolean;
  css?: string;
  js?: string;
  html?: string;
  /** Safe custom attributes (string keys/values). */
  attributes?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// ElementNode — the universal element
// ---------------------------------------------------------------------------

export interface ElementNode extends Omit<BlockNode, "type"> {
  // BlockNode provides: id, parentId, children, props, style, responsive,
  // visible, locked, hidden. `type` is widened to the full element catalogue.
  type: ElementType;
  geometry?: ElementGeometry;
  /** Canva-first responsive overrides — base values live in `style`. */
  viewport?: ElementViewportStyles;
  animation?: ElementAnimation;
  interaction?: ElementInteraction;
  binding?: ElementBinding;
  a11y?: ElementAccessibility;
  customCode?: ElementCustomCode;
}

// ---------------------------------------------------------------------------
// ElementTree — same shape as BlockTree, nodes are ElementNodes
// ---------------------------------------------------------------------------

export interface ElementTree {
  rootIds: string[];
  nodes: Record<string, ElementNode>;
}

/** ElementTree is assignable to BlockTree (nodes are supersets). */
export function isElementTree(value: unknown): value is ElementTree {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tree = value as Record<string, unknown>;
  return (
    Array.isArray(tree.rootIds) &&
    typeof tree.nodes === "object" &&
    tree.nodes !== null &&
    !Array.isArray(tree.nodes)
  );
}

// ---------------------------------------------------------------------------
// Editable field descriptor (mirrors the block/inline-editing safe-field model)
// ---------------------------------------------------------------------------

export type ElementEditableFieldKind =
  | "text"
  | "textarea"
  | "link-text"
  | "button-text"
  | "heading"
  | "description";

export interface ElementEditableField {
  /** Stable field id (per element type). */
  id: string;
  fieldPath: string[];
  kind: ElementEditableFieldKind;
  label: string;
  maxLength?: number;
}

// ---------------------------------------------------------------------------
// Element definition — the registry contract for every element type
// ---------------------------------------------------------------------------

export interface ElementDefinition {
  type: ElementType;
  label: string;
  description: string;
  category: ElementCategory;
  iconKey: string;
  keywords: string[];
  canHaveChildren: boolean;
  /** Declarative nesting rules (allowed child types / counts). */
  nesting: {
    allowedChildTypes?: ElementType[] | "*";
    minChildren?: number;
    maxChildren?: number;
  };
  resizePolicy: ResizePolicy;
  /** Fresh default content props. Must never return shared references. */
  createProps: () => Record<string, unknown>;
  /** Fresh default style tokens. Must never return shared references. */
  createStyles: () => ElementStyleTokens;
  /**
   * Optional typed props validation (Zod). When absent, the generic bounded
   * props schema is used. Kept as a plain function so the registry module
   * does not need to import Zod itself.
   */
  validateProps?: (props: unknown) => { ok: true; value: Record<string, unknown> } | { ok: false; issues: string[] };
  /** Safe editable fields (deterministic, no href/price/asset paths). */
  editableFields?: ElementEditableField[];
  beginnerFriendly?: boolean;
  /**
   * Editor/renderer metadata — data only. Drives future inspector/renderer
   * behavior without hard-coding element types in the UI layer.
   */
  editor?: {
    defaultLayout?: ElementPositionMode;
    supportsViewportOverrides?: boolean;
    supportsAnimation?: boolean;
    supportsInteraction?: boolean;
    supportsBinding?: boolean;
    /**
     * Whether this element type may carry user-authored custom code (P23).
     * Opt-in per registry definition — never broad. Only types with this flag
     * are eligible for the custom-code authoring/emission surfaces.
     */
    supportsCustomCode?: boolean;
    /** Future single-renderer mapping key (P22-B). */
    rendererKey?: string;
  };
}

// ---------------------------------------------------------------------------
// Structured results / errors
// ---------------------------------------------------------------------------

export type ElementErrorCode =
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_ID_CONFLICT"
  | "ELEMENT_TYPE_NOT_REGISTERED"
  | "ELEMENT_NESTING_RULE_VIOLATION"
  | "ELEMENT_TARGET_NOT_FOUND"
  | "ELEMENT_TREE_INVALID"
  | "ELEMENT_LOCKED"
  | "ELEMENT_CANNOT_EDIT_LEAF"
  | "ELEMENT_PROPS_INVALID"
  | "ELEMENT_STYLE_INVALID"
  | "ELEMENT_GEOMETRY_INVALID"
  | "ELEMENT_VIEWPORT_INVALID"
  | "ELEMENT_ANIMATION_INVALID"
  | "ELEMENT_INTERACTION_INVALID"
  | "ELEMENT_BINDING_INVALID"
  | "ELEMENT_ACCESSIBILITY_INVALID"
  | "ELEMENT_CUSTOM_CODE_INVALID"
  | "ELEMENT_NAVIGATION_INVALID"
  | "ELEMENT_SERIALIZATION_FAILED"
  | "UNKNOWN_ELEMENT_ERROR";

export interface ElementError {
  code: ElementErrorCode;
  message: string;
}

export type ElementResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ElementError };

// ---------------------------------------------------------------------------
// Future durable shape — a section as a root element
//
// P22-A defines the shape but does NOT wire it into the durable BaseSection
// schema. Materialization is one-way and lazy; the `tree` becomes
// authoritative once a future sub-phase persists it (P22-B/D).
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";

export interface SectionElement extends BaseSection {
  /** Present once the section is materialized as an element tree. */
  tree?: ElementTree;
}

/** Section-element markers mirrored from the Phase O adapter. */
export const SECTION_ELEMENT_TYPE_KEY = "_sectionType";
export const SECTION_ELEMENT_ID_KEY = "_sectionId";

/** Re-export the responsive decision type for convenience. */
export type { ResponsiveDecision };

// ---------------------------------------------------------------------------
// Re-exports — the metadata models are importable from the core module too
// ---------------------------------------------------------------------------

export type { ElementViewportStyles } from "./responsive/types";
export type { ElementAnimation } from "./animation/types";
export type { ElementInteraction, ElementAction, ElementHoverEffect, ElementScrollEffect } from "./interaction/types";
export type { ElementBinding, ElementBindingSource } from "./binding/types";
