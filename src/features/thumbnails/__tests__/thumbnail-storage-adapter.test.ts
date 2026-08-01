// ---------------------------------------------------------------------------
// IndexedDbThumbnailAdapter tests
//
// Uses fake-indexeddb for isolated, deterministic database testing.
// Each test gets a unique database name to prevent state leakage.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbThumbnailAdapter } from "../storage/thumbnail-storage-adapter";
import { IndexedDbProjectAdapter } from "@/features/persistence/adapters/indexed-db-adapter";
import type { ProjectThumbnailRecord } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

function makeAdapter(options?: {
  dbName?: string;
  dbVersion?: number;
  hashFn?: (blob: Blob) => Promise<string>;
}) {
  dbCounter++;
  return new IndexedDbThumbnailAdapter({
    dbName: options?.dbName ?? `thumb-test-${dbCounter}`,
    dbVersion: options?.dbVersion ?? 2,
    hashFn: options?.hashFn,
  });
}

function makeRecord(overrides?: Partial<ProjectThumbnailRecord>): ProjectThumbnailRecord {
  return {
    projectId: "proj-1",
    revision: 3,
    generatedAt: "2026-07-30T00:00:00.000Z",
    mimeType: "image/webp",
    width: 480,
    height: 300,
    byteSize: 2048,
    data: new Blob(["thumbnail-bytes"], { type: "image/webp" }),
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

// ---------------------------------------------------------------------------
// Failing-factory stub — a minimal IDBFactory whose store requests reject with
// a chosen error so quota / transaction failure mapping can be exercised
// without a real quota overflow.
// ---------------------------------------------------------------------------

function makeFailingFactory(
  failOn: "put" | "get",
  errorName: string,
): IDBFactory {
  const open = (_name: string, _version: number) => {
    const store = {
      get: (_key: unknown) => makeRequest(failOn === "get" ? errorName : null),
      put: (_value: unknown) => makeRequest(failOn === "put" ? errorName : null),
    };
    const tx = {
      objectStore: (_n: string) => store,
      onerror: null,
      onabort: null,
      oncomplete: null,
    };
    const db = {
      objectStoreNames: {
        contains: () => true,
      },
      transaction: () => tx,
      close: () => {},
      onversionchange: null,
    };
    return makeOpenRequest(db);
  };
  return { open } as unknown as IDBFactory;
}

/** Event-like object the adapter reads event.target from. */
interface StubRequestEvent {
  target: StubRequest;
}

/** A minimal IDB request whose callbacks fire with { target: req }. */
interface StubRequest {
  onsuccess: ((e: StubRequestEvent) => void) | null;
  onerror: ((e: StubRequestEvent) => void) | null;
  result: unknown;
  error: DOMException | null;
}

function makeRequest(errorName: string | null): StubRequest {
  const req: StubRequest = {
    onsuccess: null,
    onerror: null,
    result: undefined,
    error: null,
  };
  if (errorName) {
    queueMicrotask(() => {
      req.error = new DOMException(errorName, errorName);
      req.onerror?.({ target: req });
    });
  } else {
    queueMicrotask(() => {
      req.result = undefined;
      req.onsuccess?.({ target: req });
    });
  }
  return req;
}

/**
 * A factory whose put succeeds but the transaction then ABORTS. This models
 * the completion-ordering contract: a request-level put success must NOT
 * resolve saveThumbnail — only tx.oncomplete (a committed write) may.
 */
function makeAbortFactory(): IDBFactory {
  const open = (_name: string, _version: number) => {
    const store = {
      get: (_key: unknown) => makeRequest(null),
      put: (_value: unknown) => makeRequest(null),
    };
    const tx: {
      objectStore: (n: string) => typeof store;
      onerror: ((e: StubRequestEvent) => void) | null;
      onabort: ((e: StubRequestEvent) => void) | null;
      oncomplete: ((e: StubRequestEvent) => void) | null;
    } = {
      objectStore: () => store,
      onerror: null,
      onabort: null,
      oncomplete: null,
    };
    const db = {
      objectStoreNames: {
        contains: () => true,
      },
      transaction: () => tx,
      close: () => {},
      onversionchange: null,
    };
    // Fire the abort in a macrotask. The adapter registers its transaction
    // handlers synchronously after the open resolves (which happens in a
    // microtask), so by the time this setTimeout fires, tx.onabort is wired.
    setTimeout(() => {
      tx.onabort?.({ target: tx as unknown as StubRequest });
    }, 0);
    return makeOpenRequest(db);
  };
  return { open } as unknown as IDBFactory;
}

/** A minimal IDB open request that resolves with { target: req }. */
interface StubOpenRequest {
  result: unknown;
  error: DOMException | null;
  onupgradeneeded: ((e: StubRequestEvent) => void) | null;
  onsuccess: ((e: StubRequestEvent) => void) | null;
  onerror: ((e: StubRequestEvent) => void) | null;
  onblocked: ((e: StubRequestEvent) => void) | null;
}

function makeOpenRequest(db: unknown): StubOpenRequest {
  const req: StubOpenRequest = {
    result: db,
    error: null,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
  };
  queueMicrotask(() => {
    req.onsuccess?.({ target: req });
  });
  return req;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndexedDbThumbnailAdapter — save/load round trip", () => {
  it("saves and loads a thumbnail with all fields preserved", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    const record = makeRecord();
    const save = await adapter.saveThumbnail(record);
    expect(save.success).toBe(true);
    if (save.success) {
      expect(save.deduplicated).toBe(false);
    }

    const load = await adapter.getThumbnail("proj-1");
    expect(load.success).toBe(true);
    if (load.success) {
      expect(load.record.projectId).toBe("proj-1");
      expect(load.record.revision).toBe(3);
      expect(load.record.generatedAt).toBe("2026-07-30T00:00:00.000Z");
      expect(load.record.mimeType).toBe("image/webp");
      expect(load.record.width).toBe(480);
      expect(load.record.height).toBe(300);
      expect(load.record.byteSize).toBe(2048);
      // Blob bytes preserved byte-for-byte
      expect(await load.record.data.text()).toBe("thumbnail-bytes");
    }
    adapter.close();
  });

  it("Blob bytes are identical after close/reopen", async () => {
    const dbName = `reopen-${dbCounter++}`;
    const adapter = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });
    const bytes = new Uint8Array([1, 2, 3, 4, 255, 0, 128]);
    await adapter.saveThumbnail(
      makeRecord({
        data: new Blob([bytes], { type: "application/octet-stream" }),
        mimeType: "image/png",
      }),
    );
    adapter.close();

    // Reopen the SAME database (same name) — bytes must be identical.
    const reopened = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });
    const load = await reopened.getThumbnail("proj-1");
    expect(load.success).toBe(true);
    if (load.success) {
      const loaded = new Uint8Array(await load.record.data.arrayBuffer());
      expect(Array.from(loaded)).toEqual(Array.from(bytes));
      expect(load.record.mimeType).toBe("image/png");
    }
    reopened.close();
  });

  it("returns PROJECT_NOT_FOUND for a missing thumbnail", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    const result = await adapter.getThumbnail("missing-proj");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PROJECT_NOT_FOUND");
    }
    adapter.close();
  });

  it("rejects an empty Blob without writing", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    const result = await adapter.saveThumbnail(
      makeRecord({ data: new Blob([]), byteSize: 0 }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("ENCODING_FAILED");
    }
    // Nothing was stored
    const load = await adapter.getThumbnail("proj-1");
    expect(load.success).toBe(false);
    adapter.close();
  });
});

