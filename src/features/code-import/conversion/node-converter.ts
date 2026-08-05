// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — node converter
//
// Recursively walks the normalized import AST and produces EXISTING BlockNode
// structures. Responsibilities:
//   - text aggregation for leaf blocks (headings, paragraphs, buttons…)
//   - label → form-control folding
//   - link-list → menu extraction
//   - list (ul/ol/li) conversion
//   - composite/navigation detection via component-converter
//   - layout intent via layout-converter
//   - nesting-aware type selection: when a candidate type would violate the
//     registered nesting rules (or child caps), the block is downgraded to a
//     container with a warning — the output ALWAYS passes validateTree.
//
// Never executes code, never creates runtime React components, deterministic.
// ---------------------------------------------------------------------------

import { createBlock } from "../../blocks/engine/block-operations";
import { blockRegistry } from "../../blocks/registry/block-registry";
import { canNest } from "../../blocks/engine/nesting-rules";
import type { BlockNode, BlockType } from "../../blocks/types";
import type { ImportElementNode, ImportNode } from "../types";
import { PathBuilder } from "../normalization/shared";
import {
  isFormControlTag,
  isInlineCarrierTag,
  isLeafEmittingTag,
  mapElementToLeafBlock,
} from "./block-converter";
import { detectComponentType, extractCompositeProps, collectElementText } from "./component-converter";
import { layoutBlockTypeForIntent, layoutIntentFromSignals, layoutPropsForIntent } from "./layout-converter";
import { convertElementStyles, type ConvertedElementStyles } from "./style-converter";
import type { ConversionContext } from "./conversion-report";
import { throwConversionFatal } from "./conversion-errors";

// ---------------------------------------------------------------------------
// Walk state
// ---------------------------------------------------------------------------

interface WalkState {
  paths: PathBuilder;
  reportedClasses: Set<string>;
  /** Every created block, in creation order (roots have parentId null). */
  all: BlockNode[];
}

// Tags where the text-only rule is disabled (they always become containers).
// `li` is intentionally excluded so list items with plain text become
// paragraphs (textLeafType returns "paragraph" for li).
const STRUCTURAL_TAGS: ReadonlySet<string> = new Set([
  "nav", "header", "footer", "ul", "ol", "form", "table",
]);

const SPACE_STACK_CLASS = /(^|[-_])space-y-|(^|[-_])stack([-_]|$)/;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Convert the analysis root nodes into BlockNodes (deterministic). Returns
 * EVERY created block in creation order; roots are blocks with parentId null.
 */
export function convertImportNodes(
  nodes: readonly ImportNode[],
  ctx: ConversionContext,
): BlockNode[] {
  const state: WalkState = {
    paths: new PathBuilder(),
    reportedClasses: new Set(),
    all: [],
  };
  const out: BlockNode[] = [];
  convertNodes(nodes, ctx, out, state, 0);
  return state.all;
}

/** Register a created block globally + append to the local child list. */
function pushBlock(state: WalkState, out: BlockNode[], block: BlockNode): void {
  state.all.push(block);
  out.push(block);
}

function convertNodes(
  nodes: readonly ImportNode[],
  ctx: ConversionContext,
  out: BlockNode[],
  state: WalkState,
  depth: number,
): void {
  for (const node of nodes) {
    convertNode(node, ctx, out, state, depth);
  }
}

function convertNode(
  node: ImportNode,
  ctx: ConversionContext,
  out: BlockNode[],
  state: WalkState,
  depth: number,
): void {
  if (depth > 60) {
    throwConversionFatal("NO_CONVERTIBLE_CONTENT", "Imported structure is too deep to convert.");
  }

  if (node.kind === "text") {
    const value = node.value.trim();
    if (value.length > 0) {
      ctx.report.warn(
        "text-content-dropped",
        `Standalone text was dropped: "${value.slice(0, 40)}"`,
        state.paths.current(),
      );
    }
    return;
  }

  if (node.kind === "fragment") {
    for (const child of node.children) {
      convertNode(child, ctx, out, state, depth + 1);
    }
    return;
  }

  convertElement(node, ctx, out, state, depth, {});
}

// ---------------------------------------------------------------------------
// Element conversion
// ---------------------------------------------------------------------------

interface ConvertOptions {
  /** Label folded in from an adjacent <label> element. */
  labelText?: string;
}

