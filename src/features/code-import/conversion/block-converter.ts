// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — block converter
//
// Maps source element tags onto the EXISTING LEGO block palette (no second
// block model). Handles the primitive content + interactive blocks:
// headings, paragraphs, buttons, links, images, icons, videos, form controls,
// dividers, lists. Inline carriers (span/strong/em/…) are never emitted —
// their text folds into the nearest block.
//
// Pure and deterministic. Approximations (select → input, radio → checkbox)
// are flagged via the `approximated` field so the node converter can warn.
// ---------------------------------------------------------------------------

import type { ImportAttributeValue, ImportElementNode } from "../types";
import type { BlockType } from "../../blocks/types";

// ---------------------------------------------------------------------------
// Tag classification
// ---------------------------------------------------------------------------

/** Inline text carriers — never emitted as blocks; text folds upward. */
const INLINE_CARRIER_TAGS: ReadonlySet<string> = new Set([
  "span", "strong", "em", "b", "i", "u", "s", "strike", "code", "small",
  "mark", "time", "sub", "sup", "br", "abbr", "kbd", "var", "samp", "q",
  "cite", "dfn", "wbr", "ins", "del", "bdi", "bdo",
]);

/** Tags that always emit a leaf block, aggregating descendant text. */
const LEAF_EMITTING_TAGS: ReadonlySet<string> = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "button", "a", "img", "svg",
  "video", "input", "textarea", "select", "label", "pre", "hr",
]);

const HEADING_TAGS: ReadonlySet<string> = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
]);

const FORM_CONTROL_TAGS: ReadonlySet<string> = new Set([
  "input", "textarea", "select",
]);

export function isInlineCarrierTag(tag: string): boolean {
  return INLINE_CARRIER_TAGS.has(tag.toLowerCase());
}

export function isLeafEmittingTag(tag: string): boolean {
  return LEAF_EMITTING_TAGS.has(tag.toLowerCase());
}

export function isHeadingTag(tag: string): boolean {
  return HEADING_TAGS.has(tag.toLowerCase());
}

export function isFormControlTag(tag: string): boolean {
  return FORM_CONTROL_TAGS.has(tag.toLowerCase());
}

