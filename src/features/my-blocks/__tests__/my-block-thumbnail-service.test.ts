// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — thumbnail service tests
//
//   - generate: renders → captures → encodes → persists (injected deps)
//   - ensureForRecord: current metadata short-circuits; missing/stale regenerates
//   - failure fallback: any generation failure returns a structured error and
//     never corrupts the caller
//   - bounded in-memory cache (never grows past MY_BLOCK_THUMBNAIL_CACHE_MAX)
//   - concurrent generation deduplication (one in-flight promise per block)
//   - quota-aware persistence: on QUOTA_EXCEEDED the OLDEST thumbnails are
//     evicted before the retry
//   - deleteForBlock clears the cache + storage
//   - no raw source ever reaches storage (Blob is encoded image data only)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { MyBlockThumbnailService, type MyBlockThumbnailGenerationDeps } from "../thumbnails/my-block-thumbnail-service";
import {
  MY_BLOCK_THUMBNAIL_CACHE_MAX,
  MY_BLOCK_THUMBNAIL_HEIGHT,
  MY_BLOCK_THUMBNAIL_WIDTH,
  type MyBlockThumbnailRecord,
  type MyBlockThumbnailStorageAdapter,
} from "../thumbnails/my-block-thumbnail-types";
import type { MyBlockResult } from "../types";
import { makeRecord, makeTree } from "./helpers";

// ---------------------------------------------------------------------------
// Fake storage adapter
// ---------------------------------------------------------------------------

class FakeThumbnailStorage implements MyBlockThumbnailStorageAdapter {
  records = new Map<string, MyBlockThumbnailRecord>();
  /** Quota failures to simulate — each entry is consumed by one save call. */
  saveFailures: string[] = [];
  removed: string[] = [];

  async getThumbnail(blockId: string): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    const record = this.records.get(blockId);
    if (!record) {
      return { ok: false, error: { code: "THUMBNAIL_NOT_FOUND", message: "missing" } };
    }
    return { ok: true, value: record };
  }

  async saveThumbnail(record: MyBlockThumbnailRecord): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    if (this.saveFailures.includes("quota")) {
      // Consume the failure so the service's retry can succeed.
      this.saveFailures = this.saveFailures.filter((f) => f !== "quota");
      return { ok: false, error: { code: "QUOTA_EXCEEDED", message: "storage full" } };
    }
    this.records.set(record.blockId, record);
    return { ok: true, value: record };
  }

  async removeThumbnail(blockId: string): Promise<MyBlockResult<{ blockId: string }>> {
    this.records.delete(blockId);
    this.removed.push(blockId);
    return { ok: true, value: { blockId } };
  }

  async listThumbnailMetadata(): Promise<MyBlockResult<Array<Omit<MyBlockThumbnailRecord, "data">>>> {
    return {
      ok: true,
      value: Array.from(this.records.values()).map(({ data: _data, ...meta }) => meta),
    };
  }

  async estimateThumbnailUsage(): Promise<MyBlockResult<{ count: number; bytes: number }>> {
    let bytes = 0;
    for (const record of this.records.values()) bytes += record.byteSize;
    return { ok: true, value: { count: this.records.size, bytes } };
  }

  close(): void {}
}

// ---------------------------------------------------------------------------
// Fake generation deps
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<MyBlockThumbnailGenerationDeps> = {}) {
  const captured = { containers: 0, roots: 0, unmounted: 0 };
  const deps: MyBlockThumbnailGenerationDeps = {
    capture: vi.fn(async () => ({ canvas: {} as HTMLCanvasElement })),
    encode: vi.fn(async () => ({
      ok: true as const,
      mimeType: "image/webp" as const,
      width: MY_BLOCK_THUMBNAIL_WIDTH,
      height: MY_BLOCK_THUMBNAIL_HEIGHT,
      byteSize: 512,
      blob: new Blob(["encoded-image"], { type: "image/webp" }),
    })),
    createContainer: () => {
      captured.containers += 1;
      return document.createElement("div");
    },
    removeContainer: () => {},
    waitForReadiness: vi.fn(async () => {}),
    mountPreview: () => {
      captured.roots += 1;
      return { unmount: () => (captured.unmounted += 1) } as never;
    },
    now: () => "2026-08-01T00:00:00.000Z",
    hashFn: async (blob) => `hash-${blob.size}`,
    ...overrides,
  };
  return { deps, captured };
}