describe("IndexedDbThumbnailAdapter — multiple projects isolated", () => {
  it("projects do not share thumbnail records", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-a", revision: 1, data: new Blob(["A"]) }));
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-b", revision: 1, data: new Blob(["B"]) }));

    const a = await adapter.getThumbnail("proj-a");
    const b = await adapter.getThumbnail("proj-b");
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (a.success && b.success) {
      expect(await a.record.data.text()).toBe("A");
      expect(await b.record.data.text()).toBe("B");
    }
    adapter.close();
  });
});

describe("IndexedDbThumbnailAdapter — stale-write protection", () => {
  it("accepts when no existing thumbnail", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    const result = await adapter.saveThumbnail(makeRecord({ revision: 1 }));
    expect(result.success).toBe(true);
    adapter.close();
  });

  it("accepts a newer revision (replaces)", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord({ revision: 1, data: new Blob(["v1"]) }));
    const result = await adapter.saveThumbnail(makeRecord({ revision: 2, generatedAt: "2026-07-31T00:00:00.000Z", data: new Blob(["v2"]) }));
    expect(result.success).toBe(true);

    const load = await adapter.getThumbnail("proj-1");
    expect(load.success).toBe(true);
    if (load.success) {
      expect(load.record.revision).toBe(2);
      expect(await load.record.data.text()).toBe("v2");
    }
    adapter.close();
  });

  it("rejects a lower revision with STALE_REVISION", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord({ revision: 5 }));
    const result = await adapter.saveThumbnail(makeRecord({ revision: 4 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("STALE_REVISION");
    }
    // Existing record unchanged
    const load = await adapter.getThumbnail("proj-1");
    expect(load.success).toBe(true);
    if (load.success) {
      expect(load.record.revision).toBe(5);
    }
    adapter.close();
  });

  it("same revision with identical content is idempotent (deduplicated)", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    const blob = new Blob(["same-bytes"]);
    await adapter.saveThumbnail(makeRecord({ revision: 2, data: blob }));
    const result = await adapter.saveThumbnail(makeRecord({ revision: 2, generatedAt: "2026-07-31T00:00:00.000Z", data: blob }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.deduplicated).toBe(true);
    }
    adapter.close();
  });

  it("same revision with different output replaces only when generatedAt is newer", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    // Stored at an earlier generatedAt
    await adapter.saveThumbnail(makeRecord({ revision: 2, generatedAt: "2026-07-30T00:00:00.000Z", data: new Blob(["old"]) }));

    // Same revision, OLDER generatedAt → rejected
    const older = await adapter.saveThumbnail(makeRecord({ revision: 2, generatedAt: "2026-07-29T00:00:00.000Z", data: new Blob(["older"]) }));
    expect(older.success).toBe(false);
    if (!older.success) {
      expect(older.error.code).toBe("STALE_REVISION");
    }

    // Same revision, NEWER generatedAt → accepted
    const newer = await adapter.saveThumbnail(makeRecord({ revision: 2, generatedAt: "2026-07-31T00:00:00.000Z", data: new Blob(["new"]) }));
    expect(newer.success).toBe(true);
    const load = await adapter.getThumbnail("proj-1");
    expect(load.success).toBe(true);
    if (load.success) {
      expect(await load.record.data.text()).toBe("new");
    }
    adapter.close();
  });
});

