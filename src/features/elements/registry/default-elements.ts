// ---------------------------------------------------------------------------
// Default element-only definitions (Phase P22-A)
//
// The Canva-style element families that extend the Phase O block catalogue.
// Every definition returns FRESH props/styles (never shared references),
// declares nesting rules, and validates props through a typed schema.
// No React, no DOM.
// ---------------------------------------------------------------------------

import type { ElementDefinition, ElementOnlyType } from "../types";
import { schemaToValidateProps } from "./validate-props-helper";
import {
  CarouselElementPropsSchema,
  CustomComponentElementPropsSchema,
  ListElementPropsSchema,
  LogoElementPropsSchema,
  PriceElementPropsSchema,
  ProductCardElementPropsSchema,
  SectionElementPropsSchema,
  TextElementPropsSchema,
} from "../schemas/element-props-schemas";

type DefInput = Omit<ElementDefinition, "createProps" | "createStyles"> & {
  createProps?: () => Record<string, unknown>;
  createStyles?: () => Record<string, unknown>;
};

function def(partial: DefInput): ElementDefinition {
  return {
    createProps: () => ({ ...(partial.createProps?.() ?? {}) }),
    createStyles: () => ({ ...(partial.createStyles?.() ?? {}) }),
    ...partial,
  } as ElementDefinition;
}

/**
 * Element-only definitions in canonical (deterministic) registration order.
 * Block types are NOT listed here — they are derived from the block registry.
 */
