// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — IndexedDB storage adapter tests
//
// Uses fake-indexeddb for isolated, deterministic database testing. Each test
// gets a unique database name to prevent state leakage.
//
//   - CRUD round trips + validation on every read
//   - corrupt records are skipped (never fatal to the library)
//   - individual record size cap → RECORD_TOO_LARGE
//   - total recommended library size → QUOTA_EXCEEDED (no silent data loss)
//   - duplicate creates an independent record with a fresh id
//   - schema validation on every write
//   - v2 → v3 migration preserves projects + thumbnails + metadata
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { MyBlocksIndexedDbAdapter, estimateLibraryBytes } from "../storage/my-blocks-storage-adapter";
import { IndexedDbProjectAdapter } from "@/features/persistence/adapters/indexed-db-adapter";
import { IndexedDbThumbnailAdapter } from "@/features/thumbnails/storage/thumbnail-storage-adapter";
import { STORE_MY_BLOCKS } from "@/features/persistence/constants";
import { makeNode, makeProject, makeRecord, makeTree } from "./helpers";
import type { BlockTree } from "@/features/blocks/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

function makeAdapter(options?: {
  dbName?: string;
  clock?: () => Date;
}) {
  dbCounter += 1;
  return new MyBlocksIndexedDbAdapter({
    dbName: options?.dbName ?? `myblocks-test-${dbCounter}`,
    dbVersion: 3,
    clock: options?.clock,
  });
}

function makeTreeWithText(nodeCount: number, textLength: number): BlockTree {
  // Respects the schema caps: ≤ 32 children per node, ≤ 24 depth, ≤ 400 nodes.
  // Leaves are grouped into branch containers (≤ 32 leaves each) so the root
  // itself never exceeds 32 children either — a leaf-per-root layout would
  // fail structural validation and be skipped on read.
  const nodes: Record<string, ReturnType<typeof makeNode>> = {};
  const rootId = "big-root";
  const text = "x".repeat(textLength);
  nodes[rootId] = makeNode(rootId, { children: [] });
  const branchCount = Math.max(1, Math.ceil(nodeCount / 32));
  const branchIds: string[] = [];
  for (let b = 0; b < branchCount; b++) {
    const branchId = `branch-${b}`;
    nodes[branchId] = makeNode(branchId, { parentId: rootId, children: [] });
    branchIds.push(branchId);
  }
  nodes[rootId].children = branchIds;
  let count = 0;
  while (count < nodeCount) {
    const branchId = `branch-${Math.floor(count / 32)}`;
    const id = `n-${count}`;
    nodes[id] = makeNode(id, {
      parentId: branchId,
      type: "paragraph",
      props: { text: `${id}:${text}` },
    });
    nodes[branchId].children.push(id);
    count += 1;
  }
  return { rootIds: [rootId], nodes };
}

