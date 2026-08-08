// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — collections tests
//
//   - IndexedDB collection CRUD (fake-indexeddb): create/list/get/update/delete
//   - duplicate-safe collection names (case-insensitive)
//   - deleting a collection NEVER deletes blocks — membership is cleaned
//   - corrupt collection records are isolated (list skips, get reports)
//   - max collections quota
//   - in-memory adapter mirrors the same contract (used by component tests)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";
import { MyBlocksIndexedDbAdapter } from "../storage/my-blocks-storage-adapter";
import { InMemoryMyBlocksAdapter, makeRecord, makeTree } from "./helpers";
import { STORE_MY_BLOCK_COLLECTIONS, STORE_MY_BLOCKS } from "@/features/persistence/constants";
import { MY_BLOCK_MAX_COLLECTIONS } from "../schemas/my-block-schema";

let dbCounter = 0;

function makeAdapter(options?: { dbName?: string; clock?: () => Date }) {
  dbCounter += 1;
  return new MyBlocksIndexedDbAdapter({
    dbName: options?.dbName ?? `myblocks-collections-${dbCounter}`,
    dbVersion: 4,
    clock: options?.clock,
  });
}

async function openRawDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 4);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rawPutCollection(db: IDBDatabase, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_MY_BLOCK_COLLECTIONS, "readwrite");
    tx.objectStore(STORE_MY_BLOCK_COLLECTIONS).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe("MyBlocksIndexedDbAdapter — collections CRUD", () => {
  it("creates, lists and gets a collection with deterministic sortOrder", async () => {
    const adapter = makeAdapter();
    const a = await adapter.createMyBlockCollection({ name: "Landing" });
    const b = await adapter.createMyBlockCollection({ name: "Forms" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    expect(a.value.sortOrder).toBe(0);
    expect(b.value.sortOrder).toBe(1);
    expect(a.value.version).toBe(1);

    const list = await adapter.listMyBlockCollections();
    expect(list.ok).toBe(true);
    if (list.ok) {
      // sortOrder ascending → Landing first.
      expect(list.value.map((c) => c.name)).toEqual(["Landing", "Forms"]);
    }

    const got = await adapter.getMyBlockCollection(a.value.id);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.name).toBe("Landing");
    adapter.close();
  });

  it("returns COLLECTION_NOT_FOUND for a missing id", async () => {
    const adapter = makeAdapter();
    const result = await adapter.getMyBlockCollection("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("COLLECTION_NOT_FOUND");
    adapter.close();
  });

  it("makes collection names duplicate-safe (case-insensitive)", async () => {
    const adapter = makeAdapter();
    const first = await adapter.createMyBlockCollection({ name: "Landing" });
    const second = await adapter.createMyBlockCollection({ name: "landing" });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      // The generator preserves the input's casing while making it unique.
      expect(second.value.name).toBe("landing 2");
    }
    adapter.close();
  });

  it("renames a collection duplicate-safely (itself excluded)", async () => {
    const adapter = makeAdapter();
    const a = await adapter.createMyBlockCollection({ name: "Landing" });
    const b = await adapter.createMyBlockCollection({ name: "Forms" });
    if (!a.ok || !b.ok) return;

    const renamed = await adapter.updateMyBlockCollection(a.value.id, { name: "forms" });
    expect(renamed.ok).toBe(true);
    if (renamed.ok) expect(renamed.value.name).toBe("forms 2");

    // Renaming to its own name keeps it unchanged (no "2" suffix for itself).
    const same = await adapter.updateMyBlockCollection(a.value.id, { name: "Forms 2" });
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.value.name).toBe("Forms 2");
    adapter.close();
  });

  it("rejects empty collection names on rename", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlockCollection({ name: "Landing" });
    if (!created.ok) return;
    const result = await adapter.updateMyBlockCollection(created.value.id, { name: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_NAME");
    adapter.close();
  });

  it("updates description and sortOrder", async () => {
    const adapter = makeAdapter();
    const created = await adapter.createMyBlockCollection({ name: "Landing" });
    if (!created.ok) return;
    const updated = await adapter.updateMyBlockCollection(created.value.id, {
      description: "Heroes",
      sortOrder: 5,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.description).toBe("Heroes");
      expect(updated.value.sortOrder).toBe(5);
    }
    adapter.close();
  });

  it("deleting a collection does NOT delete blocks — membership is cleaned", async () => {
    const adapter = makeAdapter();
    const collection = await adapter.createMyBlockCollection({ name: "Landing" });
    if (!collection.ok) return;

    const blockA = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    const blockB = await adapter.createMyBlock({ name: "Nav", category: "layout", tree: makeTree() });
    if (!blockA.ok || !blockB.ok) return;

    await adapter.updateMyBlock(blockA.value.id, { collectionIds: [collection.value.id] });
    await adapter.updateMyBlock(blockB.value.id, { collectionIds: [collection.value.id] });

    const deleted = await adapter.deleteMyBlockCollection(collection.value.id);
    expect(deleted.ok).toBe(true);

    // Both blocks still exist.
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(2);
    if (list.ok) {
      for (const block of list.value) {
        expect(block.collectionIds ?? []).not.toContain(collection.value.id);
      }
    }
    // The collection is gone.
    const collections = await adapter.listMyBlockCollections();
    expect(collections.ok && collections.value).toHaveLength(0);
    adapter.close();
  });

  it("delete is idempotent for a missing collection", async () => {
    const adapter = makeAdapter();
    const result = await adapter.deleteMyBlockCollection("nope");
    expect(result.ok).toBe(true);
    adapter.close();
  });
});

describe("corrupt collection isolation", () => {
  it("skips corrupt collections during list and reports INVALID_RECORD on get", async () => {
    const dbName = `corrupt-col-${dbCounter++}`;
    const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 4 });
    const created = await adapter.createMyBlockCollection({ name: "Good" });
    if (!created.ok) return;

    const db = await openRawDb(dbName);
    await rawPutCollection(db, { id: "corrupt-1", garbage: true });
    await rawPutCollection(db, { id: "corrupt-2", version: 1, name: "" });
    db.close();

    const list = await adapter.listMyBlockCollections();
    expect(list.ok).toBe(true);
    if (list.ok) {
      expect(list.value).toHaveLength(1);
      expect(list.value[0].id).toBe(created.value.id);
    }

    const got = await adapter.getMyBlockCollection("corrupt-1");
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe("INVALID_RECORD");
    adapter.close();
  });
});

