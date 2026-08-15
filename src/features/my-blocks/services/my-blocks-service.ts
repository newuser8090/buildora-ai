// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — service layer
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import { CustomBlockTreeSchema, normalizeCustomBlockTree } from "@/features/code-import/schemas/custom-block-schema";
import { stripCustomCodeFromTree } from "@/features/code-import/services/strip-custom-code";
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
import { generateUniqueName, sanitizeMyBlockDescription, sanitizeMyBlockName, sanitizeMyBlockTags } from "../schemas/my-block-schema";
import { makeMyBlockError } from "../errors";

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

export function cloneTreeDeep(tree: BlockTree): BlockTree {
  const nodes: Record<string, BlockNode> = {};
  for (const [id, node] of Object.entries(tree.nodes)) {
    nodes[id] = JSON.parse(JSON.stringify(node)) as BlockNode;
  }
  return { rootIds: [...tree.rootIds], nodes };
}

export function prepareTreeForStorage(tree: BlockTree): MyBlockResult<BlockTree> {
  // P23-E: My Blocks are reusable/distributed artifacts, not executable-code
  // containers. Strip customCode before normalization so it cannot survive
  // into the library record even when a source tree has enabled code.
  const cloned = cloneTreeDeep(tree);
  const withoutCustomCode = stripCustomCodeFromTree(cloned);
  const stripped = stripInternalProps(withoutCustomCode);
  const normalized = normalizeCustomBlockTree(stripped);
  if (!normalized) {
    return { ok: false, error: makeMyBlockError("INVALID_RECORD", "This design has no usable blocks to save.") };
  }
  const validation = CustomBlockTreeSchema.safeParse(normalized);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return {
      ok: false,
      error: makeMyBlockError("INVALID_RECORD", issue ? `This design cannot be saved: ${issue.message}` : "This design cannot be saved."),
    };
  }
  return { ok: true, value: normalized as BlockTree };
}

export function computePreviewMetadata(tree: BlockTree): MyBlockPreviewMetadata {
  const nodes = Object.values(tree.nodes);
  return {
    blockCount: nodes.length,
    rootType: tree.rootIds[0] ? (tree.nodes[tree.rootIds[0]]?.type ?? "container") : "container",
    containsMedia: nodes.some((n) => n.type === "image" || n.type === "video"),
    containsInteractive: nodes.some((n) => n.type === "form" || n.type === "input" || n.type === "textarea" || n.type === "checkbox" || n.type === "tabs" || n.type === "accordion"),
  };
}

const TYPE_CATEGORY_MAP: Partial<Record<BlockNode["type"], MyBlockCategory>> = {
  container: "layout", row: "layout", column: "layout", grid: "layout", stack: "layout", divider: "layout", spacer: "layout",
  heading: "text", paragraph: "text", badge: "text", button: "buttons", image: "media", video: "media", icon: "media",
  form: "forms", input: "forms", textarea: "forms", checkbox: "forms", tabs: "forms", accordion: "forms", card: "cards",
  "pricing-card": "cards", "feature-card": "cards", "review-card": "cards", "faq-item": "cards", "team-member": "cards",
  navbar: "navigation", footer: "navigation", menu: "navigation",
};
const TAG_BY_TYPE: Record<string, string> = {
  navbar: "navigation", menu: "links", footer: "footer", heading: "heading", paragraph: "text", button: "button", image: "image", video: "video",
  "pricing-card": "pricing", "review-card": "reviews", "faq-item": "faq", form: "form", input: "form", "feature-card": "features", "team-member": "team", card: "card", icon: "icon",
};

export function deriveCategory(tree: BlockTree): MyBlockCategory {
  const nodes = Object.values(tree.nodes);
  if (nodes.length === 0) return "other";
  const rootId = tree.rootIds[0];
  const rootType = rootId ? tree.nodes[rootId]?.type : undefined;
  const GENERIC_LAYOUT_TYPES: ReadonlySet<string> = new Set(["container", "row", "column", "grid", "stack", "divider", "spacer"]);
  if (rootType && !GENERIC_LAYOUT_TYPES.has(rootType)) {
    const rootCategory = TYPE_CATEGORY_MAP[rootType];
    if (rootCategory) return rootCategory as MyBlockCategory;
  }
  const counts = new Map<MyBlockCategory, number>();
  for (const node of nodes) {
    if (node.id === rootId) continue;
    const cat = TYPE_CATEGORY_MAP[node.type];
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  let best: MyBlockCategory = "other";
  let bestCount = 0;
  for (const [cat, count] of counts) if (count > bestCount) { best = cat; bestCount = count; }
  if (counts.size >= 3 && nodes.length >= 6) return "complete-section";
  return bestCount > 0 ? best : "other";
}

export function deriveTags(tree: BlockTree): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const node of Object.values(tree.nodes)) {
    const tag = TAG_BY_TYPE[node.type];
    if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
    if (out.length >= 5) break;
  }
  return out;
}