export const ELEMENT_ONLY_DEFINITIONS: ElementDefinition[] = [
  def({
    type: "section",
    label: "Section",
    description: "A full-width root container that holds other elements.",
    category: "layout",
    iconKey: "square-dashed",
    canHaveChildren: true,
    nesting: { allowedChildTypes: "*" },
    resizePolicy: "fluid",
    createProps: () => ({ name: "" }),
    createStyles: () => ({
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
      padding: "4rem 0",
    }),
    validateProps: schemaToValidateProps(SectionElementPropsSchema),
    keywords: ["section", "root", "container", "block"],
    beginnerFriendly: true,
    editor: {
      defaultLayout: "flow",
      supportsViewportOverrides: true,
      rendererKey: "section",
    },
  }),
  def({
    type: "text",
    label: "Text",
    description: "A rich text element — content with full typography styling.",
    category: "content",
    iconKey: "text",
    canHaveChildren: false,
    nesting: { allowedChildTypes: [] },
    resizePolicy: "fixed",
    createProps: () => ({ text: "Add your text here", format: "paragraph" }),
    createStyles: () => ({ lineHeight: "1.6", color: "var(--foreground, #0a0a0a)" }),
    validateProps: schemaToValidateProps(TextElementPropsSchema),
    editableFields: [{ id: "text", fieldPath: ["text"], kind: "textarea", label: "Text" }],
    keywords: ["text", "paragraph", "copy", "rich text"],
    beginnerFriendly: true,
    editor: {
      defaultLayout: "flow",
      supportsViewportOverrides: true,
      supportsAnimation: true,
      rendererKey: "text",
    },
  }),
  def({
    type: "logo",
    label: "Logo",
    description: "A brand logo — an image, text, or both.",
    category: "content",
    iconKey: "image",
    canHaveChildren: false,
    nesting: { allowedChildTypes: [] },
    resizePolicy: "fixed",
    createProps: () => ({ src: "", alt: "", text: "Brand" }),
    createStyles: () => ({ display: "inline-flex", alignItems: "center", gap: "0.5rem" }),
    validateProps: schemaToValidateProps(LogoElementPropsSchema),
    editableFields: [{ id: "text", fieldPath: ["text"], kind: "text", label: "Logo text" }],
    keywords: ["logo", "brand", "mark"],
    beginnerFriendly: true,
    editor: { defaultLayout: "flow", rendererKey: "logo" },
  }),
  def({
    type: "list",
    label: "List",
    description: "An ordered or unordered list of items.",
    category: "content",
    iconKey: "list",
    canHaveChildren: false,
    nesting: { allowedChildTypes: [] },
    resizePolicy: "fluid",
    createProps: () => ({ ordered: false, items: ["Item one", "Item two", "Item three"] }),
    createStyles: () => ({ display: "flex", flexDirection: "column", gap: "0.5rem", paddingLeft: "1.25rem" }),
    validateProps: schemaToValidateProps(ListElementPropsSchema),
    editableFields: [{ id: "items", fieldPath: ["items"], kind: "textarea", label: "List items" }],
    keywords: ["list", "bullets", "items", "ordered"],
    beginnerFriendly: true,
    editor: { defaultLayout: "flow", rendererKey: "list" },
  }),
  def({
    type: "carousel",
    label: "Carousel",
    description: "A horizontal swipeable strip of slides.",
    category: "media",
    iconKey: "gallery-horizontal",
    canHaveChildren: true,
    nesting: { allowedChildTypes: ["container", "card", "image", "product-card", "stack"], maxChildren: 12 },
    resizePolicy: "fluid",
    createProps: () => ({ autoPlay: false, loop: true, intervalMs: 3000 }),
    createStyles: () => ({ display: "flex", gap: "1rem", overflowX: "auto", scrollSnapType: "x mandatory" }),
    validateProps: schemaToValidateProps(CarouselElementPropsSchema),
    keywords: ["carousel", "slider", "swipe", "gallery"],
    beginnerFriendly: false,
    editor: {
      defaultLayout: "flow",
      supportsViewportOverrides: true,
      rendererKey: "carousel",
    },
  }),
  def({
    type: "product-card",
    label: "Product card",
    description: "A commerce card showing a product's image, name and price.",
    category: "commerce",
    iconKey: "shopping-bag",
    canHaveChildren: true,
    nesting: { allowedChildTypes: ["image", "heading", "paragraph", "button", "badge", "price", "stack"], maxChildren: 8 },
    resizePolicy: "fixed",
    createProps: () => ({ name: "Product", price: "$0.00", currency: "$", badge: "" }),
    createStyles: () => ({
      borderRadius: "0.75rem",
      padding: "1.25rem",
      background: "var(--card, #ffffff)",
      border: "1px solid var(--border, #e5e5e5)",
      display: "flex",
      flexDirection: "column",
      gap: "0.5rem",
    }),
    validateProps: schemaToValidateProps(ProductCardElementPropsSchema),
    editableFields: [
      { id: "name", fieldPath: ["name"], kind: "text", label: "Product name" },
      { id: "price", fieldPath: ["price"], kind: "text", label: "Price" },
    ],
    keywords: ["product", "card", "commerce", "shop"],
    beginnerFriendly: true,
    editor: { defaultLayout: "flow", supportsBinding: true, rendererKey: "product-card" },
  }),
  def({
    type: "price",
    label: "Price",
    description: "A price amount with an optional currency and period.",
    category: "commerce",
    iconKey: "tag",
    canHaveChildren: false,
    nesting: { allowedChildTypes: [] },
    resizePolicy: "fixed",
    createProps: () => ({ amount: "$0.00", currency: "$", period: "" }),
    createStyles: () => ({ fontWeight: 700, fontSize: "1.5rem" }),
    validateProps: schemaToValidateProps(PriceElementPropsSchema),
    editableFields: [{ id: "amount", fieldPath: ["amount"], kind: "text", label: "Amount" }],
    keywords: ["price", "cost", "amount", "commerce"],
    beginnerFriendly: true,
    editor: { defaultLayout: "flow", supportsBinding: true, rendererKey: "price" },
  }),
  def({
    type: "custom-component",
    label: "Custom component",
    description: "A registered advanced component — configured by data, never code.",
    category: "advanced",
    iconKey: "puzzle",
    canHaveChildren: true,
    nesting: { allowedChildTypes: "*" },
    resizePolicy: "fluid",
    createProps: () => ({ componentKey: "my-component", config: {} }),
    createStyles: () => ({}),
    validateProps: schemaToValidateProps(CustomComponentElementPropsSchema),
    keywords: ["custom", "component", "advanced", "widget"],
    beginnerFriendly: false,
    editor: { defaultLayout: "flow", supportsViewportOverrides: true, rendererKey: "custom-component" },
  }),
];

/** Canonical element-only types in registration order. */
export const ELEMENT_ONLY_TYPES_ORDER: readonly ElementOnlyType[] =
  ELEMENT_ONLY_DEFINITIONS.map((d) => d.type as ElementOnlyType);