function convertElement(
  element: ImportElementNode,
  ctx: ConversionContext,
  out: BlockNode[],
  state: WalkState,
  depth: number,
  options: ConvertOptions,
): void {
  const tag = element.tagName.toLowerCase();
  const current = state.paths.current();
  const path = current === "root" ? tag : `${current} > ${tag}`;
  state.paths.push(tag);

  const styles = convertElementStyles(element.classNames, element.inlineStyles, ctx, path);
  if (styles.tailwindDetected) ctx.report.setTailwindDetected();
  reportUnconvertedClasses(styles, ctx, state, path);

  const component = detectComponentType(element, ctx);

  // ---- 1. Leaf-emitting tags (heading, p, button, a, img, …) ----
  if (isLeafEmittingTag(tag)) {
    const text = aggregateDescendantText(element);
    const mapping = mapElementToLeafBlock(element, text);
    if (mapping) {
      const block = createBlock(mapping.type, { id: ctx.idFactory.next() });
      block.props = { ...block.props, ...mapping.props };
      block.style = { ...block.style, ...(mapping.style ?? {}), ...styles.style };
      block.responsive = styles.responsive;

      if (options.labelText && (mapping.type === "input" || mapping.type === "textarea" || mapping.type === "checkbox")) {
        block.props.label = options.labelText;
      }
      if (component.name) block.props.name = component.name;
      if (styles.referencedClasses.length > 0) {
        block.props.importClasses = [...styles.referencedClasses];
      }
      if (mapping.approximated) {
        ctx.report.warn("mapping-approximation", `<${tag}> → ${mapping.type} (${mapping.approximated})`, path);
      }
      reportFlattenedElements(element, ctx, path);
      pushBlock(state, out, block);
      state.paths.pop();
      return;
    }
  }

  // ---- 2. Link-list → menu extraction ----
  const menu = tryBuildMenu(element, ctx, path);
  if (menu) {
    pushBlock(state, out, menu);
    state.paths.pop();
    return;
  }

  // ---- 3. Text-only generic elements (div/section with only inline text) ----
  if (!STRUCTURAL_TAGS.has(tag)) {
    const inline = aggregateInlineText(element);
    if (!inline.hasBlockChildren && inline.text.length > 0) {
      const leafType = textLeafType(tag, inline.text, styles);
      const props: Record<string, unknown> =
        leafType === "heading"
          ? { text: inline.text, level: 2, align: textAlignOf(styles) ?? "left", color: "" }
          : { text: inline.text, align: textAlignOf(styles) ?? "left" };
      const block = createBlock(leafType, { id: ctx.idFactory.next() });
      block.props = { ...block.props, ...props };
      block.style = { ...block.style, ...styles.style };
      block.responsive = styles.responsive;
      if (component.name) block.props.name = component.name;
      if (styles.referencedClasses.length > 0) {
        block.props.importClasses = [...styles.referencedClasses];
      }
      pushBlock(state, out, block);
      state.paths.pop();
      return;
    }
  }

  // ---- 4. Candidate type ----
  let candidateType: BlockType | null = null;
  if (tag === "form") candidateType = "form";
  else if (tag === "ul" || tag === "ol") candidateType = "stack";
  else if (tag === "table") candidateType = "container";
  else if (tag === "iframe") candidateType = "container";
  else candidateType = component.type;

  if (!candidateType) {
    const preferStack = tag === "ul" || tag === "ol" || SPACE_STACK_CLASS.test(element.classNames.join(" "));
    candidateType = layoutBlockTypeForIntent(layoutIntentFromSignals(styles.signals), preferStack);
  }

  if (candidateType === null) {
    candidateType = "container";
  }

  if (tag === "table") {
    ctx.report.warn("table-unsupported", "<table> mapped to a container (tables are not yet supported)", path);
  }
  if (tag === "iframe") {
    ctx.report.warn("iframe-placeholder", "<iframe> mapped to a container placeholder (runtime embeds are not executed)", path);
  }

  // ---- 5. Children ----
  const childBlocks = convertChildren(element, ctx, state, depth, path);

  // ---- 6. Nesting validation → downgrade to container when needed ----
  const check = nestingCheck(candidateType, childBlocks);
  let finalType = candidateType;
  if (!check.ok) {
    ctx.report.warn(
      "nesting-downgrade",
      `Block type "${candidateType}" downgraded to "container": ${check.reason}`,
      path,
    );
    finalType = "container";
  }

  // Empty element with an explicit height → spacer.
  if (finalType === "container" && childBlocks.length === 0 && typeof styles.style.height === "string") {
    finalType = "spacer";
  }

  const intent = layoutIntentFromSignals(styles.signals);
  const compositeProps = extractCompositeProps(finalType, collectElementText(element));

  const block = createBlock(finalType, { id: ctx.idFactory.next() });
  block.props = {
    ...block.props,
    ...layoutPropsForIntent(intent),
    ...compositeProps,
  };

  // Extracted composite names (plan names, team member names) win over the
  // generic pattern label (e.g. "Pricing card") for a better builder tree.
  const name = compositeProps.name ?? component.name ?? tagContainerName(tag);
  if (name) block.props.name = name;

  // Persist unconverted class references on the block so a later CSS-import
  // phase can apply the external styles (reported as warnings meanwhile).
  if (styles.referencedClasses.length > 0) {
    block.props.importClasses = [...styles.referencedClasses];
  }

  // Headers usually lead with a text/span brand — fold it into logoText so
  // the most common navbar pattern keeps its brand text.
  if (finalType === "navbar") {
    const brand = aggregateInlineText(element).text;
    if (brand) block.props.logoText = brand.slice(0, 40);
  }

  block.style = { ...block.style, ...styles.style };
  block.responsive = styles.responsive;
  block.children = childBlocks.map((child) => child.id);
  for (const child of childBlocks) {
    child.parentId = block.id;
  }

  pushBlock(state, out, block);
  state.paths.pop();
}

