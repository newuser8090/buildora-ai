// ---------------------------------------------------------------------------
// createdAt recovery tests for IndexedDbProjectAdapter
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbProjectAdapter } from "../adapters/indexed-db-adapter";
import { STORE_PROJECTS, DATABASE_VERSION } from "../constants";

function uniqueDbName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function openRawDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
    };
    request.onsuccess = (event) => resolve((event.target as IDBOpenDBRequest).result);
    request.onerror = () => reject(request.error);
  });
}

async function closeDb(db: IDBDatabase): Promise<void> {
  db.close();
}

describe("createdAt recovery in listProjects", () => {
  let fixedDate: Date;

  beforeEach(() => {
    fixedDate = new Date("2026-06-15T12:00:00Z");
  });

  it("returns createdAt from stored record when present", async () => {
    const dbName = uniqueDbName("test-records");
    const adapter = new IndexedDbProjectAdapter({ dbName, clock: () => fixedDate });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const project: any = {
      id: "proj-1", name: "Test", createdAt: "2026-01-10T08:00:00.000Z",
      updatedAt: "2026-06-10T10:00:00.000Z",
      theme: { palette: {}, typography: {}, spacing: {}, radius: {}, shadows: {} },
      pages: [], assets: [],
    };
    await adapter.saveProject({ project, revision: 1 });
    adapter.close();

    const adapter2 = new IndexedDbProjectAdapter({ dbName, clock: () => fixedDate });
    const result = await adapter2.listProjects();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projects[0].createdAt).toBe("2026-01-10T08:00:00.000Z");
    }
    adapter2.close();
  });

  it("recovers createdAt from envelope.project.createdAt when record field is missing", async () => {
    const dbName = uniqueDbName("test-envelope-createdat");

    const db = await openRawDb(dbName);
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).put({
      id: "proj-legacy", revision: 1, savedAt: "2026-05-01T12:00:00.000Z",
      updatedAt: "2026-05-01T12:00:00.000Z",
      envelope: {
        formatVersion: 2,
        project: { id: "proj-legacy", name: "Legacy",
          createdAt: "2026-03-01T08:00:00.000Z",
          updatedAt: "2026-05-01T12:00:00.000Z",
          theme: {}, pages: [], assets: [],
        },
      },
      name: "Legacy", pageCount: 0, assetCount: 0, approximateAssetBytes: 0,
    });
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    await closeDb(db);

    const adapter = new IndexedDbProjectAdapter({ dbName, clock: () => fixedDate });
    const result = await adapter.listProjects();
    expect(result.success).toBe(true);
    if (result.success) {
      // createdAt from envelope.project.createdAt (NO createdAt on StoredProjectRecord)
      expect(result.projects[0].createdAt).toBe("2026-03-01T08:00:00.000Z");
    }
    adapter.close();
  });

  it("recovers createdAt from envelope.project.updatedAt when createdAt is absent in both", async () => {
    const dbName = uniqueDbName("test-envelope-updatedat");

    const db = await openRawDb(dbName);
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).put({
      id: "proj-legacy-2", revision: 1, savedAt: "2026-06-01T12:00:00.000Z",
      updatedAt: "2026-06-01T12:00:00.000Z",
      envelope: {
        formatVersion: 2,
        project: { id: "proj-legacy-2", name: "Legacy 2",
          updatedAt: "2026-04-15T10:00:00.000Z",
          theme: {}, pages: [], assets: [],
        },
      },
      name: "Legacy 2", pageCount: 0, assetCount: 0, approximateAssetBytes: 0,
    });
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    await closeDb(db);

    const adapter = new IndexedDbProjectAdapter({ dbName, clock: () => fixedDate });
    const result = await adapter.listProjects();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projects[0].createdAt).toBe("2026-04-15T10:00:00.000Z");
    }
    adapter.close();
  });

  it("falls back to savedAt when no project timestamps are valid", async () => {
    const dbName = uniqueDbName("test-fallback-savedat");

    const db = await openRawDb(dbName);
    const tx = db.transaction(STORE_PROJECTS, "readwrite");
    tx.objectStore(STORE_PROJECTS).put({
      id: "proj-legacy-3", revision: 1, savedAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-01T12:00:00.000Z",
      envelope: {
        formatVersion: 2,
        project: { id: "proj-legacy-3", name: "Legacy 3",
          theme: {}, pages: [], assets: [],
        },
      },
      name: "Legacy 3", pageCount: 0, assetCount: 0, approximateAssetBytes: 0,
    });
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    await closeDb(db);

    const adapter = new IndexedDbProjectAdapter({ dbName, clock: () => fixedDate });
    const result = await adapter.listProjects();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projects[0].createdAt).toBe("2026-07-01T12:00:00.000Z");
    }
    adapter.close();
  });
});
