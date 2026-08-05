// ---------------------------------------------------------------------------
// Universal Block Import (Phase P3) — canonical insertion operation
//
// insertImportedBlockTree() is the ONE way imported BlockTrees become
// persistent sections. It:
//   - validates project / page / placement
//   - re-IDs every imported node (converter preview ids are never reused)
//   - preserves internal parent/child relationships
//   - enforces nesting rules (Phase O engine)
//   - validates the final section through the custom-block schema
//   - commits as ONE history entry + one revision + one autosave sequence
//   - selects the inserted section
//   - leaves the project untouched on any failure (failed insertion = no-op)
//
// Placements:
//   new-section          → a new custom-block section (start/before/after/end)
//   inside-custom-block  → subtree inside an existing custom-block section
//   new-page             → a new page with the imported section appended
//
// Pure builders are exported separately so tests never need the store.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { BlockTree, BlockResult } from "@/features/blocks/types";
import { canNest, validateTree } from "@/features/blocks/engine/nesting-rules";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import { validateSectionSafe } from "@/features/editor/schemas/section-schemas";
import {
  buildPage,
  createPageId,
  resolveUniqueSlug,
} from "@/features/editor/store/page-structure";
import { createSectionId } from "@/features/editor/section-library/services/section-factory";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  CUSTOM_BLOCK_SECTION_TYPE,
  CustomBlockSectionPropsSchema,
  type CustomBlockSourceMetadata,
} from "../schemas/custom-block-schema";
import {
  collectBlockTreeIds,
  collectPageSectionIds,
  remapBlockTreeIds,
  type RemapOptions,
} from "./id-remapper";

// ---------------------------------------------------------------------------
// Placement model
// ---------------------------------------------------------------------------

export type ImportPlacementKind =
  | "new-section"
  | "inside-custom-block"
  | "before-section"
  | "after-section"
  | "end-of-page"
  | "new-page";

export interface ImportPlacement {
  kind: ImportPlacementKind;
  pageId: string;
  /** Target section for before/after/inside placements. */
  sectionId?: string;
  /** Target parent block inside a custom-block section (inside placement). */
  parentBlockId?: string;
}

export interface InsertImportedBlockTreeRequest {
  projectId: string;
  placement: ImportPlacement;
  tree: BlockTree;
  name: string;
  sourceMetadata?: CustomBlockSourceMetadata;
  /** Injectable id factory (deterministic tests). */
  idFactory?: RemapOptions["idFactory"];
}