/** Open a raw connection to the same database to inject corrupt records. */
async function openRawDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rawPut(db: IDBDatabase, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MY_BLOCKS, "readwrite");
    tx.objectStore(STORE_MY_BLOCKS).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("MyBlocksIndexedDbAdapter — create/list/get", () => {
  it("creates a record and lists it back", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlock({
      name: "Hero",
      description: "A hero section",
      category: "layout",
      tags: ["hero"],
      tree: makeTree(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const list = await adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0].id).toBe(created.value.id);
      expect(list.value[0].name).toBe("Hero");
      expect(list.value[0].useCount).toBe(0);
    }

    const got = await adapter.getMyBlock(created.value.id);
    expect(got.ok).toBe(true);
    adapter.close();
  });

  it("assigns fresh ids and timestamps on create", async () => {
    const clock = vi.fn(() => new Date("2026-08-01T00:00:00.000Z"));
    const adapter = makeAdapter({ clock });
    const a = await adapter.createMyBlock({ name: "A", category: "layout", tree: makeTree() });
    const b = await adapter.createMyBlock({ name: "B", category: "layout", tree: makeTree() });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.id).not.toBe(b.value.id);
      expect(a.value.createdAt).toBe("2026-08-01T00:00:00.000Z");
      expect(a.value.updatedAt).toBe("2026-08-01T00:00:00.000Z");
    }
    adapter.close();
  });

  it("lists in deterministic updatedAt-desc order with a stable tiebreak", async () => {
    const adapter = makeAdapter();
    const a = await adapter.createMyBlock({ name: "A", category: "layout", tree: makeTree() });
    const b = await adapter.createMyBlock({ name: "B", category: "layout", tree: makeTree() });
    if (!a.ok || !b.ok) return;
    // Both were created at the same clock instant — the id tiebreak decides.
    const first = await adapter.listMyBlocks();
    expect(first.ok).toBe(true);
    const second = await adapter.listMyBlocks();
    if (first.ok && second.ok) {
      expect(first.value.map((r) => r.id)).toEqual(second.value.map((r) => r.id));
      // Most recently updated first: touch B's metadata, then it must lead.
      await adapter.updateMyBlock(b.value.id, { description: "touched" });
      const after = await adapter.listMyBlocks();
      expect(after.ok).toBe(true);
      if (after.ok) expect(after.value[0].id).toBe(b.value.id);
    }
    adapter.close();
  });

  it("never mutates the input tree", async () => {
    const adapter = makeAdapter();
    const tree = makeTree();
    const before = JSON.stringify(tree);
    await adapter.createMyBlock({ name: "X", category: "layout", tree });
    expect(JSON.stringify(tree)).toBe(before);
    adapter.close();
  });

  it("returns BLOCK_NOT_FOUND for a missing id", async () => {
    const adapter = makeAdapter();
    const result = await adapter.getMyBlock("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BLOCK_NOT_FOUND");
    adapter.close();
  });

  it("create sanitizes name/description/tags", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlock({
      name: "  Hero  ",
      description: "  ",
      category: "layout",
      tags: ["Hero", "hero", "  Pricing "],
      tree: makeTree(),
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.name).toBe("Hero");
      expect(created.value.description).toBeUndefined();
      expect(created.value.tags).toEqual(["Hero", "Pricing"]);
    }
    adapter.close();
  });
});

describe("MyBlocksIndexedDbAdapter — update", () => {
  it("updates library metadata without touching the tree", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    const originalTree = JSON.stringify(created.value.tree);

    const updated = await adapter.updateMyBlock(created.value.id, {
      name: "New Hero",
      category: "complete-section",
      tags: ["updated"],
      useCount: 3,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.name).toBe("New Hero");
      expect(updated.value.category).toBe("complete-section");
      expect(updated.value.tags).toEqual(["updated"]);
      expect(updated.value.useCount).toBe(3);
      expect(JSON.stringify(updated.value.tree)).toBe(originalTree);
    }
    adapter.close();
  });

  it("rejects updates to a missing record", async () => {
    const adapter = makeAdapter();
    const result = await adapter.updateMyBlock("nope", { name: "X" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BLOCK_NOT_FOUND");
    adapter.close();
  });
});

describe("MyBlocksIndexedDbAdapter — delete", () => {
  it("deletes a record", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    const deleted = await adapter.deleteMyBlock(created.value.id);
    expect(deleted.ok).toBe(true);
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(0);
    adapter.close();
  });

  it("delete is idempotent for missing records", async () => {
    const adapter = makeAdapter();
    const result = await adapter.deleteMyBlock("nope");
    expect(result.ok).toBe(true);
    adapter.close();
  });
});

// ---------------------------------------------------------------------------
// Corrupt records
// ---------------------------------------------------------------------------

describe("corrupt record isolation", () => {
  it("skips corrupt records during list — the library never breaks", async () => {
    const dbName = `corrupt-${dbCounter++}`;
    const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });
    const created = await adapter.createMyBlock({ name: "Good", category: "layout", tree: makeTree() });
    if (!created.ok) return;

    // Inject a malformed record directly through a raw connection.
    const db = await openRawDb(dbName);
    await rawPut(db, { id: "corrupt-1", garbage: true });
    await rawPut(db, { id: "corrupt-2", version: 1, name: "Bad", tree: { rootIds: [], nodes: {} } });
    db.close();

    const list = await adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0].id).toBe(created.value.id);
    }
    adapter.close();
  });

  it("getMyBlock reports INVALID_RECORD for a corrupt record", async () => {
    const dbName = `corrupt-get-${dbCounter++}`;
    const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });
    // Create + then corrupt via raw connection.
    await adapter.createMyBlock({ name: "Good", category: "layout", tree: makeTree() });
    const db = await openRawDb(dbName);
    await rawPut(db, { id: "corrupt-get", garbage: true });
    db.close();

    const result = await adapter.getMyBlock("corrupt-get");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RECORD");
    adapter.close();
  });
});

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

