// ---------------------------------------------------------------------------
// Section ↔ Block adapter (Phase O)
//
// Bridges the stable section model and the new LEGO block model WITHOUT
// redesigning persistence, the section schema, or the store:
//
//   - sectionToBlockTree  — project a section into a Container root block plus
//     child blocks bound to the section's SAFE editable fields.
//   - blockTreeToSection  — fold bound block edits back into section props,
//     then validate with the existing section schema.
//
// Only registered safe fields are bound. hrefs, prices, AssetRefs, ids and
// structural fields are never exposed as plain-text block props. Deterministic
// and pure: no React, no DOM, no store mutation.
// ---------------------------------------------------------------------------

import type { BaseSection } from "@/types/section";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import { createBlock } from "../engine/block-operations";
import { allNodes } from "../engine/tree-traversal";
import type { BlockNode, BlockResult, BlockTree, BlockType } from "../types";

// ---------------------------------------------------------------------------
// Binding model
// ---------------------------------------------------------------------------

export interface BlockFieldBinding {
  /** Path into section.props (numeric entries index arrays). */
  sectionPath: (string | number)[];
  /** The block node prop that carries the value (e.g. "text"). */
  valueKey: string;
  /** Block type used to represent this field. */
  blockType: BlockType;
  /**
   * Optional array-group path (e.g. ["features", 2]). When present the block
   * represents one array item — group delete/duplicate operate on the item.
   */
  groupPath?: (string | number)[];
  /** Human label for the builder tree/inspector. */
  label: string;
  /** Kind used by the inline-editing field model. */
  fieldKind: "text" | "textarea" | "heading" | "button-text" | "description";
}

/** Hard cap for bound text values folded back into the section model. */
export const MAX_BOUND_TEXT = 2000;

// Reserved prop keys carried by the root container block.
export const ROOT_SECTION_TYPE_KEY = "_sectionType";
export const ROOT_SECTION_ID_KEY = "_sectionId";
const ROOT_LABEL_KEY = "name";

// Reserved prop keys carried by bound child blocks.
export const BIND_PATH_KEY = "_bindPath";
export const BIND_VALUE_KEY = "_bindValueKey";
export const BIND_GROUP_KEY = "_bindGroup";
export const BIND_LABEL_KEY = "_bindLabel";

// ---------------------------------------------------------------------------
// Read/write at a section.props path
// ---------------------------------------------------------------------------