/** A link (or generic element) that looks like a button via its classes. */
export function isButtonLikeClass(classNames: readonly string[]): boolean {
  return classNames.some((className) => {
    const lower = className.toLowerCase();
    return (
      lower.includes("btn") ||
      lower.includes("button") ||
      lower.includes("cta")
    );
  });
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

function stringAttribute(
  element: ImportElementNode,
  name: string,
): string | undefined {
  const value = element.attributes[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanAttribute(
  element: ImportElementNode,
  name: string,
): boolean {
  return element.attributes[name] === true || element.attributes[name] === "true";
}

// ---------------------------------------------------------------------------
// Mapping result
// ---------------------------------------------------------------------------

export interface LeafBlockMapping {
  type: BlockType;
  props: Record<string, unknown>;
  style?: Record<string, unknown>;
  /** Human reason when the mapping approximates the source construct. */
  approximated?: string;
}

// ---------------------------------------------------------------------------
// Element → leaf mapping
// ---------------------------------------------------------------------------

/**
 * Map an element (with its aggregated descendant text) to a leaf block, or
 * null when generic layout/composite rules should decide.
 */
export function mapElementToLeafBlock(
  element: ImportElementNode,
  text: string,
): LeafBlockMapping | null {
  const tag = element.tagName.toLowerCase();
  const classes = element.classNames;

  // ---- Headings ----
  if (isHeadingTag(tag)) {
    const level = Number(tag[1]);
    const align = alignFromElement(element);
    return {
      type: "heading",
      props: {
        text: text || `Heading ${level}`,
        level: Number.isInteger(level) && level >= 1 && level <= 6 ? level : 2,
        align: align ?? "left",
        color: "",
      },
    };
  }

  if (tag === "p") {
    return {
      type: "paragraph",
      props: { text: text || "Paragraph", align: alignFromElement(element) ?? "left" },
    };
  }

  if (tag === "pre") {
    return {
      type: "paragraph",
      props: { text: text || "Code block", align: "left" },
      style: { whiteSpace: "pre", fontFamily: "ui-monospace, monospace", lineHeight: "1.5" },
    };
  }

  if (tag === "hr") {
    return { type: "divider", props: {} };
  }

  // ---- Buttons ----
  if (tag === "button") {
    const props: Record<string, unknown> = {
      text: text || "Button",
      style: "primary",
    };
    const href = stringAttribute(element, "href");
    if (href) props.href = href;
    return { type: "button", props };
  }

  // ---- Links ----
  if (tag === "a") {
    const href = stringAttribute(element, "href") ?? "#";
    if (isButtonLikeClass(classes)) {
      return {
        type: "button",
        props: { text: text || "Link", href, style: "primary" },
      };
    }
    return {
      type: "paragraph",
      props: { text: text || "Link", href, align: "left" },
    };
  }

  // ---- Images ----
  if (tag === "img") {
    return {
      type: "image",
      props: {
        src: stringAttribute(element, "src") ?? "",
        alt: stringAttribute(element, "alt") ?? "",
        crop: "original",
        shape: "rectangle",
      },
    };
  }

  // ---- SVG → icon placeholder ----
  if (tag === "svg") {
    return {
      type: "icon",
      props: { icon: "Import", size: iconSizeFromClasses(classes) },
      approximated: "svg-paths-not-converted",
    };
  }

  // ---- Video ----
  if (tag === "video") {
    return {
      type: "video",
      props: {
        src: stringAttribute(element, "src") ?? "",
        title: stringAttribute(element, "title") ?? stringAttribute(element, "aria-label") ?? "Video",
      },
    };
  }

  // ---- Form controls ----
  if (tag === "input") {
    const inputType = (stringAttribute(element, "type") ?? "text").toLowerCase();
    if (inputType === "checkbox") {
      return {
        type: "checkbox",
        props: {
          label: controlLabel(element, text),
          checked: booleanAttribute(element, "checked"),
        },
      };
    }
    if (inputType === "radio") {
      return {
        type: "checkbox",
        props: {
          label: controlLabel(element, text),
          checked: booleanAttribute(element, "checked"),
        },
        approximated: "radio-mapped-to-checkbox",
      };
    }
    if (inputType === "submit" || inputType === "reset" || inputType === "button") {
      return {
        type: "button",
        props: {
          text: (stringAttribute(element, "value") ?? text) || "Submit",
          style: "primary",
        },
      };
    }
    return {
      type: "input",
      props: {
        label: controlLabel(element, text),
        placeholder: stringAttribute(element, "placeholder") ?? "",
      },
    };
  }

  if (tag === "textarea") {
    return {
      type: "textarea",
      props: {
        label: controlLabel(element, text),
        placeholder: stringAttribute(element, "placeholder") ?? "",
      },
    };
  }

  if (tag === "select") {
    return {
      type: "input",
      props: {
        label: controlLabel(element, text),
        placeholder: "",
      },
      approximated: "select-mapped-to-input",
    };
  }

  // ---- Labels (standalone — folding is handled by the node converter) ----
  if (tag === "label") {
    return {
      type: "paragraph",
      props: { text: text || "Label", align: "left" },
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function controlLabel(element: ImportElementNode, text: string): string {
  const name = stringAttribute(element, "name");
  const placeholder = stringAttribute(element, "placeholder");
  if (text.trim().length > 0) return text.trim().slice(0, 80);
  if (placeholder) return placeholder.slice(0, 80);
  if (name) return name.slice(0, 80);
  return "Field";
}

function alignFromElement(element: ImportElementNode): string | undefined {
  const value = element.attributes.align;
  if (typeof value === "string") {
    if (value === "left" || value === "center" || value === "right" || value === "justify") {
      return value;
    }
  }
  return undefined;
}

/** Extract a pixel size from Tailwind w-/h- size classes (e.g. w-6 → 24). */
function iconSizeFromClasses(classNames: readonly string[]): number {
  for (const className of classNames) {
    const match = /^(?:w|h)-(\d+)$/.exec(className);
    if (match) {
      const n = Number(match[1]);
      if (Number.isInteger(n) && n >= 1 && n <= 24) return n * 4;
    }
  }
  return 24;
}

/** Attribute value helper for converters that need raw values. */
export function attributeString(
  element: ImportElementNode,
  name: string,
): ImportAttributeValue | undefined {
  return element.attributes[name];
}
