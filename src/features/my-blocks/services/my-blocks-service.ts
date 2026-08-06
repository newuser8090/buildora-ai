// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — service layer
//
// Responsibilities:
//   - prepare a BlockTree for storage (deep clone, strip session/internal
//     marker props, validate against the custom-block schema + tree caps)
//   - compute preview metadata (block count, root type, media/interactive)
//   - derive category and tags from the tree
//   - sanitize name/description/tags
//   - duplicate-safe names
//   - save from: imported conversion, persistent custom-block section, or a
//     selected block subtree (where valid)
//
// Pure + deterministic; no React, no Zustand, no editor-store logic. The
// only side effects go through the injected storage adapter.
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "@/features/blocks/types";
import {
  customBlockTreeFromSection,
} from "@/features/blocks/adapters/section-block-adapter";
import {
  CustomBlockTreeSchema,
  normalizeCustomBlockTree,
} from "@/features/code-import/schemas/custom-block-schema";
import {
  isMyBlockCategory,
  type CreateMyBlockInput,
  type MyBlockCategory,
  type MyBlockPreviewMetadata,
  type MyBlockRecord,
  type MyBlockResult,
  type MyBlockSourceMetadata,
  type MyBlocksStorageAdapter,
} from "../types";
import {
  generateUniqueName,
  sanitizeMyBlockDescription,
  sanitizeMyBlockName,
  sanitizeMyBlockTags,
} from "../schemas/my-block-schema";
import { makeMyBlockError } from "../errors";

// ---------------------------------------------------------------------------
// Tree preparation
// ---------------------------------------------------------------------------

/**
 * Strip internal `_`-prefixed marker props (binding/section markers) from
 * every node. Returns a deep-cloned tree — never mutates the input.
 */
export function stripInternalProps(tree: BlockTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node.props)) {
      if (key.startsWith("_")) continue;
      props[key] = value;
    }
    nodes[id] = { ...node, props };
  }
  return { rootIds: [...tree.rootIds], nodes };
}

/** Deep clone a tree (plain JSON clone keeps it serialization-safe). */
export function cloneTreeDeep(tree: BlockTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = JSON.parse(JSON.stringify(node)) as BlockNode;
  }
  return { rootIds: [...tree.rootIds], nodes };
}

/**
 * Prepare a tree for storage:
 *   - deep clone (never mutates the source)
 *   - strip internal marker props
 *   - validate structurally (custom-block schema caps + nesting-safe)
 * Returns a validated tree or a structured error.
 */
export function prepareTreeForStorage(tree: BlockTree): MyBlockResult<BlockTree> {
  const cloned = cloneTreeDeep(tree);
  const stripped = stripInternalProps(cloned);

  // Defensive normalization repairs any over-limit values deterministically;
  // then the strict schema re-validates the result.
  const normalized = normalizeCustomBlockTree(stripped);
  if (!normalized) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", "This design has no usable blocks to save."),
    };
  }
  const validation = CustomBlockTreeSchema.safeParse(normalized);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return {
      ok: false,
      error: makeMyBlockError(
        "INVALID_RECORD",
        issue ? `This design cannot be saved: ${issue.message}` : "This design cannot be saved.",
      ),
    };
  }
  return { ok: true, value: normalized as BlockTree };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/** Compute preview metadata from a validated tree. */
export function computePreviewMetadata(tree: BlockTree): MyBlockPreviewMetadata {
  const nodes = Object.values(tree.nodes);
  return {
    blockCount: nodes.length,
    rootType: tree.rootIds[0] ? (tree.nodes[tree.rootIds[0]]?.type ?? "container") : "container",
    containsMedia: nodes.some((n) => n.type === "image" || n.type === "video"),
    containsInteractive: nodes.some(
      (n) =>
        n.type === "form" ||
        n.type === "input" ||
        n.type === "textarea" ||
        n.type === "checkbox" ||
        n.type === "tabs" ||
        n.type === "accordion",
    ),
  };
}

// ---------------------------------------------------------------------------
// Category + tags derivation
// ---------------------------------------------------------------------------

