// ---------------------------------------------------------------------------
// IndexedDB v1 → latest migration tests
//
// Simulates a real database created at version 1 (projects + metadata stores,
// WITHOUT the projectThumbnails store) and verifies the non-destructive
// upgrade to the current version (v4):
//   - projects store preserved, records still readable
//   - metadata store preserved (activeProjectId + dashboard pin metadata)
//   - projectThumbnails store created
//   - myBlocks store created (Phase P4)
//   - myBlockThumbnails + myBlockCollections stores created (Phase P5)
//   - no existing project rewritten, no metadata removed
//   - thumbnail save/load works after upgrade
//   - Blob bytes survive close/reopen
//   - versionchange handling remains correct
//
// A genuine v1 database is seeded directly with raw IndexedDB (ONLY the
// projects + metadata stores are created), because the project adapter's
// upgrade handler now creates every store unconditionally — opening
// through it would not produce a real v1 layout.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbProjectAdapter } from "@/features/persistence/adapters/indexed-db-adapter";
import { IndexedDbThumbnailAdapter } from "../storage/thumbnail-storage-adapter";
import { serializeProject } from "@/features/persistence/services/project-serializer";
import {
  STORE_PROJECTS,
  STORE_METADATA,
  STORE_PROJECT_THUMBNAILS,
  STORE_MY_BLOCKS,
  STORE_MY_BLOCK_THUMBNAILS,
  STORE_MY_BLOCK_COLLECTIONS,
  METADATA_KEY_ACTIVE_PROJECT,
  DATABASE_VERSION,
} from "@/features/persistence/constants";
import type { Project } from "@/types/project";
import type { ProjectThumbnailRecord } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

function uniqueDbName(): string {
  return `migration-test-${dbCounter++}`;
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "legacy-proj",
    name: "Legacy Project",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s1",
            type: "hero",
            order: 1,
            visible: true,
            props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } },
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

async function hashOf(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const view = new Uint8Array(bytes);
  let seed = 0;
  for (let i = 0; i < view.length; i++) {
    seed = (seed * 31 + view[i]) | 0;
  }
  return `test-${view.length}-${seed >>> 0}`;
}

function makeRecord(overrides?: Partial<ProjectThumbnailRecord>): ProjectThumbnailRecord {
  return {
    projectId: "legacy-proj",
    revision: 1,
    generatedAt: "2026-07-30T00:00:00.000Z",
    mimeType: "image/webp",
    width: 480,
    height: 300,
    byteSize: 2048,
    data: new Blob(["thumbnail-bytes"], { type: "image/webp" }),
    ...overrides,
  };
}

/**
 * Open the database at its CURRENT version (never triggers an upgrade).
 * Returns the store names present.
 */
async function getDatabaseStoreNames(dbName: string): Promise<string[]> {
  const openRequest = indexedDB.open(dbName);
  return new Promise<string[]>((resolve, reject) => {
    openRequest.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const names = Array.from(db.objectStoreNames);
      db.close();
      resolve(names);
    };
    openRequest.onerror = () => reject(openRequest.error);
  });
}

/** Read a raw record from a store at the database's current version. */
async function readRawRecord<T>(dbName: string, storeName: string, key: string): Promise<T | undefined> {
  const openRequest = indexedDB.open(dbName);
  return new Promise<T | undefined>((resolve, reject) => {
    openRequest.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = db.transaction(storeName, "readonly");
      const getReq = tx.objectStore(storeName).get(key);
      getReq.onsuccess = () => {
        const value = getReq.result as T | undefined;
        db.close();
        resolve(value);
      };
      getReq.onerror = () => {
        db.close();
        reject(getReq.error);
      };
    };
    openRequest.onerror = () => reject(openRequest.error);
  });
}