describe("collection quota", () => {
  it("rejects creating more than MY_BLOCK_MAX_COLLECTIONS collections", async () => {
    const adapter = makeAdapter();
    let okCount = 0;
    for (let i = 0; i < MY_BLOCK_MAX_COLLECTIONS + 1; i += 1) {
      const result = await adapter.createMyBlockCollection({ name: `C ${i}` });
      if (result.ok) okCount += 1;
    }
    expect(okCount).toBe(MY_BLOCK_MAX_COLLECTIONS);
    const over = await adapter.createMyBlockCollection({ name: "One too many" });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.code).toBe("QUOTA_EXCEEDED");
    adapter.close();
  });
});

describe("first-connection through the My Blocks adapter creates every store", () => {
  it("a fresh database opened ONLY by the My Blocks adapter still gets all six stores", async () => {
    const dbName = `first-myblocks-${dbCounter++}`;
    const adapter = new MyBlocksIndexedDbAdapter({ dbName, dbVersion: 4 });

    // First connection writes a block + collection (forces store creation).
    const block = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    const collection = await adapter.createMyBlockCollection({ name: "Landing" });
    expect(block.ok && collection.ok).toBe(true);
    adapter.close();

    // A raw connection sees all nine stores (Phase P6 added the cloud sync stores).
    const db = await openRawDb(dbName);
    const names = Array.from(db.objectStoreNames);
    db.close();
    expect(names).toEqual(
      expect.arrayContaining([
        "projects",
        "metadata",
        "projectThumbnails",
        "myBlocks",
        "myBlockThumbnails",
        "myBlockCollections",
        "cloudSyncQueue",
        "cloudSyncMarkers",
        "cloudSyncConflicts",
        "deployments",
        "deploymentDomains",
      ]),
    );
    expect(names).toHaveLength(11);
  });
});

describe("InMemoryMyBlocksAdapter — collections mirror the contract", () => {
  it("create/list/update/delete with duplicate-safe names", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const a = await adapter.createMyBlockCollection({ name: "Landing" });
    const b = await adapter.createMyBlockCollection({ name: "landing" });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.value.name).toBe("landing 2");

    const block = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!block.ok || !a.ok) return;
    await adapter.updateMyBlock(block.value.id, { collectionIds: [a.value.id] });

    await adapter.deleteMyBlockCollection(a.value.id);
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(1);
    if (list.ok) {
      expect(list.value[0].collectionIds ?? []).toHaveLength(0);
    }
  });

  it("isolates corrupt collections in the in-memory adapter too", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    adapter.putRawCollectionForTests({ id: "bad", version: 1, name: "", createdAt: "", updatedAt: "", sortOrder: 0 });
    const list = await adapter.listMyBlockCollections();
    expect(list.ok && list.value).toHaveLength(0);
    const got = await adapter.getMyBlockCollection("bad");
    expect(got.ok).toBe(false);
  });
});

describe("collection metadata never touches project history", () => {
  it("favorite + collection updates keep contentRevision and tree identical", async () => {
    const clock = vi.fn(() => new Date("2026-08-01T00:00:00.000Z"));
    const adapter = makeAdapter({ clock });
    const created = await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    const treeBefore = JSON.stringify(created.value.tree);
    const revisionBefore = created.value.contentRevision;

    await adapter.updateMyBlock(created.value.id, { favorite: true, collectionIds: ["col-1"] });

    const after = await adapter.getMyBlock(created.value.id);
    if (!after.ok) return;
    expect(after.value.favorite).toBe(true);
    expect(after.value.collectionIds).toEqual(["col-1"]);
    expect(after.value.contentRevision).toBe(revisionBefore);
    expect(JSON.stringify(after.value.tree)).toBe(treeBefore);
    adapter.close();
  });
});

// Keep STORE_MY_BLOCKS referenced so the import stays meaningful for
// future store-specific tests.
void STORE_MY_BLOCKS;
void makeRecord;