// ---------------------------------------------------------------------------
// Children conversion (label folding, inline carriers, text between blocks)
// ---------------------------------------------------------------------------

function convertChildren(
  element: ImportElementNode,
  ctx: ConversionContext,
  state: WalkState,
  depth: number,
  path: string,
): BlockNode[] {
  const out: BlockNode[] = [];
  const items = element.children;

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];

    if (item.kind === "text") {
      const value = item.value.trim();
      if (value.length > 0) {
        ctx.report.warn(
          "text-content-dropped",
          `Text between block children was dropped: "${value.slice(0, 40)}"`,
          path,
        );
      }
      continue;
    }

    if (item.kind === "fragment") {
      for (const child of item.children) {
        convertNode(child, ctx, out, state, depth + 1);
      }
      continue;
    }

    const tag = item.tagName.toLowerCase();

    if (isInlineCarrierTag(tag)) {
      const folded = aggregateInlineText(item).text;
      if (folded.length > 0) {
        ctx.report.warn(
          "inline-text-folded",
          `Inline <${tag}> text folded into the parent block: "${folded.slice(0, 40)}"`,
          path,
        );
      }
      continue;
    }

    // Label → adjacent form control folding.
    if (tag === "label") {
      const nextIndex = nextElementIndex(items, i);
      if (nextIndex !== -1) {
        const next = items[nextIndex];
        if (next.kind === "element" && isFormControlTag(next.tagName)) {
          const labelText = aggregateInlineText(item).text;
          convertElement(next, ctx, out, state, depth + 1, { labelText });
          i = nextIndex;
          continue;
        }
      }
    }

    convertNode(item, ctx, out, state, depth + 1);
  }

  return out;
}

