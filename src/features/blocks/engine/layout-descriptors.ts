// ---------------------------------------------------------------------------
// Layout descriptors — pure layout model for layout blocks (Phase O)
//
// Describes how a container/row/column/grid/stack should lay out its children
// using a small, framework-independent vocabulary. No CSS is generated here;
// the renderer layer maps descriptors onto the existing style tokens.
// Deterministic and pure.
// ---------------------------------------------------------------------------

import type {
  LayoutAlign,
  LayoutDescriptor,
  LayoutDirection,
  LayoutJustify,
  BlockNode,
} from "../types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_LAYOUT: LayoutDescriptor = {
  direction: "column",
  align: "stretch",
  justify: "start",
  gap: 16,
  wrap: false,
};

// ---------------------------------------------------------------------------
// Parsing — read layout props off a block node
// ---------------------------------------------------------------------------

function readLayoutProps(
  props: Record<string, unknown>,
): Partial<LayoutDescriptor> {
  const descriptor: Partial<LayoutDescriptor> = {};

  const direction = props.layoutDirection;
  if (
    direction === "row" ||
    direction === "column" ||
    direction === "grid"
  ) {
    descriptor.direction = direction;
  }

  const align = props.alignItems;
  if (
    align === "start" ||
    align === "center" ||
    align === "end" ||
    align === "stretch"
  ) {
    descriptor.align = align;
  }

  const justify = props.justifyContent;
  if (
    justify === "start" ||
    justify === "center" ||
    justify === "end" ||
    justify === "space-between" ||
    justify === "space-around"
  ) {
    descriptor.justify = justify;
  }

  if (
    typeof props.gap === "number" &&
    Number.isFinite(props.gap) &&
    props.gap >= 0
  ) {
    descriptor.gap = Math.max(0, Math.round(props.gap));
  }
  if (typeof props.flexWrap === "boolean") {
    descriptor.wrap = props.flexWrap;
  }
  if (typeof props.columns === "number" && Number.isFinite(props.columns)) {
    descriptor.columns = Math.max(1, Math.min(12, Math.round(props.columns)));
  }

  return descriptor;
}

/** Resolve a layout descriptor for a block (or the defaults for unknown). */
export function layoutDescriptorFor(node: BlockNode): LayoutDescriptor {
  return {
    ...DEFAULT_LAYOUT,
    ...readLayoutProps(node.props),
  };
}

/** Human summary used by the block library cards (e.g. "Row · 16px gap"). */
export function layoutSummary(node: BlockNode): string {
  const layout = layoutDescriptorFor(node);
  const parts: string[] = [layout.direction];
  if (layout.direction === "grid" && layout.columns) {
    parts.push(`${layout.columns} columns`);
  }
  parts.push(`${layout.gap}px gap`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

export function isRowDirection(direction: LayoutDirection): boolean {
  return direction === "row" || direction === "grid";
}

export function normalizeAlign(value: unknown): LayoutAlign {
  if (
    value === "start" ||
    value === "center" ||
    value === "end" ||
    value === "stretch"
  ) {
    return value;
  }
  return DEFAULT_LAYOUT.align;
}

export function normalizeJustify(value: unknown): LayoutJustify {
  if (
    value === "start" ||
    value === "center" ||
    value === "end" ||
    value === "space-between" ||
    value === "space-around"
  ) {
    return value;
  }
  return DEFAULT_LAYOUT.justify;
}

// ---------------------------------------------------------------------------
// Convenience factories for the library/adapters
// ---------------------------------------------------------------------------

export function rowLayoutProps(gap = 16, align: LayoutAlign = "center"): Record<string, unknown> {
  return { layoutDirection: "row", gap, alignItems: align, justifyContent: "start", flexWrap: false };
}

export function columnLayoutProps(gap = 16, align: LayoutAlign = "stretch"): Record<string, unknown> {
  return { layoutDirection: "column", gap, alignItems: align, justifyContent: "start", flexWrap: false };
}

export function gridLayoutProps(columns: number, gap = 16): Record<string, unknown> {
  return { layoutDirection: "grid", columns, gap, alignItems: "stretch", justifyContent: "start", flexWrap: false };
}