describe("IndexedDbThumbnailAdapter — remove", () => {
  it("removes a thumbnail record", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord());
    const result = await adapter.removeThumbnail("proj-1");
    expect(result.success).toBe(true);

    const load = await adapter.getThumbnail("proj-1");
    expect(load.success).toBe(false);
    adapter.close();
  });

  it("remove is idempotent for missing records", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    const result = await adapter.removeThumbnail("nonexistent");
    expect(result.success).toBe(true);
    adapter.close();
  });
});

describe("IndexedDbThumbnailAdapter — metadata + usage", () => {
  it("lists lightweight metadata without Blobs", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-a", revision: 2 }));
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-b", revision: 5 }));

    const result = await adapter.listThumbnailMetadata();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.items).toHaveLength(2);
      const b = result.items.find((i) => i.projectId === "proj-b");
      expect(b?.revision).toBe(5);
      // Metadata must not contain a Blob field
      expect("data" in (b ?? {})).toBe(false);
    }
    adapter.close();
  });

  it("estimates count and bytes (not counted as asset bytes)", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-a", byteSize: 1000, data: new Blob([new Uint8Array(1000)]) }));
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-b", byteSize: 500, data: new Blob([new Uint8Array(500)]) }));

    const result = await adapter.estimateThumbnailUsage();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(2);
      expect(result.bytes).toBeGreaterThanOrEqual(1500);
    }
    adapter.close();
  });

  it("deleting thumbnails reduces usage", async () => {
    const adapter = makeAdapter({ hashFn: hashOf });
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-a", byteSize: 1000, data: new Blob([new Uint8Array(1000)]) }));
    await adapter.saveThumbnail(makeRecord({ projectId: "proj-b", byteSize: 500, data: new Blob([new Uint8Array(500)]) }));
    await adapter.removeThumbnail("proj-a");

    const result = await adapter.estimateThumbnailUsage();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.count).toBe(1);
    }
    adapter.close();
  });
});

