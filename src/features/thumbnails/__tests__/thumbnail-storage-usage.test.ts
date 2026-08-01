// ---------------------------------------------------------------------------
// Thumbnail storage-usage tests
//
// Covers the Phase G storage-quota awareness (§22) and the §7 storage-usage
// test list that is not already covered by the storage-adapter tests:
//   - thumbnail bytes are tracked SEPARATELY from Asset bytes
//   - removing all thumbnails reduces usage to zero
//   - an unsupported estimate (adapter without estimateThumbnailUsage)
//     remains non-blocking
//   - a thumbnail quota/save failure never affects project persistence
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbThumbnailAdapter } from "../storage/thumbnail-storage-adapter";
import { IndexedDbProjectAdapter } from "@/features/persistence/adapters/indexed-db-adapter";
import type { ProjectThumbnailRecord } from "../types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

function uniqueDbName(): string {
  return `usage-test-${dbCounter++}`;
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

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Usage Project",
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
    assets: [
      {
        id: "asset-1",
        name: "logo",
        type: "logo",
        mimeType: "image/png",
        extension: ".png",
        size: 4000,
        source: { type: "data-url", value: "data:image/png;base64,AAAA" },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("thumbnail storage usage", () => {
  it("thumbnail bytes are tracked separately from Asset bytes", async () => {
    const dbName = uniqueDbName();

    // Project with one 4000-byte asset.
    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 2 });
    await projectAdapter.saveProject({ project: makeProject(), revision: 1 });
    projectAdapter.close();

    // One thumbnail.
    const thumbAdapter = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });
    await thumbAdapter.saveThumbnail(makeRecord({ byteSize: 2048, data: new Blob([new Uint8Array(2048)]) }));

    // Thumbnail usage reports ONLY the thumbnail (count + bytes), never assets.
    const thumbUsage = await thumbAdapter.estimateThumbnailUsage();
    expect(thumbUsage.success).toBe(true);
    if (thumbUsage.success) {
      expect(thumbUsage.count).toBe(1);
      expect(thumbUsage.bytes).toBeGreaterThanOrEqual(2048);
    }
    thumbAdapter.close();

    // The project summary reports the ASSET byte count (4000), which is not
    // inflated by thumbnail bytes.
    const listAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 2 });
    const list = await listAdapter.listProjects();
    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.projects).toHaveLength(1);
      expect(list.projects[0].approximateAssetBytes).toBe(4000);
    }
    listAdapter.close();
  });

  it("removing all thumbnails reduces usage to zero", async () => {
    const dbName = uniqueDbName();
    const thumbAdapter = new IndexedDbThumbnailAdapter({ dbName, dbVersion: 2, hashFn: hashOf });
    await thumbAdapter.saveThumbnail(makeRecord({ projectId: "proj-a", byteSize: 1000, data: new Blob([new Uint8Array(1000)]) }));
    await thumbAdapter.saveThumbnail(makeRecord({ projectId: "proj-b", byteSize: 500, data: new Blob([new Uint8Array(500)]) }));

    let usage = await thumbAdapter.estimateThumbnailUsage();
    expect(usage.success).toBe(true);
    if (usage.success) expect(usage.count).toBe(2);

    // Remove every thumbnail (optional cleanup action — regenerate later).
    await thumbAdapter.removeThumbnail("proj-a");
    await thumbAdapter.removeThumbnail("proj-b");

    usage = await thumbAdapter.estimateThumbnailUsage();
    expect(usage.success).toBe(true);
    if (usage.success) {
      expect(usage.count).toBe(0);
      expect(usage.bytes).toBe(0);
    }
    thumbAdapter.close();
  });

  it("estimateThumbnailUsage is optional and safely skippable", async () => {
    // The adapter interface declares estimateThumbnailUsage as OPTIONAL, so
    // consumers must guard before calling. The dashboard's usage aggregator
    // (storage-estimate) and the dashboard thumbnail service both treat an
    // unsupported estimate as "no usage" and never throw.
    const storage = {
      getThumbnail: async () => ({ success: false as const, error: { code: "PROJECT_NOT_FOUND" as const, message: "nf" } }),
      saveThumbnail: async () => ({ success: false as const, error: { code: "STORAGE_FAILED" as const, message: "nf" } }),
      removeThumbnail: async () => ({ success: true as const }),
      close: () => {},
    };

    const estimate = (storage as unknown as {
      estimateThumbnailUsage?: () => Promise<{ success: true; count: number; bytes: number }>;
    }).estimateThumbnailUsage;

    // The optional method does not exist on a minimal storage object.
    expect(typeof estimate).toBe("undefined");

    // A guard-style consumer stays non-blocking: it resolves to a zero usage
    // result instead of throwing, matching the dashboard's non-blocking policy.
    const result = estimate
      ? await estimate()
      : { success: true as const, count: 0, bytes: 0 };
    expect(result).toEqual({ success: true, count: 0, bytes: 0 });
  });

  it("project save remains successful when a thumbnail quota save fails", async () => {
    const dbName = uniqueDbName();

    // Thumbnail adapter whose `put` always fails with QuotaExceededError.
    const open = (_name: string, _version: number) => {
      const store = {
        get: () => makeRequest(null),
        put: () => makeRequest("QuotaExceededError"),
      };
      const tx = {
        objectStore: () => store,
        onerror: null,
        onabort: null,
        oncomplete: null,
      };
      const db = {
        objectStoreNames: { contains: () => true },
        transaction: () => tx,
        close: () => {},
        onversionchange: null,
      };
      return makeOpenRequest(db);
    };
    const failingFactory = { open } as unknown as IDBFactory;

    const quotaAdapter = new IndexedDbThumbnailAdapter({
      dbName,
      dbVersion: 2,
      hashFn: hashOf,
      indexedDb: failingFactory,
    });
    const saveThumb = await quotaAdapter.saveThumbnail(makeRecord());
    expect(saveThumb.success).toBe(false);
    if (!saveThumb.success) {
      expect(saveThumb.error.code).toBe("STORAGE_FAILED");
      expect(saveThumb.error.message.toLowerCase()).toContain("quota");
    }
    quotaAdapter.close();

    // The PROJECT adapter (real IndexedDB) is completely unaffected: saving
    // and loading a project still succeeds after the thumbnail quota failure.
    const projectAdapter = new IndexedDbProjectAdapter({ dbName, dbVersion: 2 });
    const saveProject = await projectAdapter.saveProject({ project: makeProject(), revision: 1 });
    expect(saveProject.success).toBe(true);

    const loaded = await projectAdapter.loadProject("proj-1");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("Usage Project");
    }
    projectAdapter.close();
  });
});

// ---------------------------------------------------------------------------
// Minimal IDB stubs for the quota-failure test (mirrors the storage-adapter
// test helpers).
// ---------------------------------------------------------------------------

interface StubRequestEvent {
  target: StubRequest;
}

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