function getAtPath(
  props: Record<string, unknown>,
  path: (string | number)[],
): unknown {
  let current: unknown = props;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function setAtPath(
  props: Record<string, unknown>,
  path: (string | number)[],
  value: unknown,
): void {
  let current: unknown = props;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    if (typeof current !== "object" || current === null) return;
    const next = (current as Record<string | number, unknown>)[key];
    if (typeof next !== "object" || next === null) {
      (current as Record<string | number, unknown>)[key] = {};
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  const last = path[path.length - 1];
  if (typeof current === "object" && current !== null) {
    (current as Record<string | number, unknown>)[last] = value;
  }
}

function cloneProps(props: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(props)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Field maps — SAFE editable fields per built-in section type
// ---------------------------------------------------------------------------

/**
 * Deterministic bindings for a section. Array field lengths are read live so
 * every array item becomes its own bound block (features[i], plans[i], …).
 */
export function bindingsForSection(section: BaseSection): BlockFieldBinding[] {
  const props = section.props;
  const bindings: BlockFieldBinding[] = [];

  switch (section.type) {
    case "header": {
      bindings.push(
        { sectionPath: ["logoText"], valueKey: "text", blockType: "heading", label: "Logo text", fieldKind: "text" },
        { sectionPath: ["ctaText"], valueKey: "text", blockType: "button", label: "Action button", fieldKind: "button-text" },
      );
      break;
    }
    case "hero": {
      bindings.push(
        { sectionPath: ["headline"], valueKey: "text", blockType: "heading", label: "Main headline", fieldKind: "heading" },
        { sectionPath: ["subheadline"], valueKey: "text", blockType: "paragraph", label: "Subheadline", fieldKind: "description" },
        { sectionPath: ["primaryCta", "text"], valueKey: "text", blockType: "button", label: "Primary button", fieldKind: "button-text" },
      );
      const secondaryCta = props.secondaryCta as { text?: string } | undefined;
      if (secondaryCta && typeof secondaryCta.text === "string") {
        bindings.push({
          sectionPath: ["secondaryCta", "text"],
          valueKey: "text",
          blockType: "button",
          label: "Secondary button",
          fieldKind: "button-text",
        });
      }
      break;
    }
    case "features": {
      bindings.push(
        { sectionPath: ["title"], valueKey: "text", blockType: "heading", label: "Section title", fieldKind: "heading" },
      );
      const subtitle = props.subtitle;
      if (typeof subtitle === "string") {
        bindings.push({
          sectionPath: ["subtitle"],
          valueKey: "text",
          blockType: "paragraph",
          label: "Section subtitle",
          fieldKind: "description",
        });
      }
      const features = Array.isArray(props.features) ? props.features : [];
      features.forEach((_, i) => {
        const groupPath: (string | number)[] = ["features", i];
        bindings.push(
          {
            sectionPath: [...groupPath, "title"],
            valueKey: "text",
            blockType: "heading",
            groupPath,
            label: `Feature ${i + 1} — title`,
            fieldKind: "heading",
          },
          {
            sectionPath: [...groupPath, "description"],
            valueKey: "text",
            blockType: "paragraph",
            groupPath,
            label: `Feature ${i + 1} — description`,
            fieldKind: "description",
          },
        );
      });
      break;
    }
    case "pricing": {
      bindings.push(
        { sectionPath: ["title"], valueKey: "text", blockType: "heading", label: "Section title", fieldKind: "heading" },
      );
      const subtitle = props.subtitle;
      if (typeof subtitle === "string") {
        bindings.push({
          sectionPath: ["subtitle"],
          valueKey: "text",
          blockType: "paragraph",
          label: "Section subtitle",
          fieldKind: "description",
        });
      }
      const plans = Array.isArray(props.plans) ? props.plans : [];
      plans.forEach((_, i) => {
        const groupPath: (string | number)[] = ["plans", i];
        bindings.push(
          {
            sectionPath: [...groupPath, "name"],
            valueKey: "text",
            blockType: "heading",
            groupPath,
            label: `Plan ${i + 1} — name`,
            fieldKind: "heading",
          },
          {
            sectionPath: [...groupPath, "description"],
            valueKey: "text",
            blockType: "paragraph",
            groupPath,
            label: `Plan ${i + 1} — description`,
            fieldKind: "description",
          },
          {
            sectionPath: [...groupPath, "cta"],
            valueKey: "text",
            blockType: "button",
            groupPath,
            label: `Plan ${i + 1} — button`,
            fieldKind: "button-text",
          },
        );
      });
      break;
    }
    case "faq": {
      bindings.push(
        { sectionPath: ["title"], valueKey: "text", blockType: "heading", label: "Section title", fieldKind: "heading" },
      );
      const items = Array.isArray(props.items) ? props.items : [];
      items.forEach((_, i) => {
        const groupPath: (string | number)[] = ["items", i];
        bindings.push(
          {
            sectionPath: [...groupPath, "question"],
            valueKey: "text",
            blockType: "heading",
            groupPath,
            label: `Question ${i + 1}`,
            fieldKind: "heading",
          },
          {
            sectionPath: [...groupPath, "answer"],
            valueKey: "text",
            blockType: "paragraph",
            groupPath,
            label: `Answer ${i + 1}`,
            fieldKind: "description",
          },
        );
      });
      break;
    }
    case "cta": {
      bindings.push(
        { sectionPath: ["headline"], valueKey: "text", blockType: "heading", label: "Headline", fieldKind: "heading" },
      );
      const subheadline = props.subheadline;
      if (typeof subheadline === "string") {
        bindings.push({
          sectionPath: ["subheadline"],
          valueKey: "text",
          blockType: "paragraph",
          label: "Subheadline",
          fieldKind: "description",
        });
      }
      bindings.push({
        sectionPath: ["ctaText"],
        valueKey: "text",
        blockType: "button",
        label: "Action button",
        fieldKind: "button-text",
      });
      break;
    }
    case "footer": {
      bindings.push(
        { sectionPath: ["text"], valueKey: "text", blockType: "paragraph", label: "Footer text", fieldKind: "description" },
      );
      break;
    }
    default:
      break;
  }

  return bindings;
}

// ---------------------------------------------------------------------------
// section → block tree
// ---------------------------------------------------------------------------

/** Project a section into a one-root block tree (Container root + bound children). */
export function sectionToBlockTree(section: BaseSection): BlockTree {
  const root = createBlock("container", { id: section.id });
  root.props = {
    ...root.props,
    [ROOT_SECTION_TYPE_KEY]: section.type,
    [ROOT_SECTION_ID_KEY]: section.id,
    [ROOT_LABEL_KEY]: section.type,
  };
  root.style = { ...section.styles };

  const nodes: Record<string, BlockNode> = { [root.id]: root };
  const children: BlockNode[] = [];
  for (const binding of bindingsForSection(section)) {
    const rawValue = getAtPath(section.props, binding.sectionPath);
    if (typeof rawValue !== "string") continue;
    // Deterministic bound-child id: section id + binding path. The same
    // section always projects to the same child ids, so builder selection
    // computed from one tree stays valid in the component's derived forest.
    const child = createBlock(binding.blockType, {
      id: boundBlockId(section.id, binding.sectionPath),
    });
    child.props = {
      ...child.props,
      text: rawValue,
      [BIND_PATH_KEY]: binding.sectionPath,
      [BIND_VALUE_KEY]: binding.valueKey,
      [BIND_LABEL_KEY]: binding.label,
    };
    if (binding.groupPath) {
      child.props[BIND_GROUP_KEY] = binding.groupPath;
    }
    child.parentId = root.id;
    children.push(child);
    nodes[child.id] = child;
  }
  root.children = children.map((c) => c.id);

  return { rootIds: [root.id], nodes };
}

/**
 * Stable block id for a bound field: `<sectionId>-<path segments>`. Path
 * segments are stringified (array indices included), so array items get
 * unique, repeatable ids (e.g. `s-features-features-2-title`).
 */
export function boundBlockId(
  sectionId: string,
  sectionPath: (string | number)[],
): string {
  return `b-${sectionId}-${sectionPath.map((p) => String(p)).join("-")}`;
}

// ---------------------------------------------------------------------------
// block tree → section
// ---------------------------------------------------------------------------

export interface BlockCommitResult {
  /** The folded section (validated). */
  section: BaseSection;
  /** Number of bound fields folded back. */
  appliedFields: number;
  /** Warnings for bindings that could not be applied (never fatal). */
  warnings: string[];
}

/** True when a node is a bound block carrying safe editable text. */
export function isBoundBlock(node: BlockNode): boolean {
  return Array.isArray(node.props[BIND_PATH_KEY]) && typeof node.props[BIND_VALUE_KEY] === "string";
}

/** The binding declared on a node (or null). */
export function bindingOf(node: BlockNode): BlockFieldBinding | null {
  const path = node.props[BIND_PATH_KEY];
  const valueKey = node.props[BIND_VALUE_KEY];
  if (!Array.isArray(path) || typeof valueKey !== "string") return null;
  return {
    sectionPath: path as (string | number)[],
    valueKey,
    blockType: node.type,
    groupPath: Array.isArray(node.props[BIND_GROUP_KEY])
      ? (node.props[BIND_GROUP_KEY] as (string | number)[])
      : undefined,
    label: typeof node.props[BIND_LABEL_KEY] === "string" ? (node.props[BIND_LABEL_KEY] as string) : node.type,
    fieldKind: "text",
  };
}

/**
 * Fold a block tree back into a validated section.
 *
 * - Only bound blocks (registered safe fields) are written back.
 * - Values must be strings; whitespace is trimmed and length capped.
 * - Unbound blocks are ignored with a warning (they cannot map to the section
 *   model without a persistence redesign — Phase P).
 * - The resulting section is validated with the existing schema; any schema
 *   failure is returned as a structured error and NOT applied.
 */
export function blockTreeToSection(
  tree: BlockTree,
  original: BaseSection,
): BlockResult<BlockCommitResult> {
  const root = tree.nodes[tree.rootIds[0]];
  if (!root) {
    return { ok: false, error: { code: "INVALID_TREE", message: "The block tree has no root." } };
  }
  if (root.props[ROOT_SECTION_ID_KEY] !== original.id) {
    return {
      ok: false,
      error: { code: "BLOCK_NOT_FOUND", message: "The block tree does not belong to this section." },
    };
  }

  const nextProps = cloneProps(original.props);
  const warnings: string[] = [];
  let appliedFields = 0;
  let changed = false;

  for (const node of allNodes(tree)) {
    // Unbound, non-root blocks (e.g. browser insertions) cannot be folded
    // into the section model — surfaced as a warning, never silently lost.
    if (node.id !== root.id && !isBoundBlock(node)) {
      warnings.push(
        `Block "${blockDisplayLabel(node)}" (${node.type}) is not part of the saved section model.`,
      );
      continue;
    }
    if (!isBoundBlock(node)) continue;
    const binding = bindingOf(node);
    if (!binding) continue;
    const value = node.props[binding.valueKey];
    if (typeof value !== "string") {
      warnings.push(`Block "${node.id}" has a non-string value and was skipped.`);
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > MAX_BOUND_TEXT) {
      warnings.push(`Field "${binding.label}" exceeds ${MAX_BOUND_TEXT} characters and was skipped.`);
      continue;
    }
    const current = getAtPath(nextProps, binding.sectionPath);
    if (current === trimmed) continue;
    setAtPath(nextProps, binding.sectionPath, trimmed);
    appliedFields += 1;
    changed = true;
  }

  const candidate: BaseSection = {
    id: original.id,
    type: original.type,
    order: original.order,
    visible: original.visible,
    props: nextProps,
    styles: original.styles,
  };

  const validation = validateSectionSafe(candidate);
  if (!validation.success) {
    const message = validation.error.issues
      .map((issue) => issue.path.join(".") + ": " + issue.message)
      .join("; ");
    return {
      ok: false,
      error: { code: "INVALID_TREE", message: `Folded section failed validation: ${message}` },
    };
  }

  if (!changed) {
    return {
      ok: true,
      value: { section: original, appliedFields: 0, warnings },
    };
  }

  return {
    ok: true,
    value: {
      section: candidate as BaseSection,
      appliedFields,
      warnings,
    },
  };
}

// ---------------------------------------------------------------------------
// Array-group folding — delete / duplicate a bound array item
// ---------------------------------------------------------------------------

/**
 * Remove the array item referenced by a bound block's groupPath (e.g. delete
 * features[2]). Returns the updated props or a structured error.
 */
export function deleteGroupFromProps(
  props: Record<string, unknown>,
  groupPath: (string | number)[],
): BlockResult<Record<string, unknown>> {
  const arrayPath = groupPath.slice(0, -1);
  const index = groupPath[groupPath.length - 1];
  const parent = getAtPath(props, arrayPath);
  if (!Array.isArray(parent) || typeof index !== "number" || !Number.isInteger(index)) {
    return { ok: false, error: { code: "INVALID_TREE", message: "Invalid array group path." } };
  }
  if (index < 0 || index >= parent.length) {
    return { ok: false, error: { code: "BLOCK_NOT_FOUND", message: "Array item does not exist." } };
  }
  const next = cloneProps(props);
  const target = getAtPath(next, arrayPath);
  if (!Array.isArray(target)) {
    return { ok: false, error: { code: "INVALID_TREE", message: "Invalid array group path." } };
  }
  target.splice(index, 1);
  return { ok: true, value: next };
}

/**
 * Duplicate the array item referenced by a bound block's groupPath (insert a
 * deep clone directly after the original).
 */
export function duplicateGroupInProps(
  props: Record<string, unknown>,
  groupPath: (string | number)[],
): BlockResult<Record<string, unknown>> {
  const arrayPath = groupPath.slice(0, -1);
  const index = groupPath[groupPath.length - 1];
  const parent = getAtPath(props, arrayPath);
  if (!Array.isArray(parent) || typeof index !== "number" || !Number.isInteger(index)) {
    return { ok: false, error: { code: "INVALID_TREE", message: "Invalid array group path." } };
  }
  if (index < 0 || index >= parent.length) {
    return { ok: false, error: { code: "BLOCK_NOT_FOUND", message: "Array item does not exist." } };
  }
  const item = parent[index];
  if (typeof item !== "object" || item === null) {
    return { ok: false, error: { code: "INVALID_TREE", message: "Array item is not an object." } };
  }
  const clone = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
  const next = cloneProps(props);
  const target = getAtPath(next, arrayPath);
  if (!Array.isArray(target)) {
    return { ok: false, error: { code: "INVALID_TREE", message: "Invalid array group path." } };
  }
  target.splice(index + 1, 0, clone);
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// Helpers for the UI
// ---------------------------------------------------------------------------

/** Render label for a block node in the build tree. */
export function blockDisplayLabel(node: BlockNode): string {
  const name = node.props[BIND_LABEL_KEY];
  if (typeof name === "string" && name.length > 0) return name;
  const custom = node.props.name;
  if (typeof custom === "string" && custom.trim().length > 0) return custom;
  return node.type;
}

/**
 * Validate a props replacement for a section (used by group delete/duplicate)
 * without touching the store. Returns the candidate section when valid.
 */
export function validatePropsChange(
  section: BaseSection,
  nextProps: Record<string, unknown>,
): BlockResult<BaseSection> {
  const candidate: BaseSection = {
    id: section.id,
    type: section.type,
    order: section.order,
    visible: section.visible,
    props: nextProps,
    styles: section.styles,
  };
  const validation = validateSectionSafe(candidate);
  if (!validation.success) {
    const message = validation.error.issues
      .map((issue) => issue.path.join(".") + ": " + issue.message)
      .join("; ");
    return {
      ok: false,
      error: { code: "INVALID_TREE", message: `Section validation failed: ${message}` },
    };
  }
  return { ok: true, value: candidate as BaseSection };
}

/**
 * Extract the subtree rooted at `sectionId` from a page forest (used to fold
 * one section's block edits back through commitBlockTree).
 */
export function extractSectionTree(tree: BlockTree, sectionId: string): BlockTree {
  const root = tree.nodes[sectionId];
  if (!root) return { rootIds: [], nodes: {} };
  const nodes: Record<string, BlockNode> = {};
  const collect = (node: BlockNode): void => {
    nodes[node.id] = node;
    for (const childId of node.children) {
      const child = tree.nodes[childId];
      if (child) collect(child);
    }
  };
  collect(root);
  return { rootIds: [sectionId], nodes };
}

/**
 * Replace the subtree rooted at `sectionId` in a page forest with a new
 * section tree. Root order is preserved; unknown roots are appended.
 */
export function replaceSectionTree(forest: BlockTree, sectionTree: BlockTree): BlockTree {
  const sectionId = sectionTree.rootIds[0];
  if (!sectionId) return forest;

  const next: BlockTree = {
    rootIds: [...forest.rootIds],
    nodes: { ...forest.nodes },
  };

  // Remove old subtree nodes.
  const root = next.nodes[sectionId];
  if (root) {
    const removed = new Set<string>();
    const collect = (node: BlockNode): void => {
      removed.add(node.id);
      for (const childId of node.children) {
        const child = next.nodes[childId];
        if (child) collect(child);
      }
    };
    collect(root);
    for (const id of removed) delete next.nodes[id];
  }

  // Merge the new subtree.
  for (const [id, node] of Object.entries(sectionTree.nodes)) {
    next.nodes[id] = node;
  }
  if (!next.rootIds.includes(sectionId)) {
    next.rootIds.push(sectionId);
  }

  return next;
}

/** Fingerprint of a section's props — used to invalidate session trees. */
export function propsFingerprint(section: BaseSection): string {
  return JSON.stringify(section.props);
}

/** Build a page forest: every section becomes a Container root block. */
export function buildPageForest(sections: BaseSection[]): BlockTree {
  const rootIds: string[] = [];
  const nodes: Record<string, BlockNode> = {};
  for (const section of sections) {
    const tree = sectionToBlockTree(section);
    for (const [id, node] of Object.entries(tree.nodes)) {
      nodes[id] = node;
    }
    rootIds.push(...tree.rootIds);
  }
  return { rootIds, nodes };
}