/** Run a readwrite transaction inserting values into a store. */
async function putRawRecords(dbName: string, storeName: string, values: unknown[]): Promise<void> {
  const openRequest = indexedDB.open(dbName);
  return new Promise<void>((resolve, reject) => {
    openRequest.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      for (const value of values) {
        store.put(value);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    openRequest.onerror = () => reject(openRequest.error);
  });
}

/**
 * Seed a GENUINE v1 database: only the projects + metadata stores are created,
 * exactly as Phase A-C would have left them, with a project record, an active
 * project ID, and dashboard pin metadata.
 */
async function seedVersionOneDatabase(dbName: string): Promise<void> {
  // Create the v1 database with ONLY projects + metadata stores.
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_METADATA)) {
        db.createObjectStore(STORE_METADATA, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

  // Write a project record in the exact StoredProjectRecord shape.
  const project = makeProject({ id: "legacy-proj", name: "Legacy Project" });
  const envelope = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  await putRawRecords(dbName, STORE_PROJECTS, [
    {
      id: "legacy-proj",
      revision: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      savedAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      envelope,
      name: "Legacy Project",
      pageCount: 1,
      assetCount: 0,
      approximateAssetBytes: 0,
    },
  ]);

  // Write metadata records (active project + dashboard pin).
  await putRawRecords(dbName, STORE_METADATA, [
    { key: METADATA_KEY_ACTIVE_PROJECT, value: "legacy-proj" },
    { key: "dashboard:legacy-proj", value: { isPinned: true, lastOpenedAt: "2026-06-01T00:00:00.000Z" } },
  ]);
}

/** Trigger the upgrade to the current version via the thumbnail adapter and close it. */
async function upgradeToLatest(dbName: string): Promise<void> {
  const thumbAdapter = new IndexedDbThumbnailAdapter({
    dbName,
    dbVersion: DATABASE_VERSION,
    hashFn: hashOf,
  });
  const list = await thumbAdapter.listThumbnailMetadata();
  expect(list.success).toBe(true);
  thumbAdapter.close();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndexedDB v1 → latest migration", () => {
  it("upgrade adds projectThumbnails without touching existing stores", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    // Confirm the DB was seeded at v1 (no thumbnail store).
    const before = await getDatabaseStoreNames(dbName);
    expect(before).toContain(STORE_PROJECTS);
    expect(before).toContain(STORE_METADATA);
    expect(before).not.toContain(STORE_PROJECT_THUMBNAILS);
    expect(before).toHaveLength(2);

    // Open with the thumbnail adapter at the current version — triggers the upgrade.
    await upgradeToLatest(dbName);

    // After upgrade: all six known stores present, none removed. The Phase
    // P4 myBlocks store and the Phase P5 myBlockThumbnails + myBlockCollections
    // stores are created by the same non-destructive upgrade handler (the
    // thumbnail adapter is often the first connection to create the DB).
    const after = await getDatabaseStoreNames(dbName);
    expect(after).toContain(STORE_PROJECTS);
    expect(after).toContain(STORE_METADATA);
    expect(after).toContain(STORE_PROJECT_THUMBNAILS);
    expect(after).toContain(STORE_MY_BLOCKS);
    expect(after).toContain(STORE_MY_BLOCK_THUMBNAILS);
    expect(after).toContain(STORE_MY_BLOCK_COLLECTIONS);
    expect(after).toHaveLength(6);
  });

  it("preserves existing project records and revision after upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    await upgradeToLatest(dbName);

    // Project is still readable with its original revision and content.
    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: DATABASE_VERSION });
    const loaded = await projectAdapter.loadProject("legacy-proj");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Legacy Project");
      expect(loaded.project.pages).toHaveLength(1);
      expect(loaded.project.pages[0].sections[0].props.headline).toBe("Hello");
      expect(loaded.revision).toBe(3);
    }
    projectAdapter.close();
  });

  it("preserves activeProjectId metadata after upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    await upgradeToLatest(dbName);

    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: DATABASE_VERSION });
    const active = await projectAdapter.getActiveProjectId();
    expect(active.success).toBe(true);
    if (active.success) {
      expect(active.projectId).toBe("legacy-proj");
    }
    projectAdapter.close();
  });

  it("preserves dashboard pin metadata after upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    await upgradeToLatest(dbName);

    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: DATABASE_VERSION });
    const meta = await projectAdapter.getDashboardMetadata("legacy-proj");
    expect(meta.success).toBe(true);
    if (meta.success) {
      expect(meta.metadata.isPinned).toBe(true);
      expect(meta.metadata.lastOpenedAt).toBe("2026-06-01T00:00:00.000Z");
    }
    projectAdapter.close();
  });

  it("does not rewrite existing project records (raw envelope unchanged)", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    // Capture the raw stored record before upgrade.
    const before = await readRawRecord<{ id: string; revision: number; envelope: unknown }>(
      dbName,
      STORE_PROJECTS,
      "legacy-proj",
    );
    expect(before).toBeDefined();

    await upgradeToLatest(dbName);

    // Raw record after upgrade must be byte-identical (no rewrite).
    const after = await readRawRecord<{ id: string; revision: number; envelope: unknown }>(
      dbName,
      STORE_PROJECTS,
      "legacy-proj",
    );
    expect(after).toBeDefined();
    expect(after).toEqual(before);
  });

  it("no metadata records are removed during upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    const countMetadataRecords = async (): Promise<number> => {
      const openRequest = indexedDB.open(dbName);
      return new Promise<number>((resolve, reject) => {
        openRequest.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction(STORE_METADATA, "readonly");
          const getReq = tx.objectStore(STORE_METADATA).getAll();
          getReq.onsuccess = () => {
            const count = (getReq.result as unknown[]).length;
            db.close();
            resolve(count);
          };
          getReq.onerror = () => reject(getReq.error);
        };
        openRequest.onerror = () => reject(openRequest.error);
      });
    };

    const before = await countMetadataRecords();
    expect(before).toBe(2);

    await upgradeToLatest(dbName);

    const after = await countMetadataRecords();
    expect(after).toBe(before);
  });

  it("thumbnail save/load works after upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    const thumbAdapter = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
      hashFn: hashOf,
    });
    // First call triggers the upgrade.
    const list = await thumbAdapter.listThumbnailMetadata();
    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.items).toHaveLength(0);
    }

    const save = await thumbAdapter.saveThumbnail(makeRecord());
    expect(save.success).toBe(true);

    const load = await thumbAdapter.getThumbnail("legacy-proj");
    expect(load.success).toBe(true);
    if (load.success) {
      expect(load.record.revision).toBe(1);
      expect(load.record.mimeType).toBe("image/webp");
      expect(await load.record.data.text()).toBe("thumbnail-bytes");
    }
    thumbAdapter.close();
  });

  it("Blob bytes survive close/reopen after upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    const bytes = new Uint8Array([9, 8, 7, 6, 255, 0, 42]);
    const thumbAdapter = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
      hashFn: hashOf,
    });
    await thumbAdapter.listThumbnailMetadata();
    await thumbAdapter.saveThumbnail(
      makeRecord({
        data: new Blob([bytes], { type: "image/png" }),
        mimeType: "image/png",
      }),
    );
    thumbAdapter.close();

    const reopened = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
      hashFn: hashOf,
    });
    const load = await reopened.getThumbnail("legacy-proj");
    expect(load.success).toBe(true);
    if (load.success) {
      const loaded = new Uint8Array(await load.record.data.arrayBuffer());
      expect(Array.from(loaded)).toEqual(Array.from(bytes));
      expect(load.record.mimeType).toBe("image/png");
    }
    reopened.close();
  });

  it("versionchange handling remains correct after upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    const thumbAdapter = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
      hashFn: hashOf,
    });
    await thumbAdapter.listThumbnailMetadata();

    // Simulate another connection requesting a newer version.
    const db = (thumbAdapter as unknown as { db: IDBDatabase | null }).db;
    expect(db).not.toBeNull();
    if (db && db.onversionchange) {
      (db.onversionchange as (ev: Event) => void)(new Event("versionchange"));
    }

    // A subsequent operation reopens a fresh connection and still works.
    const save = await thumbAdapter.saveThumbnail(makeRecord());
    expect(save.success).toBe(true);
    const load = await thumbAdapter.getThumbnail("legacy-proj");
    expect(load.success).toBe(true);
    thumbAdapter.close();
  });

  it("project data and thumbnails coexist without cross-contamination", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    const thumbAdapter = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
      hashFn: hashOf,
    });
    await thumbAdapter.listThumbnailMetadata();
    await thumbAdapter.saveThumbnail(makeRecord());
    thumbAdapter.close();

    // Project adapter still sees the project exactly as before.
    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: DATABASE_VERSION });
    const loaded = await projectAdapter.loadProject("legacy-proj");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Legacy Project");
      expect(loaded.revision).toBe(3);
    }
    projectAdapter.close();

    // Thumbnail adapter sees exactly one thumbnail for the legacy project.
    const reopenedThumb = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: DATABASE_VERSION,
      hashFn: hashOf,
    });
    const meta = await reopenedThumb.listThumbnailMetadata();
    expect(meta.success).toBe(true);
    if (meta.success) {
      expect(meta.items).toHaveLength(1);
      expect(meta.items[0].projectId).toBe("legacy-proj");
    }
    reopenedThumb.close();
  });

  it("no unexpected stores are created during upgrade", async () => {
    const dbName = uniqueDbName();
    await seedVersionOneDatabase(dbName);

    await upgradeToLatest(dbName);

    // The upgrade must NOT have created any unexpected stores.
    const names = await getDatabaseStoreNames(dbName);
    expect(names).toEqual(
      expect.arrayContaining([
        STORE_PROJECTS,
        STORE_METADATA,
        STORE_PROJECT_THUMBNAILS,
        STORE_MY_BLOCKS,
        STORE_MY_BLOCK_THUMBNAILS,
        STORE_MY_BLOCK_COLLECTIONS,
      ]),
    );
    // Exactly the six known stores (Phase P4 myBlocks + Phase P5 thumbnail
    // and collection stores are created non-destructively) — no stray stores.
    expect(
      names.filter(
        (n) =>
          ![
            "projects",
            "metadata",
            "projectThumbnails",
            "myBlocks",
            "myBlockThumbnails",
            "myBlockCollections",
          ].includes(n),
      ),
    ).toHaveLength(0);
    expect(names).toHaveLength(6);
  });
});