export type InsertImportedBlockTreeResult =
  | { ok: true; sectionId: string; pageId: string; kind: ImportPlacementKind }
  | { ok: false; error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

/** Build a validated custom-block section from a remapped tree. */
export function buildCustomBlockSection(input: {
  tree: BlockTree;
  name: string;
  sectionId: string;
  sourceMetadata?: CustomBlockSourceMetadata;
}): BlockResult<BaseSection> {
  const propsValidation = CustomBlockSectionPropsSchema.safeParse({
    name: input.name,
    tree: input.tree,
    ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
  });
  if (!propsValidation.success) {
    const message = propsValidation.error.issues
      .map((issue) => issue.path.join(".") + ": " + issue.message)
      .join("; ");
    return { ok: false, error: { code: "INVALID_TREE", message } };
  }

  const section: BaseSection = {
    id: input.sectionId,
    type: CUSTOM_BLOCK_SECTION_TYPE,
    order: 0,
    visible: true,
    props: propsValidation.data,
    styles: {},
  };

  const validation = validateSectionSafe(section);
  if (!validation.success) {
    const message = validation.error.issues
      .map((issue) => issue.path.join(".") + ": " + issue.message)
      .join("; ");
    return { ok: false, error: { code: "INVALID_TREE", message } };
  }
  return { ok: true, value: section };
}

/**
 * Remap a converted tree for a NEW custom-block section. The root is forced
 * to the fresh section id; every other node gets a fresh id.
 */
export function prepareSectionTree(input: {
  tree: BlockTree;
  sectionId: string;
  existingIds: ReadonlySet<string> | ReadonlyArray<string>;
  idFactory?: RemapOptions["idFactory"];
}): BlockResult<BlockTree> {
  const remapped = remapBlockTreeIds(input.tree, {
    idFactory: input.idFactory,
    avoid: input.existingIds,
    forceRootId: input.sectionId,
  });
  // The root must exist and be a single root.
  if (remapped.tree.rootIds[0] !== input.sectionId) {
    return {
      ok: false,
      error: { code: "INVALID_TREE", message: "The imported tree has no usable root." },
    };
  }
  return { ok: true, value: remapped.tree };
}

/**
 * Remap a converted tree for a SUBTREE insert inside an existing custom-block
 * section. Every node (including the root) receives a fresh id.
 */
export function prepareSubtreeTree(input: {
  tree: BlockTree;
  existingIds: ReadonlySet<string> | ReadonlyArray<string>;
  idFactory?: RemapOptions["idFactory"];
}): BlockResult<BlockTree> {
  const remapped = remapBlockTreeIds(input.tree, {
    idFactory: input.idFactory,
    avoid: input.existingIds,
  });
  if (remapped.tree.rootIds.length === 0) {
    return { ok: false, error: { code: "INVALID_TREE", message: "The imported tree has no root." } };
  }
  return { ok: true, value: remapped.tree };
}

// ---------------------------------------------------------------------------
// Placement compatibility (used by the UI to disable invalid targets)
// ---------------------------------------------------------------------------

export interface PlacementCompatibility {
  ok: boolean;
  reason?: string;
}

/**
 * Can the imported tree be inserted inside the given parent block of the
 * given section? Only custom-block sections can host free-form subtrees.
 */
export function canPlaceInside(
  project: Project,
  pageId: string,
  sectionId: string,
  parentBlockId: string | undefined,
  importedTree: BlockTree,
): PlacementCompatibility {
  const page = project.pages.find((p) => p.id === pageId);
  if (!page) return { ok: false, reason: "That page no longer exists." };
  const section = page.sections.find((s) => s.id === sectionId);
  if (!section) return { ok: false, reason: "That part of the page no longer exists." };
  if (section.type !== CUSTOM_BLOCK_SECTION_TYPE) {
    return {
      ok: false,
      reason: "This part uses a built-in layout, so imported blocks cannot be added inside it yet.",
    };
  }
  if (!parentBlockId) {
    return { ok: false, reason: "Choose a container inside the imported design to add into." };
  }
  const tree = customBlockTreeFromSection(section);
  const parent = tree.nodes[parentBlockId];
  if (!parent) return { ok: false, reason: "That container no longer exists." };
  // The root type comes from the IMPORTED tree's node map, never the target
  // tree (whose ids do not include the converted preview ids).
  const importedRootId = importedTree.rootIds[0];
  const importedRootType = importedRootId ? importedTree.nodes[importedRootId]?.type : undefined;
  if (importedRootType && !canNest(parent.type, importedRootType)) {
    return { ok: false, reason: "That container cannot hold this design's top block." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Store-backed insertion — the canonical operation
// ---------------------------------------------------------------------------

/**
 * Insert an imported BlockTree into the project. On success the section is
 * selected, the Blocks tab opens, and the inserted content scrolls into view.
 * Any failure leaves the project untouched.
 */
export function insertImportedBlockTree(
  request: InsertImportedBlockTreeRequest,
): InsertImportedBlockTreeResult {
  const store = useEditorStore.getState();
  const { project } = store;

  // 1. Project identity.
  if (project.id !== request.projectId) {
    return { ok: false, error: { code: "PROJECT_MISMATCH", message: "This project changed. Try again." } };
  }
  if (!project.pages.some((p) => p.id === request.placement.pageId)) {
    return { ok: false, error: { code: "PAGE_NOT_FOUND", message: "That page no longer exists." } };
  }

  // 2. Route to the placement implementation.
  switch (request.placement.kind) {
    case "new-page":
      return insertNewPage(request);
    case "inside-custom-block":
      return insertInsideCustomBlock(request);
    case "new-section":
    case "before-section":
    case "after-section":
    case "end-of-page":
      return insertAsSection(request);
    default:
      return { ok: false, error: { code: "INVALID_PLACEMENT", message: "Unknown placement." } };
  }
}

// ---------------------------------------------------------------------------
// Insert as a new section (start / before / after / end)
// ---------------------------------------------------------------------------

function insertAsSection(
  request: InsertImportedBlockTreeRequest,
): InsertImportedBlockTreeResult {
  const store = useEditorStore.getState();
  const page = store.project.pages.find((p) => p.id === request.placement.pageId);
  if (!page) return { ok: false, error: { code: "PAGE_NOT_FOUND", message: "That page no longer exists." } };

  const sectionId = createSectionId("custom-block");
  const prepared = prepareSectionTree({
    tree: request.tree,
    sectionId,
    existingIds: collectPageSectionIds(page.sections),
    idFactory: request.idFactory,
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const built = buildCustomBlockSection({
    tree: prepared.value,
    name: request.name,
    sectionId,
    sourceMetadata: request.sourceMetadata,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const position = sectionInsertPosition(request.placement);
  const result = store.insertSection(page.id, built.value, position);
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } };
  }

  // Selection + Blocks tab handled by the hook (needs post-insert state).
  return { ok: true, sectionId, pageId: page.id, kind: request.placement.kind };
}

function sectionInsertPosition(placement: ImportPlacement) {
  switch (placement.kind) {
    case "new-section":
      return { type: "end" as const };
    case "before-section":
      return { type: "before" as const, sectionId: placement.sectionId ?? "" };
    case "after-section":
      return { type: "after" as const, sectionId: placement.sectionId ?? "" };
    default:
      return { type: "end" as const };
  }
}

// ---------------------------------------------------------------------------
// Insert inside an existing custom-block section
// ---------------------------------------------------------------------------

function insertInsideCustomBlock(
  request: InsertImportedBlockTreeRequest,
): InsertImportedBlockTreeResult {
  const store = useEditorStore.getState();
  const { placement } = request;
  const page = store.project.pages.find((p) => p.id === placement.pageId);
  if (!page) return { ok: false, error: { code: "PAGE_NOT_FOUND", message: "That page no longer exists." } };
  const section = page.sections.find((s) => s.id === placement.sectionId);
  if (!section) return { ok: false, error: { code: "SECTION_NOT_FOUND", message: "That part no longer exists." } };
  if (section.type !== CUSTOM_BLOCK_SECTION_TYPE) {
    return {
      ok: false,
      error: {
        code: "INVALID_TARGET",
        message: "Imported blocks can only be added inside an imported design.",
      },
    };
  }

  const parentBlockId = placement.parentBlockId ?? section.id;
  const currentTree = customBlockTreeFromSection(section);
  const parent = currentTree.nodes[parentBlockId];
  if (!parent) {
    return { ok: false, error: { code: "TARGET_NOT_FOUND", message: "That container no longer exists." } };
  }

  // Compatibility (nesting rules).
  const compat = canPlaceInside(store.project, placement.pageId, section.id, parentBlockId, request.tree);
  if (!compat.ok) {
    return { ok: false, error: { code: "NESTING_RULE_VIOLATION", message: compat.reason ?? "Cannot insert there." } };
  }

  const prepared = prepareSubtreeTree({
    tree: request.tree,
    existingIds: [...collectPageSectionIds(page.sections), ...collectBlockTreeIds(currentTree)],
    idFactory: request.idFactory,
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  // Merge the WHOLE subtree (root + every descendant) under the parent in one
  // step — a per-node insert would leave dangling child references.
  const merged = mergeSubtreeTree(currentTree, parentBlockId, prepared.value);
  if (!merged.ok) {
    return { ok: false, error: { code: merged.error.code, message: merged.error.message } };
  }

  const committed = store.commitBlockTree(page.id, section.id, merged.value);
  if (!committed.ok) {
    return { ok: false, error: { code: committed.error.code, message: committed.error.message } };
  }

  return { ok: true, sectionId: section.id, pageId: page.id, kind: placement.kind };
}

/**
 * Merge a whole imported subtree under a target parent in one step.
 *
 * - deep-clones the target tree (never mutates it)
 * - adds every subtree node (root + descendants) to the node map
 * - reparents each subtree root under the parent
 * - validates the merged tree with the Phase O engine before returning
 *   (nesting rules + tree invariants)
 */
function mergeSubtreeTree(
  tree: BlockTree,
  parentBlockId: string,
  subtree: BlockTree,
): BlockResult<BlockTree> {
  const next = JSON.parse(JSON.stringify(tree)) as BlockTree;
  const parent = next.nodes[parentBlockId];
  if (!parent) {
    return {
      ok: false,
      error: { code: "TARGET_NOT_FOUND", message: "That container no longer exists." },
    };
  }

  for (const [id, node] of Object.entries(subtree.nodes)) {
    if (next.nodes[id]) {
      return {
        ok: false,
        error: { code: "BLOCK_ID_CONFLICT", message: `Block id "${id}" already exists.` },
      };
    }
    next.nodes[id] = node;
  }
  for (const rootId of subtree.rootIds) {
    next.nodes[rootId] = { ...next.nodes[rootId], parentId: parentBlockId };
    parent.children.push(rootId);
  }

  const validation = validateTree(next);
  if (!validation.valid) {
    const problem = validation.problems[0];
    return {
      ok: false,
      error: {
        code: "NESTING_RULE_VIOLATION",
        message: problem?.message ?? "The imported design cannot be placed there.",
      },
    };
  }
  return { ok: true, value: next };
}

// ---------------------------------------------------------------------------
// New page placement — ONE history entry for page + section
// ---------------------------------------------------------------------------

function insertNewPage(request: InsertImportedBlockTreeRequest): InsertImportedBlockTreeResult {
  const store = useEditorStore.getState();
  const project = store.project;

  const sectionId = createSectionId("custom-block");
  const prepared = prepareSectionTree({
    tree: request.tree,
    sectionId,
    existingIds: [],
    idFactory: request.idFactory,
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const built = buildCustomBlockSection({
    tree: prepared.value,
    name: request.name,
    sectionId,
    sourceMetadata: request.sourceMetadata,
  });
  if (!built.ok) return { ok: false, error: built.error };

  const pageId = createPageId();
  const page = buildPage({
    pageId,
    sectionId: built.value.id,
    title: request.name,
    slug: resolveUniqueSlug(project.pages, request.name),
  });
  page.sections = [
    {
      ...built.value,
      order: 1,
    },
  ];

  // One atomic history entry: add the page (with its imported section) in a
  // single project replacement. The persistence controller's normal store
  // subscription handles the single revision + autosave sequence.
  const updatedProject: Project = JSON.parse(JSON.stringify(project));
  updatedProject.pages = [...updatedProject.pages, page];
  updatedProject.updatedAt = new Date().toISOString();
  store.setProject(updatedProject);
  store.selectPage(pageId);
  store.selectSection(sectionId);

  return { ok: true, sectionId, pageId, kind: "new-page" };
}

// ---------------------------------------------------------------------------
// Error code list for the UI
// ---------------------------------------------------------------------------

export const INSERT_ERROR_CODES = new Set([
  "PROJECT_MISMATCH",
  "PAGE_NOT_FOUND",
  "SECTION_NOT_FOUND",
  "INVALID_TARGET",
  "TARGET_NOT_FOUND",
  "NESTING_RULE_VIOLATION",
  "INVALID_TREE",
  "INVALID_PLACEMENT",
  "BLOCK_ID_CONFLICT",
]);