describe("IndexedDbThumbnailAdapter — error mapping", () => {
  it("maps quota errors to STORAGE_FAILED with a quota message", async () => {
    const adapter = new IndexedDbThumbnailAdapter({
      dbName: `quota-${dbCounter++}`,
      dbVersion: 2,
      hashFn: hashOf,
      indexedDb: makeFailingFactory("put", "QuotaExceededError"),
    });
    const result = await adapter.saveThumbnail(makeRecord());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("STORAGE_FAILED");
      expect(result.error.message.toLowerCase()).toContain("quota");
      expect(result.error.retryable).toBe(true);
    }
    adapter.close();
  });

  it("maps transaction failures to STORAGE_FAILED", async () => {
    const adapter = new IndexedDbThumbnailAdapter({
      dbName: `txfail-${dbCounter++}`,
      dbVersion: 2,
      hashFn: hashOf,
      indexedDb: makeFailingFactory("put", "TransactionInactiveError"),
    });
    const result = await adapter.saveThumbnail(makeRecord());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("STORAGE_FAILED");
    }
    adapter.close();
  });

  it("a transaction abort after a successful put is reported as a failure (not ready)", async () => {
    const adapter = new IndexedDbThumbnailAdapter({
      dbName: `abort-${dbCounter++}`,
      dbVersion: 2,
      hashFn: hashOf,
      indexedDb: makeAbortFactory(),
    });
    const result = await adapter.saveThumbnail(makeRecord());
    // A request-level put success must NOT resolve success — the transaction
    // aborted before commit, so the write never happened.
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("STORAGE_FAILED");
    }
    adapter.close();
  });
});

describe("IndexedDbThumbnailAdapter — completion ordering", () => {
  it("saveThumbnail resolves only after commit — a separate connection reads the record immediately", async () => {
    const dbName = `commit-ordering-${dbCounter++}`;
    const writer = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });
    const record = makeRecord({ projectId: "proj-order", revision: 4 });

    const save = await writer.saveThumbnail(record);
    expect(save.success).toBe(true);
    if (save.success) {
      expect(save.deduplicated).toBe(false);
    }

    // Immediately after saveThumbnail resolves, a BRAND-NEW connection (a
    // separate adapter instance = separate connection) must read the record.
    // This is the contract that makes the scheduler's ready notification safe:
    // notification ⇒ record readable from any connection.
    const reader = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });
    const load = await reader.getThumbnail("proj-order");
    expect(load.success).toBe(true);
    if (load.success) {
      expect(load.record.revision).toBe(4);
      expect(await load.record.data.text()).toBe("thumbnail-bytes");
    }
    reader.close();
    writer.close();
  });
});

// ---------------------------------------------------------------------------
// Database upgrade: version 1 → version 2
// ---------------------------------------------------------------------------

describe("IndexedDbThumbnailAdapter — v1 → v2 upgrade (non-destructive)", () => {
  it("preserves existing project data while adding the thumbnail store", async () => {
    const dbName = `upgrade-test-${dbCounter++}`;

    // 1. Create a v1 database with project data through the project adapter.
    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 1 });
    const project = {
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
              props: {
                headline: "Hello",
                primaryCta: { text: "Go", href: "#" },
              },
              styles: {},
            },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await projectAdapter.saveProject({ project, revision: 1 });
    await projectAdapter.setActiveProjectId("legacy-proj");
    projectAdapter.close();

    // 2. Open with the thumbnail adapter at version 2 (upgrade path).
    const thumbAdapter = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });

    // Force the v2 upgrade to run via the thumbnail adapter first.
    const meta = await thumbAdapter.listThumbnailMetadata();
    expect(meta.success).toBe(true);

    // The legacy project must remain readable after the upgrade.
    const legacyProjectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 2 });
    const legacyLoad = await legacyProjectAdapter.loadProject("legacy-proj");
    if (!legacyLoad.success) {
      // Surface the real error for debugging.
      expect(legacyLoad.error).toBeUndefined();
    }
    expect(legacyLoad.success).toBe(true);
    if (legacyLoad.success) {
      expect(legacyLoad.project.name).toBe("Legacy Project");
    }
    legacyProjectAdapter.close();

    // Active project ID must remain.
    const activeAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 2 });
    const active = await activeAdapter.getActiveProjectId();
    expect(active.success).toBe(true);
    if (active.success) {
      expect(active.projectId).toBe("legacy-proj");
    }
    activeAdapter.close();

    // Thumbnail store must now accept writes (store created by upgrade).
    const save = await thumbAdapter.saveThumbnail(makeRecord({ projectId: "legacy-proj", revision: 1 }));
    expect(save.success).toBe(true);
    const load = await thumbAdapter.getThumbnail("legacy-proj");
    expect(load.success).toBe(true);

    thumbAdapter.close();
  });
});
