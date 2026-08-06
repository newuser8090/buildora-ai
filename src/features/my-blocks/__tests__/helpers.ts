// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — shared test helpers
//
// Deterministic factories for records/trees/projects and an in-memory
// MyBlocksStorageAdapter used by unit + component tests (never touches
// IndexedDB, never touches the browser singleton).
// ---------------------------------------------------------------------------

import type { BlockNode, BlockTree } from "@/features/blocks/types";
import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type {
  CreateMyBlockCollectionInput,
  CreateMyBlockInput,
  MyBlockCollection,
  MyBlockRecord,
  MyBlockResult,
  MyBlocksStorageAdapter,
  UpdateMyBlockCollectionPatch,
  UpdateMyBlockPatch,
} from "../types";
import {
  generateUniqueCollectionName,
  parseMyBlockCollection,
  parseMyBlockRecord,
  sanitizeMyBlockCollectionDescription,
  sanitizeMyBlockCollectionIds,
  sanitizeMyBlockCollectionName,
  sanitizeMyBlockDescription,
  sanitizeMyBlockName,
  sanitizeMyBlockTags,
  MY_BLOCK_MAX_COLLECTIONS,
} from "../schemas/my-block-schema";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let nodeCounter = 0;

export function makeNode(id: string, overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
    type: "container",
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

/** A small valid tree: container root + heading + paragraph. */
export function makeTree(overrides?: Partial<BlockTree>): BlockTree {
  const rootId = `root-${++nodeCounter}`;
  const headId = `${rootId}-head`;
  const textId = `${rootId}-text`;
  return {
    rootIds: [rootId],
    nodes: {
      [rootId]: makeNode(rootId, { props: { name: "Pricing section" }, children: [headId, textId] }),
      [headId]: makeNode(headId, { type: "heading", parentId: rootId, props: { text: "Simple pricing" } }),
      [textId]: makeNode(textId, { type: "paragraph", parentId: rootId, props: { text: "Pick a plan" } }),
    },
    ...overrides,
  };
}

let recordCounter = 0;

export function makeRecord(overrides?: Partial<MyBlockRecord>): MyBlockRecord {
  recordCounter += 1;
  const now = "2026-08-01T00:00:00.000Z";
  const tree = makeTree();
  return {
    id: `myblock-test-${recordCounter}`,
    version: 1,
    name: "Test block",
    description: "A reusable design",
    category: "layout",
    tags: ["pricing", "card"],
    tree,
    createdAt: now,
    updatedAt: now,
    sourceMetadata: { source: "created" },
    previewMetadata: {
      blockCount: 3,
      rootType: "container",
      containsMedia: false,
      containsInteractive: false,
    },
    useCount: 0,
    ...overrides,
  };
}

/** Build a persistent custom-block section whose props carry a tree. */
export function makeSectionRecord(name: string, tree: BlockTree): BaseSection {
  return {
    id: `sec-${name.replace(/\s+/g, "-").toLowerCase()}`,
    type: "custom-block",
    order: 1,
    visible: true,
    props: { name, tree: JSON.parse(JSON.stringify(tree)) },
    styles: {},
  };
}

export function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-myblocks",
    name: "My Blocks test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Build anything", primaryCta: { text: "Go", href: "/start" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory MyBlocksStorageAdapter. Mirrors the real adapter's
 * contract: schema validation on read, deterministic ordering, fresh ids and
 * timestamps on create, duplicate-safe names, and no input mutation. Kept
 * intentionally small — the real adapter's IndexedDB behavior is covered by
 * the storage adapter tests with fake-indexeddb.
 */
export class InMemoryMyBlocksAdapter implements MyBlocksStorageAdapter {
  private records = new Map<string, MyBlockRecord>();
  private collections = new Map<string, MyBlockCollection>();
  private clock: () => Date;
  private idCounter = 0;

  constructor(options?: { clock?: () => Date }) {
    this.clock = options?.clock ?? (() => new Date());
  }

  async listMyBlocks(): Promise<MyBlockResult<MyBlockRecord[]>> {
    const blocks: MyBlockRecord[] = [];
    for (const raw of this.records.values()) {
      const parsed = parseMyBlockRecord(raw);
      if (!parsed || parsed.tree.rootIds.length === 0) continue;
      blocks.push(parsed as MyBlockRecord);
    }
    blocks.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
    return { ok: true, value: blocks };
  }

  async getMyBlock(id: string): Promise<MyBlockResult<MyBlockRecord>> {
    const raw = this.records.get(id);
    if (raw === undefined) {
      return { ok: false, error: { code: "BLOCK_NOT_FOUND", message: "That saved block no longer exists." } };
    }
    const parsed = parseMyBlockRecord(raw);
    if (!parsed || parsed.tree.rootIds.length === 0) {
      return { ok: false, error: { code: "INVALID_RECORD", message: "That saved block is damaged and cannot be used." } };
    }
    return { ok: true, value: parsed as MyBlockRecord };
  }

  async createMyBlock(input: CreateMyBlockInput): Promise<MyBlockResult<MyBlockRecord>> {
    const now = this.clock().toISOString();
    this.idCounter += 1;
    const record: MyBlockRecord = {
      id: input.idFactory ? input.idFactory() : `mem-${Date.now().toString(36)}-${this.idCounter}`,
      version: 1,
      contentRevision: 1,
      name: sanitizeMyBlockName(input.name) ?? "Saved block",
      ...(sanitizeMyBlockDescription(input.description) !== undefined
        ? { description: sanitizeMyBlockDescription(input.description) }
        : {}),
      category: input.category,
      tags: sanitizeMyBlockTags(input.tags),
      tree: JSON.parse(JSON.stringify(input.tree)) as BlockTree,
      createdAt: now,
      updatedAt: now,
      ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
      previewMetadata: {
        blockCount: Object.keys(input.tree.nodes).length,
        rootType: input.tree.rootIds[0] ? input.tree.nodes[input.tree.rootIds[0]].type : "container",
        containsMedia: Object.values(input.tree.nodes).some((n) => n.type === "image" || n.type === "video"),
        containsInteractive: Object.values(input.tree.nodes).some(
          (n) => n.type === "form" || n.type === "input" || n.type === "textarea",
        ),
      },
      useCount: 0,
    };
    const parsed = parseMyBlockRecord(record);
    if (!parsed) return { ok: false, error: { code: "INVALID_RECORD", message: "The record failed validation." } };
    this.records.set(parsed.id, parsed as MyBlockRecord);
    return { ok: true, value: parsed as MyBlockRecord };
  }

  async updateMyBlock(id: string, patch: UpdateMyBlockPatch): Promise<MyBlockResult<MyBlockRecord>> {
    const current = await this.getMyBlock(id);
    if (!current.ok) return current;
    const next: MyBlockRecord = {
      ...current.value,
      name: patch.name !== undefined ? (sanitizeMyBlockName(patch.name) ?? current.value.name) : current.value.name,
      description:
        patch.description !== undefined
          ? (sanitizeMyBlockDescription(patch.description) ?? undefined)
          : current.value.description,
      category: patch.category ?? current.value.category,
      tags: patch.tags !== undefined ? sanitizeMyBlockTags(patch.tags) : current.value.tags,
      updatedAt: this.clock().toISOString(),
    };
    if (patch.lastUsedAt !== undefined) next.lastUsedAt = patch.lastUsedAt;
    if (patch.useCount !== undefined) next.useCount = patch.useCount;
    if (patch.favorite !== undefined) next.favorite = patch.favorite;
    if (patch.collectionIds !== undefined) {
      next.collectionIds = sanitizeMyBlockCollectionIds(patch.collectionIds);
    }
    if (patch.thumbnail !== undefined) next.thumbnail = patch.thumbnail ?? undefined;
    if (patch.contentRevision !== undefined) next.contentRevision = patch.contentRevision;
    const parsed = parseMyBlockRecord(next);
    if (!parsed) return { ok: false, error: { code: "INVALID_RECORD", message: "The updated saved block failed validation." } };
    this.records.set(parsed.id, parsed as MyBlockRecord);
    return { ok: true, value: parsed as MyBlockRecord };
  }

  async deleteMyBlock(id: string): Promise<MyBlockResult<{ id: string }>> {
    this.records.delete(id);
    return { ok: true, value: { id } };
  }

  async duplicateMyBlock(id: string): Promise<MyBlockResult<MyBlockRecord>> {
    const current = await this.getMyBlock(id);
    if (!current.ok) return current;
    const now = this.clock().toISOString();
    this.idCounter += 1;
    const record: MyBlockRecord = {
      ...JSON.parse(JSON.stringify(current.value)),
      id: `mem-dup-${Date.now().toString(36)}-${this.idCounter}`,
      name: `${current.value.name} 2`,
      createdAt: now,
      updatedAt: now,
      sourceMetadata: { source: "duplicated" },
      lastUsedAt: undefined,
      useCount: 0,
      contentRevision: 1,
      thumbnail: undefined,
      favorite: undefined,
      collectionIds: undefined,
    };
    const parsed = parseMyBlockRecord(record);
    if (!parsed) return { ok: false, error: { code: "INVALID_RECORD", message: "The duplicated saved block failed validation." } };
    this.records.set(parsed.id, parsed as MyBlockRecord);
    return { ok: true, value: parsed as MyBlockRecord };
  }

  async clearMyBlocksForTests(): Promise<void> {
    this.records.clear();
    this.collections.clear();
  }

  /** Direct-access hook for corrupt-record isolation tests. */
  putRawForTests(record: unknown): void {
    this.records.set((record as { id: string }).id, record as MyBlockRecord);
  }

  // ---------------------------------------------------------------------------
  // Collections (Phase P5) — mirrors the real adapter's contract
  // ---------------------------------------------------------------------------

  async listMyBlockCollections(): Promise<MyBlockResult<MyBlockCollection[]>> {
    const collections: MyBlockCollection[] = [];
    for (const raw of this.collections.values()) {
      const parsed = parseMyBlockCollection(raw);
      if (!parsed) continue;
      collections.push(parsed as MyBlockCollection);
    }
    collections.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    return { ok: true, value: collections };
  }

  async getMyBlockCollection(id: string): Promise<MyBlockResult<MyBlockCollection>> {
    const raw = this.collections.get(id);
    if (raw === undefined) {
      return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
    }
    const parsed = parseMyBlockCollection(raw);
    if (!parsed) {
      return { ok: false, error: { code: "INVALID_RECORD", message: "That collection is damaged and cannot be used." } };
    }
    return { ok: true, value: parsed as MyBlockCollection };
  }

  async createMyBlockCollection(input: CreateMyBlockCollectionInput): Promise<MyBlockResult<MyBlockCollection>> {
    const siblings = await this.listMyBlockCollections();
    if (!siblings.ok) return siblings;
    if (siblings.value.length >= MY_BLOCK_MAX_COLLECTIONS) {
      return { ok: false, error: { code: "QUOTA_EXCEEDED", message: "Too many collections." } };
    }
    const now = this.clock().toISOString();
    this.idCounter += 1;
    const maxOrder = siblings.value.reduce((max, c) => Math.max(max, c.sortOrder), -1);
    const collection: MyBlockCollection = {
      id: input.idFactory ? input.idFactory() : `mem-col-${Date.now().toString(36)}-${this.idCounter}`,
      version: 1,
      name: generateUniqueCollectionName(input.name, siblings.value.map((c) => c.name)),
      ...(sanitizeMyBlockCollectionDescription(input.description) !== undefined
        ? { description: sanitizeMyBlockCollectionDescription(input.description) }
        : {}),
      createdAt: now,
      updatedAt: now,
      sortOrder: maxOrder + 1,
    };
    const parsed = parseMyBlockCollection(collection);
    if (!parsed) return { ok: false, error: { code: "INVALID_RECORD", message: "The collection failed validation." } };
    this.collections.set(parsed.id, parsed as MyBlockCollection);
    return { ok: true, value: parsed as MyBlockCollection };
  }

  async updateMyBlockCollection(id: string, patch: UpdateMyBlockCollectionPatch): Promise<MyBlockResult<MyBlockCollection>> {
    const current = await this.getMyBlockCollection(id);
    if (!current.ok) return current;
    let name = current.value.name;
    if (patch.name !== undefined) {
      const sanitized = sanitizeMyBlockCollectionName(patch.name);
      if (!sanitized) return { ok: false, error: { code: "INVALID_NAME", message: "Collection names cannot be empty." } };
      const siblings = await this.listMyBlockCollections();
      const others = siblings.ok
        ? siblings.value.filter((c) => c.id !== id).map((c) => c.name)
        : [];
      name = generateUniqueCollectionName(sanitized, others);
    }
    const next: MyBlockCollection = {
      ...current.value,
      name,
      description:
        patch.description !== undefined
          ? (sanitizeMyBlockCollectionDescription(patch.description) ?? undefined)
          : current.value.description,
      sortOrder:
        patch.sortOrder !== undefined ? Math.max(0, Math.floor(patch.sortOrder)) : current.value.sortOrder,
      updatedAt: this.clock().toISOString(),
    };
    const parsed = parseMyBlockCollection(next);
    if (!parsed) return { ok: false, error: { code: "INVALID_RECORD", message: "The updated collection failed validation." } };
    this.collections.set(parsed.id, parsed as MyBlockCollection);
    return { ok: true, value: parsed as MyBlockCollection };
  }

  async deleteMyBlockCollection(id: string): Promise<MyBlockResult<{ id: string }>> {
    this.collections.delete(id);
    // Blocks are never deleted — only membership is cleaned.
    for (const [bid, block] of this.records) {
      if (block.collectionIds && block.collectionIds.includes(id)) {
        this.records.set(bid, {
          ...block,
          collectionIds: block.collectionIds.filter((cid) => cid !== id),
        });
      }
    }
    return { ok: true, value: { id } };
  }

  /** Direct-access hook for corrupt-collection isolation tests. */
  putRawCollectionForTests(record: unknown): void {
    this.collections.set((record as { id: string }).id, record as MyBlockCollection);
  }
}