describe("quota handling", () => {
  it("rejects a record larger than the individual cap (no silent data loss)", async () => {
    const adapter = makeAdapter();
    const hugeTree = makeTreeWithText(300, 3000); // ≈ 900 KB of text (valid tree)
    const result = await adapter.createMyBlock({
      name: "Huge",
      category: "layout",
      tree: hugeTree,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("RECORD_TOO_LARGE");
      expect(result.error.message).toContain("too large");
    }
    // Nothing was written.
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(0);
    adapter.close();
  });

  it("rejects writes that would exceed the total recommended library size", async () => {
    const dbName = `quota-lib-${dbCounter++}`;
    const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });

    // Force the store to exist first through the adapter, then pre-fill the
    // library with ~9 MB of valid records via raw writes so the guard has
    // something real to measure (createMyBlock itself would block the fill).
    await adapter.createMyBlock({ name: "seed", category: "layout", tree: makeTree() });
    const db = await openRawDb(dbName);
    const bigTree = makeTreeWithText(280, 2600); // ≈ 730 KB per record
    for (let i = 0; i < 12; i++) {
      await rawPut(db, makeRecord({ id: `big-${i}`, tree: bigTree, name: `Big ${i}` }));
    }
    db.close();

    // Sanity: the seeded library already exceeds the recommended size.
    const list = await adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) {
      const used = estimateLibraryBytes(list.value);
      expect(used).toBeGreaterThan(8 * 1024 * 1024);
    }

    // A new write must be rejected before touching storage.
    const result = await adapter.createMyBlock({ name: "One more", category: "layout", tree: makeTree() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("QUOTA_EXCEEDED");
      expect(result.error.message).toContain("full");
    }
    adapter.close();
  });

  it("rejects updates once the library is full (never silently overwrites)", async () => {
    const dbName = `quota-update-${dbCounter++}`;
    const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });
    await adapter.createMyBlock({ name: "seed", category: "layout", tree: makeTree() });
    const db = await openRawDb(dbName);
    const bigTree = makeTreeWithText(280, 2600);
    for (let i = 0; i < 11; i++) {
      await rawPut(db, makeRecord({ id: `big-${i}`, tree: bigTree, name: `Big ${i}` }));
    }
    db.close();

    // The library is already over the recommended size; even a metadata-only
    // update must be rejected with a user-safe quota error, not overwritten.
    const seed = await adapter.listMyBlocks();
    const seedId = seed.ok ? seed.value.find((b) => b.name === "seed")?.id : undefined;
    expect(seedId).toBeDefined();
    const result = await adapter.updateMyBlock(seedId!, {
      description: "x".repeat(280),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("QUOTA_EXCEEDED");
    adapter.close();
  });
});

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

describe("duplicateMyBlock", () => {
  it("creates an independent record with a fresh id and safe name", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlock({
      name: "Hero",
      category: "layout",
      tree: makeTree(),
      sourceMetadata: { source: "imported", language: "html" },
    });
    if (!created.ok) return;

    const dup = await adapter.duplicateMyBlock(created.value.id);
    expect(dup.ok).toBe(true);
    if (dup.ok) {
      expect(dup.value.id).not.toBe(created.value.id);
      expect(dup.value.name).toBe("Hero 2");
      expect(dup.value.sourceMetadata?.source).toBe("duplicated");
      expect(dup.value.useCount).toBe(0);
      // Independent deep copy — mutating one never affects the other.
      dup.value.tree.nodes[dup.value.tree.rootIds[0]].props.name = "changed";
      const original = await adapter.getMyBlock(created.value.id);
      if (original.ok) {
        const originalRoot = original.value.tree.nodes[original.value.tree.rootIds[0]];
        expect(originalRoot.props.name).toBe("Pricing section");
      }
    }
    adapter.close();
  });

  it("duplicating twice yields 2, 3 names", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    const d1 = await adapter.duplicateMyBlock(created.value.id);
    const d2 = await adapter.duplicateMyBlock(created.value.id);
    expect(d1.ok && d2.ok).toBe(true);
    if (d1.ok && d2.ok) {
      expect(d1.value.name).toBe("Hero 2");
      expect(d2.value.name).toBe("Hero 3");
    }
    adapter.close();
  });
});