export function suggestNameFromTree(tree: BlockTree, fallback = "Saved block"): string {
  const rootId = tree.rootIds[0];
  if (!rootId) return fallback;
  const name = tree.nodes[rootId]?.props?.name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim().slice(0, 80) : fallback;
}

export interface SaveFromTreeInput { tree: BlockTree; name?: string; description?: string; category?: MyBlockCategory; tags?: string[]; sourceMetadata?: MyBlockSourceMetadata; }

export async function saveTreeAsMyBlock(adapter: MyBlocksStorageAdapter, input: SaveFromTreeInput, existingNames: ReadonlyArray<string> = []): Promise<MyBlockResult<MyBlockRecord>> {
  const prepared = prepareTreeForStorage(input.tree);
  if (!prepared.ok) return prepared;
  const tree = prepared.value;
  const baseName = sanitizeMyBlockName(input.name) ?? suggestNameFromTree(tree, "Saved block");
  const name = generateUniqueName(baseName, existingNames);
  const createInput: CreateMyBlockInput = {
    name,
    ...(sanitizeMyBlockDescription(input.description) !== undefined ? { description: sanitizeMyBlockDescription(input.description) } : {}),
    category: input.category && isMyBlockCategory(input.category) ? input.category : deriveCategory(tree),
    tags: input.tags && input.tags.length > 0 ? sanitizeMyBlockTags(input.tags) : deriveTags(tree),
    tree,
    ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
  };
  return adapter.createMyBlock(createInput);
}

export async function saveSectionAsMyBlock(adapter: MyBlocksStorageAdapter, section: Parameters<typeof customBlockTreeFromSection>[0], options?: { name?: string; description?: string; category?: MyBlockCategory; tags?: string[]; existingNames?: ReadonlyArray<string>; }): Promise<MyBlockResult<MyBlockRecord>> {
  const rawTree = (section.props as { tree?: unknown } | undefined)?.tree;
  const rawTreeUsable = !!rawTree && typeof rawTree === "object" && Array.isArray((rawTree as { rootIds?: unknown }).rootIds) && (rawTree as { rootIds: string[] }).rootIds.length > 0;
  if (!rawTreeUsable) return { ok: false, error: makeMyBlockError("INVALID_RECORD", "This design has no blocks to save.") };
  const tree = customBlockTreeFromSection(section);
  if (tree.rootIds.length === 0) return { ok: false, error: makeMyBlockError("INVALID_RECORD", "This design has no blocks to save.") };
  const props = section.props as Record<string, unknown> | undefined;
  const rawName = props?.name;
  const fallbackName = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim() : "Imported design";
  const rawMeta = props?.sourceMetadata;
  const meta = rawMeta && typeof rawMeta === "object" ? (rawMeta as Record<string, unknown>) : undefined;
  return saveTreeAsMyBlock(adapter, {
    tree,
    name: options?.name ?? fallbackName,
    description: options?.description,
    category: options?.category,
    tags: options?.tags,
    sourceMetadata: {
      source: "created",
      ...(meta ? { language: typeof meta.language === "string" ? (meta.language as MyBlockSourceMetadata["language"]) : undefined, originalWarningCount: typeof meta.warningCount === "number" ? meta.warningCount : undefined, converterVersion: typeof meta.converterVersion === "number" ? meta.converterVersion : undefined } : {}),
    },
  }, options?.existingNames ?? []);
}

export async function saveSubtreeAsMyBlock(adapter: MyBlocksStorageAdapter, tree: BlockTree, options?: { name?: string; description?: string; category?: MyBlockCategory; tags?: string[]; existingNames?: ReadonlyArray<string>; }): Promise<MyBlockResult<MyBlockRecord>> {
  return saveTreeAsMyBlock(adapter, { tree, name: options?.name, description: options?.description, category: options?.category, tags: options?.tags, sourceMetadata: { source: "created" } }, options?.existingNames ?? []);
}
