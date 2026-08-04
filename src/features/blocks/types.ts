// ---------------------------------------------------------------------------
// LEGO Builder Engine — framework-independent block model (Phase O)
//
// A website is a tree of reusable visual blocks. A Section becomes a
// specialized Container block. This module contains ONLY the pure model:
// no React, no DOM, no Zustand, no persistence. Deterministic and stable.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Block categories
// ---------------------------------------------------------------------------

export type BlockCategory =
  | "layout"
  | "content"
  | "interactive"
  | "composite"
  | "navigation";

// ---------------------------------------------------------------------------
// Block types — the primitive palette
// ---------------------------------------------------------------------------

export type LayoutBlockType =
  | "container"
  | "row"
  | "column"
  | "grid"
  | "stack"
  | "divider"
  | "spacer";

export type ContentBlockType =
  | "heading"
  | "paragraph"
  | "button"
  | "image"
  | "video"
  | "icon"
  | "badge";

export type InteractiveBlockType =
  | "form"
  | "input"
  | "textarea"
  | "checkbox"
  | "tabs"
  | "accordion";

export type CompositeBlockType =
  | "card"
  | "pricing-card"
  | "feature-card"
  | "review-card"
  | "faq-item"
  | "team-member";

export type NavigationBlockType =
  | "navbar"
  | "footer"
  | "menu";

export type BlockType =
  | LayoutBlockType
  | ContentBlockType
  | InteractiveBlockType
  | CompositeBlockType
  | NavigationBlockType;

export function blockCategoryOf(type: BlockType): BlockCategory {
  if (isLayoutBlock(type)) return "layout";
  if (isContentBlock(type)) return "content";
  if (isInteractiveBlock(type)) return "interactive";
  if (isCompositeBlock(type)) return "composite";
  return "navigation";
}

export function isLayoutBlock(type: BlockType): boolean {
  return (
    type === "container" ||
    type === "row" ||
    type === "column" ||
    type === "grid" ||
    type === "stack" ||
    type === "divider" ||
    type === "spacer"
  );
}

export function isContentBlock(type: BlockType): boolean {
  return (
    type === "heading" ||
    type === "paragraph" ||
    type === "button" ||
    type === "image" ||
    type === "video" ||
    type === "icon" ||
    type === "badge"
  );
}

export function isInteractiveBlock(type: BlockType): boolean {
  return (
    type === "form" ||
    type === "input" ||
    type === "textarea" ||
    type === "checkbox" ||
    type === "tabs" ||
    type === "accordion"
  );
}

export function isCompositeBlock(type: BlockType): boolean {
  return (
    type === "card" ||
    type === "pricing-card" ||
    type === "feature-card" ||
    type === "review-card" ||
    type === "faq-item" ||
    type === "team-member"
  );
}

export function isNavigationBlock(type: BlockType): boolean {
  return type === "navbar" || type === "footer" || type === "menu";
}

// ---------------------------------------------------------------------------
// Block node — one element in the build tree
// ---------------------------------------------------------------------------

export interface BlockNode {
  /** Stable unique id within the tree. */
  id: string;
  type: BlockType;
  /** Parent block id, or null for a root. */
  parentId: string | null;
  /** Ordered child block ids. */
  children: string[];
  /** Content properties (text, href, image, …). Never DOM nodes. */
  props: Record<string, unknown>;
  /** Inline style values (existing style system — no second engine). */
  style: Record<string, unknown>;
  /** Responsive overrides: breakpoint → style overrides. */
  responsive: Record<string, Record<string, unknown>>;
  /** Rendered in preview. */
  visible: boolean;
  /** Locked blocks cannot be edited/moved in the builder. */
  locked: boolean;
  /** Hidden from the build-tree layers list (not the preview). */
  hidden: boolean;
}

// ---------------------------------------------------------------------------
// Block tree — forest of block nodes (one tree per page, roots are sections)
// ---------------------------------------------------------------------------

export interface BlockTree {
  /** Root node ids (ordered). A Section root is a Container block. */
  rootIds: string[];
  nodes: Record<string, BlockNode>;
}

// ---------------------------------------------------------------------------
// Resize policy — drives which resize affordances the builder exposes
// ---------------------------------------------------------------------------

export type ResizePolicy = "none" | "fixed" | "fluid";

// ---------------------------------------------------------------------------
// Editable field descriptor — mirrors the inline-editing safe-field model
// ---------------------------------------------------------------------------