const TYPE_CATEGORY_MAP: Partial<Record<BlockNode["type"], MyBlockCategory>> = {
  container: "layout",
  row: "layout",
  column: "layout",
  grid: "layout",
  stack: "layout",
  divider: "layout",
  spacer: "layout",
  heading: "text",
  paragraph: "text",
  badge: "text",
  button: "buttons",
  image: "media",
  video: "media",
  icon: "media",
  form: "forms",
  input: "forms",
  textarea: "forms",
  checkbox: "forms",
  tabs: "forms",
  accordion: "forms",
  card: "cards",
  "pricing-card": "cards",
  "feature-card": "cards",
  "review-card": "cards",
  "faq-item": "cards",
  "team-member": "cards",
  navbar: "navigation",
  footer: "navigation",
  menu: "navigation",
};

const TAG_BY_TYPE: Record<string, string> = {
  navbar: "navigation",
  menu: "links",
  footer: "footer",
  heading: "heading",
  paragraph: "text",
  button: "button",
  image: "image",
  video: "video",
  "pricing-card": "pricing",
  "review-card": "reviews",
  "faq-item": "faq",
  form: "form",
  input: "form",
  "feature-card": "features",
  "team-member": "team",
  card: "card",
  icon: "icon",
};

/**
 * Derive a category from the tree:
 *   - a semantic root wins (navbar → navigation, form → forms, …)
 *   - generic layout wrappers (container/row/column/grid/…) defer to their
 *     content, so an imported section (always rooted at a container) still
 *     gets a useful category
 *   - large multi-part designs → "complete-section"
 *   - otherwise the most common content kind, or "other"
 */