// ---------------------------------------------------------------------------
// Migration: v2 → v3 preserves projects, thumbnails, metadata
// ---------------------------------------------------------------------------

describe("My Blocks adapter — v2 → v3 upgrade (non-destructive)", () => {
  it("a fresh database created FIRST by the thumbnail adapter still gets the myBlocks store", async () => {
    // In the real app the thumbnail adapter is often the first connection
    // (thumbnails render right after project creation). If its upgrade handler
    // created the v3 database without the myBlocks store, the personal block
    // library would be unusable — regression guard for Phase P4.
    const dbName = `thumb-first-${dbCounter++}`;
    const thumbAdapter = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: 3,
      hashFn: async (blob) => `hash-${blob.size}`,
    });
    const thumbSaved = await thumbAdapter.saveThumbnail({
      projectId: "proj-thumb-first",
      revision: 1,
      generatedAt: "2026-07-30T00:00:00.000Z",
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 2048,
      data: new Blob(["thumb"], { type: "image/webp" }),
    });
    expect(thumbSaved.success).toBe(true);
    thumbAdapter.close();

    // The My Blocks adapter opens the same database — the store must exist.
    const myBlocksAdapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });
    const created = await myBlocksAdapter.createMyBlock({
      name: "Hero",
      category: "layout",
      tree: makeTree(),
    });
    expect(created.ok).toBe(true);
    myBlocksAdapter.close();
  });

  it("preserves projects + active project + thumbnails while adding myBlocks", async () => {
    const dbName = `upgrade-mb-${dbCounter++}`;

    // 1. Create a v2 database with a project, active project, and thumbnail.
    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 2 });
    const project = makeProject();
    const saved = await projectAdapter.saveProject({ project, revision: 1 });
    expect(saved.success).toBe(true);
    await projectAdapter.setActiveProjectId(project.id);
    projectAdapter.close();

    const thumbAdapter = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: async (blob) => `hash-${blob.size}` });
    const thumbSaved = await thumbAdapter.saveThumbnail({
      projectId: project.id,
      revision: 1,
      generatedAt: "2026-07-30T00:00:00.000Z",
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 2048,
      data: new Blob(["thumb"], { type: "image/webp" }),
    });
    expect(thumbSaved.success).toBe(true);
    thumbAdapter.close();

    // 2. Open with the My Blocks adapter at version 3 (upgrade path).
    const myBlocksAdapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });
    const created = await myBlocksAdapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    expect(created.ok).toBe(true);
    myBlocksAdapter.close();

    // 3. The project must remain readable after the upgrade.
    const reopened = new IndexedDbProjectAdapter({ dbName, dbVersion: 3 });
    const loaded = await reopened.loadProject(project.id);
    expect(loaded.success).toBe(true);
    if (loaded.success) expect(loaded.project.name).toBe(project.name);

    const active = await reopened.getActiveProjectId();
    expect(active.success).toBe(true);
    if (active.success) expect(active.projectId).toBe(project.id);
    reopened.close();

    // 4. The thumbnail must remain readable after the upgrade.
    const thumbReopened = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 3, hashFn: async (blob) => `hash-${blob.size}` });
    const thumbLoaded = await thumbReopened.getThumbnail(project.id);
    expect(thumbLoaded.success).toBe(true);
    if (thumbLoaded.success) expect(await thumbLoaded.record.data.text()).toBe("thumb");
    thumbReopened.close();

    // 5. The My Blocks store must persist records across reconnects.
    const again = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 3 });
    const list = await again.listMyBlocks();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.value).toHaveLength(1);
    again.close();
  });
});

// ---------------------------------------------------------------------------
// Size estimate helper
// ---------------------------------------------------------------------------

describe("estimateLibraryBytes", () => {
  it("sums record estimates and is stable", () => {
    const a = makeRecord({ id: "a" });
    const b = makeRecord({ id: "b" });
    const total = estimateLibraryBytes([a, b]);
    expect(total).toBeGreaterThan(0);
    expect(estimateLibraryBytes([a]) + estimateLibraryBytes([b])).toBe(total);
    expect(estimateLibraryBytes([])).toBe(0);
  });
});