export type BlockEditableFieldKind =
  | "text"
  | "textarea"
  | "link-text"
  | "button-text"
  | "heading"
  | "description";

export interface BlockEditableField {
  /** Stable field id (per block type). */
  id: string;
  fieldPath: string[];
  kind: BlockEditableFieldKind;
  label: string;
  maxLength?: number;
}

// ---------------------------------------------------------------------------
// Nesting rules — declarative, validated at registry time and by validateTree
// ---------------------------------------------------------------------------

export interface BlockNestingRules {
  /** Leaf blocks (heading/paragraph/button/image…) have no children. */
  allowsChildren: boolean;
  /**
   * Allowed child block types. "*" permits any registered block.
   * Empty array = leaf.
   */
  allowedChildTypes?: BlockType[] | "*";
  minChildren?: number;
  maxChildren?: number;
}

// ---------------------------------------------------------------------------
// Block definition — registered per block type
// ---------------------------------------------------------------------------

export interface BlockDefinition {
  type: BlockType;
  category: BlockCategory;
  /** Icon key resolved by the UI layer (no React in the registry). */
  iconKey: string;
  label: string;
  description: string;
  nesting: BlockNestingRules;
  resizePolicy: ResizePolicy;
  /** Fresh default content properties. Must not share references. */
  createProps: () => Record<string, unknown>;
  /** Fresh default styles. Must not share references. */
  createStyles: () => Record<string, unknown>;
  /** Safe editable fields (deterministic, no href/price/asset paths). */
  editableFields: BlockEditableField[];
  /** Plain-language search terms for the block browser. */
  keywords?: string[];
  /** True when this block can be inserted anywhere by a beginner. */
  beginnerFriendly?: boolean;
}

// ---------------------------------------------------------------------------
// Layout descriptor — pure layout model (no CSS generation here)
// ---------------------------------------------------------------------------

export type LayoutDirection = "row" | "column" | "grid";
export type LayoutAlign = "start" | "center" | "end" | "stretch";
export type LayoutJustify = "start" | "center" | "end" | "space-between" | "space-around";

export interface LayoutDescriptor {
  direction: LayoutDirection;
  align: LayoutAlign;
  justify: LayoutJustify;
  gap: number;
  wrap: boolean;
  /** Grid only — number of columns. */
  columns?: number;
}

// ---------------------------------------------------------------------------
// Block presets — named presets mapped onto existing style values
// ---------------------------------------------------------------------------

export interface BlockPreset {
  id: string;
  /** Preset kind: button / image / card / … */
  kind: "button" | "image" | "card";
  label: string;
  description: string;
  /** Style overrides applied to the target block. */
  applyStyles: Record<string, unknown>;
  /** Optional prop overrides (e.g. button style key). */
  applyProps?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Structured block errors
// ---------------------------------------------------------------------------

export type BlockErrorCode =
  | "BLOCK_NOT_FOUND"
  | "BLOCK_ID_CONFLICT"
  | "NESTING_RULE_VIOLATION"
  | "TARGET_NOT_FOUND"
  | "INVALID_TREE"
  | "LOCKED_BLOCK"
  | "CANNOT_EDIT_LEAF"
  | "UNKNOWN_BLOCK_TYPE";

export interface BlockError {
  code: BlockErrorCode;
  message: string;
}

export type BlockResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BlockError };

// ---------------------------------------------------------------------------
// Block operation — a single immutable mutation request
// ---------------------------------------------------------------------------

export type BlockOperation =
  | { kind: "insert"; parentId: string; index?: number; block: BlockNode }
  | { kind: "delete"; blockId: string }
  | { kind: "duplicate"; blockId: string }
  | { kind: "move"; blockId: string; toParentId: string; toIndex?: number }
  | { kind: "lock"; blockId: string; locked: boolean }
  | { kind: "hide"; blockId: string; hidden: boolean }
  | { kind: "set-visible"; blockId: string; visible: boolean }
  | { kind: "rename"; blockId: string; label: string }
  | { kind: "update-props"; blockId: string; props: Record<string, unknown> }
  | { kind: "update-style"; blockId: string; style: Record<string, unknown> }
  | { kind: "apply-preset"; blockId: string; presetId: string };

// ---------------------------------------------------------------------------
// Stable default label helper (blocks carry an optional name in props)
// ---------------------------------------------------------------------------

export function blockLabel(node: BlockNode, fallback: string): string {
  const name = node.props.name;
  return typeof name === "string" && name.trim().length > 0 ? name : fallback;
}