function nextElementIndex(
  items: readonly ImportNode[],
  from: number,
): number {
  for (let i = from + 1; i < items.length; i += 1) {
    if (items[i].kind === "element") return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Nesting validation
// ---------------------------------------------------------------------------

interface NestingCheck {
  ok: boolean;
  reason?: string;
}

function nestingCheck(parentType: BlockType, children: BlockNode[]): NestingCheck {
  const parent = blockRegistry.get(parentType);
  if (!parent) return { ok: false, reason: `unknown block type "${parentType}"` };
  if (!parent.nesting.allowsChildren) {
    return children.length === 0
      ? { ok: true }
      : { ok: false, reason: `"${parentType}" blocks cannot contain other blocks` };
  }
  if (parent.nesting.allowedChildTypes !== "*") {
    for (const child of children) {
      if (!canNest(parentType, child.type)) {
        return { ok: false, reason: `"${child.type}" cannot be placed inside "${parentType}"` };
      }
    }
  }
  const max = parent.nesting.maxChildren;
  if (max !== undefined && children.length > max) {
    return { ok: false, reason: `"${parentType}" allows at most ${max} children (got ${children.length})` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Menu / link-list extraction
// ---------------------------------------------------------------------------

function tryBuildMenu(
  element: ImportElementNode,
  ctx: ConversionContext,
  path: string,
): BlockNode | null {
  const tag = element.tagName.toLowerCase();
  const isNavTag = tag === "nav";
  const isListTag = tag === "ul" || tag === "ol";
  const hasMenuClass = element.classNames.some((className) =>
    /(^|[-_])(menu|nav|nav-links|navlinks)([-_]|$)/i.test(className),
  );
  if (!isNavTag && !isListTag && !hasMenuClass) return null;

  const links = extractLinks(element);
  if (links.length === 0) return null;

  const block = createBlock("menu", { id: ctx.idFactory.next() });
  block.props = { ...block.props, links, name: isNavTag ? "Menu" : "List" };
  if (isListTag) {
    ctx.report.warn("list-to-menu", "<ul>/<ol> of links converted to a menu block", path);
  }
  return block;
}

function extractLinks(
  element: ImportElementNode,
): Array<{ text: string; href: string }> {
  const links: Array<{ text: string; href: string }> = [];
  const walk = (nodes: readonly ImportNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "element") continue;
      if (node.tagName.toLowerCase() === "a") {
        const href =
          typeof node.attributes.href === "string" ? node.attributes.href : "#";
        const text = aggregateDescendantText(node) || href;
        links.push({ text, href });
      } else if (node.tagName.toLowerCase() !== "nav") {
        walk(node.children);
      }
    }
  };
  walk(element.children);
  return links;
}

// ---------------------------------------------------------------------------
// Text aggregation helpers
// ---------------------------------------------------------------------------

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** All descendant text of an element, joined with spaces. */
function aggregateDescendantText(element: ImportElementNode): string {
  const parts: string[] = [];
  const walk = (nodes: readonly ImportNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "text") parts.push(node.value);
      else if (node.kind === "element") walk(node.children);
      else if (node.kind === "fragment") walk(node.children);
    }
  };
  walk(element.children);
  return normalizeWhitespace(parts.join(" "));
}

interface InlineTextSummary {
  text: string;
  hasBlockChildren: boolean;
}

/** Text of an element when it contains only text + inline carriers. */
function aggregateInlineText(element: ImportElementNode): InlineTextSummary {
  let text = "";
  let hasBlockChildren = false;
  const walk = (nodes: readonly ImportNode[]): void => {
    for (const node of nodes) {
      if (node.kind === "text") {
        text += node.value;
      } else if (node.kind === "element") {
        if (isInlineCarrierTag(node.tagName)) walk(node.children);
        else hasBlockChildren = true;
      } else if (node.kind === "fragment") {
        walk(node.children);
      }
    }
  };
  walk(element.children);
  return { text: normalizeWhitespace(text), hasBlockChildren };
}

/** Direct non-carrier element children (flattened into a leaf's text). */
function flattenedElementTags(element: ImportElementNode): string[] {
  const tags: string[] = [];
  for (const child of element.children) {
    if (child.kind === "element" && !isInlineCarrierTag(child.tagName)) {
      tags.push(child.tagName.toLowerCase());
    }
  }
  return tags;
}

function reportFlattenedElements(
  element: ImportElementNode,
  ctx: ConversionContext,
  path: string,
): void {
  const tags = flattenedElementTags(element);
  if (tags.length > 0) {
    ctx.report.warn(
      "nested-element-flattened",
      `Nested elements <${[...new Set(tags)].join(">, <")}> were flattened into the block text`,
      path,
    );
  }
}

// ---------------------------------------------------------------------------
// Text leaf type heuristic
// ---------------------------------------------------------------------------

function textLeafType(
  tag: string,
  text: string,
  styles: ConvertedElementStyles,
): "heading" | "paragraph" {
  if (tag === "li" || tag === "label") return "paragraph";
  const s = styles.style;
  const fontSize = typeof s.fontSize === "string" ? parseFloat(s.fontSize) : undefined;
  const fontWeight = typeof s.fontWeight === "number" ? s.fontWeight : undefined;
  const tracking = typeof s.letterSpacing === "string" ? s.letterSpacing : undefined;

  const headingTypography =
    (fontSize !== undefined && Number.isFinite(fontSize) && fontSize >= 1.5) ||
    (fontWeight !== undefined && fontWeight >= 600) ||
    (tracking !== undefined && tracking !== "0em" && tracking !== "normal");

  const short = text.length <= 40;
  const punctuated = /[.!?]["')]*$/.test(text);

  if (headingTypography) return "heading";
  if (short && !punctuated) return "heading";
  return "paragraph";
}

function textAlignOf(styles: ConvertedElementStyles): string | undefined {
  const value = styles.style.textAlign;
  return typeof value === "string" ? value : undefined;
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------

function tagContainerName(tag: string): string | undefined {
  switch (tag) {
    case "section":
      return "Section";
    case "main":
      return "Main";
    case "article":
      return "Article";
    case "aside":
      return "Aside";
    case "header":
      return "Header";
    case "form":
      return "Form";
    case "figure":
      return "Figure";
    case "ul":
    case "ol":
      return "List";
    case "nav":
      return "Navigation";
    case "li":
      return "List item";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Class reference reporting (deduplicated)
// ---------------------------------------------------------------------------

function reportUnconvertedClasses(
  styles: ConvertedElementStyles,
  ctx: ConversionContext,
  state: WalkState,
  path: string,
): void {
  for (const className of styles.referencedClasses) {
    if (state.reportedClasses.has(className)) continue;
    state.reportedClasses.add(className);
    ctx.report.warn(
      "css-class-reference",
      `Class "${className}" was not converted (no matching style utility or CSS applied)`,
      path,
    );
  }
}