export function deriveCategory(tree: BlockTree): MyBlockCategory {
  const nodes = Object.values(tree.nodes);
  if (nodes.length === 0) return "other";

  const rootId = tree.rootIds[0];
  const rootType = rootId ? tree.nodes[rootId]?.type : undefined;

  // A semantic root wins; generic layout wrappers defer to their content.
  const GENERIC_LAYOUT_TYPES: ReadonlySet<string> = new Set([
    "container",
    "row",
    "column",
    "grid",
    "stack",
    "divider",
    "spacer",
  ]);
  if (rootType && !GENERIC_LAYOUT_TYPES.has(rootType)) {
    const rootCategory = TYPE_CATEGORY_MAP[rootType];
    if (rootCategory) return rootCategory as MyBlockCategory;
  }

  // Score the content (the generic root itself is not counted).
  const counts = new Map<MyBlockCategory, number>();
  for (const node of nodes) {
    if (node.id === rootId) continue;
    const cat = TYPE_CATEGORY_MAP[node.type];
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  let best: MyBlockCategory = "other";
  let bestCount = 0;
  for (const [cat, count] of counts) {
    if (count > bestCount) {
      best = cat;
      bestCount = count;
    }
  }
  // A design mixing several kinds reads as a complete section.
  if (counts.size >= 3 && nodes.length >= 6) return "complete-section";
  return bestCount > 0 ? best : "other";
}

/** Derive a compact, deduplicated tag list from the tree (≤ 5 tags). */
export function deriveTags(tree: BlockTree): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of Object.values(tree.nodes)) {
    const tag = TAG_BY_TYPE[node.type];
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
    if (out.length >= 5) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Name suggestions
// ---------------------------------------------------------------------------

/** Suggest a friendly name from the tree's root block name. */
export function suggestNameFromTree(tree: BlockTree, fallback = "Saved block"): string {
  const rootId = tree.rootIds[0];
  if (!rootId) return fallback;
  const name = tree.nodes[rootId]?.props?.name;
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim().slice(0, 80);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Save operations
// ---------------------------------------------------------------------------

export interface SaveFromTreeInput {
  tree: BlockTree;
  name?: string;
  description?: string;
  category?: MyBlockCategory;
  tags?: string[];
  sourceMetadata?: MyBlockSourceMetadata;
}

/** Save a validated tree as a My Block through the storage adapter. */
export async function saveTreeAsMyBlock(
  adapter: MyBlocksStorageAdapter,
  input: SaveFromTreeInput,
  existingNames: ReadonlyArray<string> = [],
): Promise<MyBlockResult<MyBlockRecord>> {
  const prepared = prepareTreeForStorage(input.tree);
  if (!prepared.ok) return prepared;

  const tree = prepared.value;
  const baseName =
    sanitizeMyBlockName(input.name) ?? suggestNameFromTree(tree, "Saved block");
  const name = generateUniqueName(baseName, existingNames);

  const createInput: CreateMyBlockInput = {
    name,
    ...(sanitizeMyBlockDescription(input.description) !== undefined
      ? { description: sanitizeMyBlockDescription(input.description) }
      : {}),
    category: input.category && isMyBlockCategory(input.category)
      ? input.category
      : deriveCategory(tree),
    tags: input.tags && input.tags.length > 0 ? sanitizeMyBlockTags(input.tags) : deriveTags(tree),
    tree,
    ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
  };
  return adapter.createMyBlock(createInput);
}

/** Save a persistent custom-block section as a My Block. */
export async function saveSectionAsMyBlock(
  adapter: MyBlocksStorageAdapter,
  section: Parameters<typeof customBlockTreeFromSection>[0],
  options?: {
    name?: string;
    description?: string;
    category?: MyBlockCategory;
    tags?: string[];
    existingNames?: ReadonlyArray<string>;
  },
): Promise<MyBlockResult<MyBlockRecord>> {
  // customBlockTreeFromSection synthesizes a minimal container for a missing
  // tree, so check the source tree directly — an empty design has nothing to
  // save and is rejected with a clear message.
  const rawTree = (section.props as { tree?: unknown } | undefined)?.tree;
  const rawTreeUsable =
    !!rawTree &&
    typeof rawTree === "object" &&
    Array.isArray((rawTree as { rootIds?: unknown }).rootIds) &&
    (rawTree as { rootIds: string[] }).rootIds.length > 0;
  if (!rawTreeUsable) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", "This design has no blocks to save."),
    };
  }
  const tree = customBlockTreeFromSection(section);
  if (tree.rootIds.length === 0) {
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", "This design has no blocks to save."),
    };
  }
  const props = section.props as Record<string, unknown> | undefined;
  const rawName = props?.name;
  const fallbackName =
    typeof rawName === "string" && rawName.trim().length > 0
      ? rawName.trim()
      : "Imported design";

  const rawMeta = props?.sourceMetadata;
  const meta =
    rawMeta && typeof rawMeta === "object"
      ? (rawMeta as Record<string, unknown>)
      : undefined;

  return saveTreeAsMyBlock(adapter, {
    tree,
    name: options?.name ?? fallbackName,
    description: options?.description,
    category: options?.category,
    tags: options?.tags,
    sourceMetadata: {
      source: "created",
      ...(meta
        ? {
            language:
              typeof meta.language === "string" ? (meta.language as MyBlockSourceMetadata["language"]) : undefined,
            originalWarningCount:
              typeof meta.warningCount === "number" ? meta.warningCount : undefined,
            converterVersion:
              typeof meta.converterVersion === "number" ? meta.converterVersion : undefined,
          }
        : {}),
    },
  }, options?.existingNames ?? []);
}

/** Save a block subtree (extracted from a tree) where the subtree is valid. */
export async function saveSubtreeAsMyBlock(
  adapter: MyBlocksStorageAdapter,
  tree: BlockTree,
  options?: {
    name?: string;
    description?: string;
    category?: MyBlockCategory;
    tags?: string[];
    existingNames?: ReadonlyArray<string>;
  },
): Promise<MyBlockResult<MyBlockRecord>> {
  return saveTreeAsMyBlock(adapter, {
    tree,
    name: options?.name,
    description: options?.description,
    category: options?.category,
    tags: options?.tags,
    sourceMetadata: { source: "created" },
  }, options?.existingNames ?? []);
}