/** Let the fire-and-forget persistence/eviction path settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

function makeService(storage?: FakeThumbnailStorage) {
  const fakeStorage = storage ?? new FakeThumbnailStorage();
  const { deps, captured } = makeDeps();
  const service = new MyBlockThumbnailService(fakeStorage, deps);
  return { service, storage: fakeStorage, captured, deps };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MyBlockThumbnailService — generate", () => {
  it("renders, captures, encodes and persists a generated thumbnail", async () => {
    const { service, storage, captured, deps } = makeService();
    const record = makeRecord({ id: "block-1", tree: makeTree() });

    const result = await service.generateForRecord(record);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(deps.capture).toHaveBeenCalledTimes(1);
    expect(deps.encode).toHaveBeenCalledTimes(1);
    expect(captured.containers).toBe(1);
    expect(captured.unmounted).toBe(1);

    expect(result.value.blockId).toBe("block-1");
    expect(result.value.revision).toBe(record.contentRevision ?? 1);
    expect(result.value.mimeType).toBe("image/webp");
    expect(result.value.width).toBe(MY_BLOCK_THUMBNAIL_WIDTH);
    expect(result.value.height).toBe(MY_BLOCK_THUMBNAIL_HEIGHT);
    expect(result.value.byteSize).toBe(512);

    // Persisted to storage.
    expect(storage.records.has("block-1")).toBe(true);
    // The Blob is encoded image data — never the tree/source.
    const stored = storage.records.get("block-1")!;
    expect(await stored.data.text()).toBe("encoded-image");
  });

  it("returns a structured THUMBNAIL_GENERATION_FAILED on failure and cleans up", async () => {
    const storage = new FakeThumbnailStorage();
    const { deps, captured } = makeDeps({
      encode: vi.fn(async () => ({
        ok: false as const,
        error: { code: "ENCODING_FAILED" as const, message: "raw cause" },
      })),
    });
    const service = new MyBlockThumbnailService(storage, deps);
    const result = await service.generateForRecord(makeRecord({ id: "block-1" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("THUMBNAIL_GENERATION_FAILED");
      // User-safe message — the raw cause is never the user-facing message.
      expect(result.error.message).toContain("encoded");
      expect(result.error.message).not.toContain("ENCODING_FAILED");
    }
    expect(captured.unmounted).toBe(1);
    expect(storage.records.size).toBe(0);
  });

  it("never stores anything when generation throws", async () => {
    const storage = new FakeThumbnailStorage();
    const { deps } = makeDeps({
      createContainer: () => {
        throw new Error("boom");
      },
    });
    const service = new MyBlockThumbnailService(storage, deps);
    const result = await service.generateForRecord(makeRecord({ id: "block-1" }));
    expect(result.ok).toBe(false);
    expect(storage.records.size).toBe(0);
  });
});

describe("MyBlockThumbnailService — ensure", () => {
  it("short-circuits when the stored metadata is current", async () => {
    const storage = new FakeThumbnailStorage();
    const { service, deps } = makeService(storage);
    const record = makeRecord({
      id: "block-1",
      contentRevision: 2,
      thumbnail: {
        revision: 2,
        generatedAt: "2026-08-01T00:00:00.000Z",
        mimeType: "image/webp",
        width: 480,
        height: 300,
        byteSize: 512,
        hash: "h",
      },
    });
    storage.records.set("block-1", {
      blockId: "block-1",
      revision: 2,
      generatedAt: "2026-08-01T00:00:00.000Z",
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 512,
      hash: "h",
      data: new Blob(["existing"], { type: "image/webp" }),
    });

    const result = await service.ensureForRecord(record);
    expect(result.ok).toBe(true);
    // No generation happened — existing blob returned.
    expect(deps.capture).not.toHaveBeenCalled();
    if (result.ok) expect(await result.value.data.text()).toBe("existing");
  });

  it("regenerates when the stored revision is stale", async () => {
    const storage = new FakeThumbnailStorage();
    const { service, deps } = makeService(storage);
    const record = makeRecord({ id: "block-1", contentRevision: 3 });
    storage.records.set("block-1", {
      blockId: "block-1",
      revision: 1,
      generatedAt: "2026-08-01T00:00:00.000Z",
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 512,
      hash: "old",
      data: new Blob(["old"], { type: "image/webp" }),
    });

    const result = await service.ensureForRecord(record);
    expect(result.ok).toBe(true);
    expect(deps.capture).toHaveBeenCalledTimes(1);
    const stored = storage.records.get("block-1")!;
    expect(stored.revision).toBe(3);
  });

  it("regenerates when no thumbnail exists", async () => {
    const { service, deps } = makeService();
    const result = await service.ensureForRecord(makeRecord({ id: "block-1" }));
    expect(result.ok).toBe(true);
    expect(deps.capture).toHaveBeenCalledTimes(1);
  });

  it("isThumbnailCurrent matches revision to contentRevision", () => {
    const { service } = makeService();
    const record = makeRecord({ id: "b", contentRevision: 2 });
    expect(
      service.isThumbnailCurrent({ ...record, thumbnail: undefined }),
    ).toBe(false);
    expect(
      service.isThumbnailCurrent({
        ...record,
        thumbnail: {
          revision: 2,
          generatedAt: "2026-08-01T00:00:00.000Z",
          mimeType: "image/webp",
          width: 480,
          height: 300,
          byteSize: 10,
          hash: "h",
        },
      }),
    ).toBe(true);
  });
});

describe("MyBlockThumbnailService — cache", () => {
  it("is bounded at MY_BLOCK_THUMBNAIL_CACHE_MAX entries", async () => {
    const storage = new FakeThumbnailStorage();
    const { service } = makeService(storage);
    for (let i = 0; i < MY_BLOCK_THUMBNAIL_CACHE_MAX + 5; i += 1) {
      storage.records.set(`block-${i}`, {
        blockId: `block-${i}`,
        revision: 1,
        generatedAt: "2026-08-01T00:00:00.000Z",
        mimeType: "image/webp",
        width: 480,
        height: 300,
        byteSize: 10,
        hash: `h${i}`,
        data: new Blob([`data-${i}`], { type: "image/webp" }),
      });
    }
    for (let i = 0; i < MY_BLOCK_THUMBNAIL_CACHE_MAX + 5; i += 1) {
      await service.getRecord(`block-${i}`);
    }
    const cacheSize = (service as unknown as { cache: Map<string, unknown> }).cache.size;
    expect(cacheSize).toBe(MY_BLOCK_THUMBNAIL_CACHE_MAX);
  });

  it("getRecord serves from cache after the first read", async () => {
    const storage = new FakeThumbnailStorage();
    const { service } = makeService(storage);
    storage.records.set("block-1", {
      blockId: "block-1",
      revision: 1,
      generatedAt: "2026-08-01T00:00:00.000Z",
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 10,
      hash: "h",
      data: new Blob(["d"], { type: "image/webp" }),
    });
    const getSpy = vi.spyOn(storage, "getThumbnail");
    await service.getRecord("block-1");
    await service.getRecord("block-1");
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("clearCache drops all cached records", async () => {
    const storage = new FakeThumbnailStorage();
    const { service } = makeService(storage);
    storage.records.set("block-1", {
      blockId: "block-1",
      revision: 1,
      generatedAt: "2026-08-01T00:00:00.000Z",
      mimeType: "image/webp",
      width: 480,
      height: 300,
      byteSize: 10,
      hash: "h",
      data: new Blob(["d"], { type: "image/webp" }),
    });
    await service.getRecord("block-1");
    service.clearCache();
    const getSpy = vi.spyOn(storage, "getThumbnail");
    await service.getRecord("block-1");
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MyBlockThumbnailService — concurrency", () => {
  it("deduplicates concurrent generation for the same block", async () => {
    const storage = new FakeThumbnailStorage();
    const { service, deps, captured } = makeService(storage);
    // Slow the pipeline so the second call lands while the first is in flight.
    (deps.waitForReadiness as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((r) => setTimeout(r, 10)),
    );

    const record = makeRecord({ id: "block-1" });
    const [a, b] = await Promise.all([
      service.generateForRecord(record),
      service.generateForRecord(record),
    ]);
    expect(a.ok && b.ok).toBe(true);
    // Only ONE render/capture happened.
    expect(captured.containers).toBe(1);
    expect(deps.capture).toHaveBeenCalledTimes(1);
  });
});

describe("MyBlockThumbnailService — quota eviction", () => {
  it("evicts the OLDEST thumbnails before retrying when storage is full", async () => {
    const storage = new FakeThumbnailStorage();
    // Seed two thumbnails (oldest first), then fail the next save once.
    storage.records.set("block-old", makeStoredRecord("block-old", "2026-01-01T00:00:00.000Z"));
    storage.records.set("block-new", makeStoredRecord("block-new", "2026-07-01T00:00:00.000Z"));
    storage.saveFailures.push("quota");

    const { service } = makeService(storage);
    const record = makeRecord({ id: "block-target" });
    const result = await service.generateForRecord(record);
    expect(result.ok).toBe(true);

    // Persistence is fire-and-forget — wait for the eviction to settle.
    await settle();

    // The OLDEST thumbnail is evicted first; thumbnails are regenerable so
    // the eviction proceeds until enough bytes are freed (here both seeds are
    // evicted since their combined size is smaller than the new image). The
    // retry then persists the new thumbnail.
    expect(storage.removed[0]).toBe("block-old");
    expect(storage.records.has("block-target")).toBe(true);
    expect(storage.records.has("block-new")).toBe(false);
  });

  it("does not persist when eviction is impossible (nothing evictable)", async () => {
    const storage = new FakeThumbnailStorage();
    storage.saveFailures.push("quota");
    const { service } = makeService(storage);
    const result = await service.generateForRecord(makeRecord({ id: "block-1" }));
    // Generation itself succeeded (result.ok true), but with nothing to evict
    // the save is abandoned — the blob is NOT persisted.
    await settle();
    expect(result.ok).toBe(true);
    expect(storage.records.has("block-1")).toBe(false);
  });
});

describe("MyBlockThumbnailService — delete", () => {
  it("deleteForBlock clears cache and removes storage", async () => {
    const storage = new FakeThumbnailStorage();
    const { service } = makeService(storage);
    storage.records.set("block-1", makeStoredRecord("block-1", "2026-08-01T00:00:00.000Z"));
    await service.getRecord("block-1"); // warms cache

    const result = await service.deleteForBlock("block-1");
    expect(result.ok).toBe(true);
    expect(storage.records.has("block-1")).toBe(false);
    // Cache cleared — a follow-up read must hit storage (and find nothing).
    const getSpy = vi.spyOn(storage, "getThumbnail");
    await service.getRecord("block-1");
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe("MyBlockThumbnailService — usage", () => {
  it("reports thumbnail bytes for the quota footer", async () => {
    const storage = new FakeThumbnailStorage();
    storage.records.set("a", makeStoredRecord("a", "2026-08-01T00:00:00.000Z"));
    storage.records.set("b", makeStoredRecord("b", "2026-08-01T00:00:00.000Z"));
    const { service } = makeService(storage);
    const usage = await service.estimateUsage();
    expect(usage.ok).toBe(true);
    if (usage.ok) {
      expect(usage.value.count).toBe(2);
      expect(usage.value.bytes).toBe(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStoredRecord(blockId: string, generatedAt: string): MyBlockThumbnailRecord {
  return {
    blockId,
    revision: 1,
    generatedAt,
    mimeType: "image/webp",
    width: 480,
    height: 300,
    byteSize: 10,
    hash: `h-${blockId}`,
    data: new Blob(["x"], { type: "image/webp" }),
  };
}
