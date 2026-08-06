// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — thumbnail generation + orchestration
//
// MyBlockThumbnailService owns the full lifecycle:
//   - generate: render the validated BlockTree offscreen → capture → encode
//     (injectable deps so unit tests run headless)
//   - persist: save the Blob to the dedicated object store
//   - retrieve: read Blobs back with a bounded in-memory cache
//   - regenerate: only when contentRevision changed (tree changed) or missing
//   - delete: remove with the library record
//   - deduplicate concurrent generation (one in-flight promise per block)
//   - quota-aware save: on storage-full, evict the OLDEST thumbnails before
//     failing (thumbnail Blobs are regenerable — library records are not)
//
// Never stores raw source, never stores executable values, never stores a
// data URL — only encoded image Blobs produced from the validated tree.
// ---------------------------------------------------------------------------

import { createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BlockTree } from "@/features/blocks/types";
import type { MyBlockRecord, MyBlockResult } from "../types";
import { makeMyBlockError } from "../errors";
import type {
  MyBlockThumbnailRecord,
  MyBlockThumbnailStorageAdapter,
} from "./my-block-thumbnail-types";
import {
  MY_BLOCK_THUMBNAIL_WIDTH,
  MY_BLOCK_THUMBNAIL_HEIGHT,
  MY_BLOCK_THUMBNAIL_MIME_PREFERENCE,
  MY_BLOCK_THUMBNAIL_MIME_FALLBACK,
  MY_BLOCK_THUMBNAIL_QUALITY,
  MY_BLOCK_THUMBNAIL_RENDER_TIMEOUT_MS,
  MY_BLOCK_THUMBNAIL_ASSET_WAIT_MS,
  MY_BLOCK_THUMBNAIL_CACHE_MAX,
  MY_BLOCK_THUMBNAIL_SOFT_LIMIT_BYTES,
} from "./my-block-thumbnail-types";
import { MyBlockThumbnailPreview } from "./my-block-thumbnail-renderer";
import { captureNode, type CaptureFn } from "@/features/thumbnails/rendering/thumbnail-capture";
import {
  encodeThumbnail,
  type ThumbnailEncoderFn,
} from "@/features/thumbnails/services/thumbnail-encoder";

// ---------------------------------------------------------------------------
// Injectable generation dependencies
// ---------------------------------------------------------------------------

export interface MyBlockThumbnailGenerationDeps {
  capture: CaptureFn;
  encode: ThumbnailEncoderFn;
  createContainer: () => HTMLElement;
  removeContainer: (el: HTMLElement) => void;
  waitForReadiness: (el: HTMLElement, timeoutMs: number) => Promise<void>;
  mountPreview: (container: HTMLElement, tree: BlockTree) => Root;
  now: () => string;
  hashFn: (blob: Blob) => Promise<string>;
}

function createOffscreenContainer(): HTMLElement {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-100000px";
  el.style.top = "0";
  el.style.width = `${MY_BLOCK_THUMBNAIL_WIDTH}px`;
  el.style.height = `${MY_BLOCK_THUMBNAIL_HEIGHT}px`;
  el.style.pointerEvents = "none";
  el.style.zIndex = "-2147483647";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

async function waitForReadiness(
  el: HTMLElement,
  timeoutMs: number,
): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  const promises: Promise<unknown>[] = [];
  if (typeof document !== "undefined" && document.fonts) {
    promises.push(
      Promise.race([
        document.fonts.ready as Promise<unknown>,
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]),
    );
  }
  const images = Array.from(el.querySelectorAll("img"));
  for (const img of images) {
    if (img.complete) continue;
    promises.push(
      Promise.race([
        new Promise<void>((resolve) => {
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]),
    );
  }
  // A short settle delay lets the auto-fit layout effect apply its transform.
  promises.push(new Promise((r) => setTimeout(r, 80)));
  await Promise.race([
    Promise.all(promises),
    new Promise((r) => setTimeout(r, timeoutMs)),
  ]);
}

const browserDeps: MyBlockThumbnailGenerationDeps = {
  capture: captureNode,
  encode: encodeThumbnail,
  createContainer: createOffscreenContainer,
  removeContainer: (el) => el.remove(),
  waitForReadiness,
  mountPreview: (container, tree) => {
    const root = createRoot(container);
    const element: ReactElement = createElement(MyBlockThumbnailPreview, { tree });
    root.render(element);
    return root;
  },
  now: () => new Date().toISOString(),
  hashFn: defaultHashFn,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MyBlockThumbnailService {
  private deps: MyBlockThumbnailGenerationDeps;
  private storage: MyBlockThumbnailStorageAdapter;
  /** Bounded in-memory record cache (avoids repeated IndexedDB reads). */
  private cache = new Map<string, MyBlockThumbnailRecord>();
  /** In-flight generation promises (deduplicate concurrent requests). */
  private inflight = new Map<string, Promise<MyBlockResult<MyBlockThumbnailRecord>>>();

  constructor(
    storage: MyBlockThumbnailStorageAdapter,
    deps: Partial<MyBlockThumbnailGenerationDeps> = {},
  ) {
    this.storage = storage;
    this.deps = { ...browserDeps, ...deps };
  }

  // -------------------------------------------------------------------------
  // Metadata checks
  // -------------------------------------------------------------------------

  /** Is the record's stored thumbnail metadata current for its tree? */
  isThumbnailCurrent(record: MyBlockRecord): boolean {
    if (!record.thumbnail) return false;
    return record.thumbnail.revision === (record.contentRevision ?? 1);
  }

  // -------------------------------------------------------------------------
  // Ensure — generate only when missing or stale
  // -------------------------------------------------------------------------

  /**
   * Ensure a thumbnail exists for the record. No-op when the stored metadata
   * already matches the tree's contentRevision. Never mutates the record —
   * the caller attaches the returned metadata reference.
   */
  ensureForRecord(
    record: MyBlockRecord,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    if (this.isThumbnailCurrent(record)) {
      return this.getRecord(record.id);
    }
    return this.generateForRecord(record);
  }

  /**
   * Generate + persist a thumbnail for the record. Returns the record with
   * the Blob; the caller stores the metadata reference on the library record.
   */
  generateForRecord(
    record: MyBlockRecord,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    const key = record.id;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.generate(record).then((result) => {
      if (result.ok) {
        this.persistWithEviction(result.value);
      }
      return result;
    });
    this.inflight.set(key, promise);
    // Clean the in-flight entry when settled (the cache keeps the record).
    void promise.finally(() => {
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    });
    return promise;
  }

  // -------------------------------------------------------------------------
  // Generate (pure pipeline — no storage)
  // -------------------------------------------------------------------------

  private async generate(
    record: MyBlockRecord,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    if (typeof document === "undefined") {
      return {
        ok: false,
        error: makeMyBlockError(
          "THUMBNAIL_GENERATION_FAILED",
          "Thumbnails can only be generated in a browser.",
        ),
      };
    }
    const blockId = record.id;
    let container: HTMLElement | null = null;
    let root: Root | null = null;
    try {
      container = this.deps.createContainer();
      root = this.deps.mountPreview(container, record.tree);
      await this.deps.waitForReadiness(container, MY_BLOCK_THUMBNAIL_ASSET_WAIT_MS);

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            makeMyBlockError(
              "THUMBNAIL_GENERATION_FAILED",
              "Rendering the preview exceeded the timeout.",
            ),
          );
        }, MY_BLOCK_THUMBNAIL_RENDER_TIMEOUT_MS);
      });

      const capturePromise = this.deps
        .capture({
          node: container,
          width: MY_BLOCK_THUMBNAIL_WIDTH,
          height: MY_BLOCK_THUMBNAIL_HEIGHT,
          timeoutMs: MY_BLOCK_THUMBNAIL_RENDER_TIMEOUT_MS,
        })
        .then(({ canvas }) => this.deps.encode({ canvas }))
        .catch((err: unknown) => {
          if (
            err &&
            typeof err === "object" &&
            "code" in err &&
            "message" in err
          ) {
            throw err;
          }
          throw makeMyBlockError(
            "THUMBNAIL_GENERATION_FAILED",
            "The preview could not be captured.",
            err instanceof Error ? err.message : String(err),
          );
        });

      let encoded;
      try {
        encoded = await Promise.race([capturePromise, timeoutPromise]);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }

      if (!encoded.ok) {
        // The shared encoder reports ThumbnailError — map to the My Block
        // error contract with a user-safe message (never the raw cause).
        return {
          ok: false,
          error: makeMyBlockError(
            "THUMBNAIL_GENERATION_FAILED",
            "The thumbnail could not be encoded.",
            encoded.error.cause ?? encoded.error.code,
          ),
        };
      }
      if (encoded.mimeType !== "image/webp" && encoded.mimeType !== "image/png") {
        return {
          ok: false,
          error: makeMyBlockError(
            "THUMBNAIL_GENERATION_FAILED",
            "The encoded thumbnail has an unsupported format.",
          ),
        };
      }
      const hash = await this.deps.hashFn(encoded.blob);
      const recordOut: MyBlockThumbnailRecord = {
        blockId,
        revision: record.contentRevision ?? 1,
        generatedAt: this.deps.now(),
        mimeType: encoded.mimeType,
        width: encoded.width,
        height: encoded.height,
        byteSize: encoded.byteSize,
        hash,
        data: encoded.blob,
      };
      return { ok: true, value: recordOut };
    } catch (err) {
      return {
        ok: false,
        error: makeMyBlockError(
          "THUMBNAIL_GENERATION_FAILED",
          "The thumbnail could not be generated.",
          err instanceof Error ? err.message : String(err),
        ),
      };
    } finally {
      try {
        root?.unmount();
      } catch {
        // ignore cleanup errors
      }
      if (container) {
        try {
          this.deps.removeContainer(container);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Persist with eviction (regenerable thumbnails are evicted before records)
  // -------------------------------------------------------------------------

  private async persistWithEviction(
    record: MyBlockThumbnailRecord,
  ): Promise<void> {
    const save = await this.storage.saveThumbnail(record);
    if (save.ok) {
      this.cacheRecord(record);
      return;
    }
    if (save.error.code !== "QUOTA_EXCEEDED") return;
    // Storage full — evict the OLDEST thumbnails first, then retry once.
    const evicted = await this.evictOldestThumbnails(record.byteSize);
    if (!evicted) return;
    const retry = await this.storage.saveThumbnail(record);
    if (retry.ok) this.cacheRecord(record);
  }

  private async evictOldestThumbnails(neededBytes: number): Promise<boolean> {
    const meta = await this.storage.listThumbnailMetadata();
    if (!meta.ok) return false;
    const ordered = [...meta.value].sort((a, b) =>
      a.generatedAt.localeCompare(b.generatedAt),
    );
    let freed = 0;
    let evicted = 0;
    for (const item of ordered) {
      if (freed >= neededBytes && evicted > 0) break;
      await this.storage.removeThumbnail(item.blockId);
      this.cache.delete(item.blockId);
      freed += item.byteSize;
      evicted += 1;
      if (freed >= neededBytes) break;
    }
    return evicted > 0;
  }

  // -------------------------------------------------------------------------
  // Retrieve (cached)
  // -------------------------------------------------------------------------

  async getRecord(
    blockId: string,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    const cached = this.cache.get(blockId);
    if (cached) return { ok: true, value: cached };
    const result = await this.storage.getThumbnail(blockId);
    if (result.ok) this.cacheRecord(result.value);
    return result;
  }

  async getMetadata(
    blockId: string,
  ): Promise<MyBlockResult<Omit<MyBlockThumbnailRecord, "data"> | null>> {
    const cached = this.cache.get(blockId);
    if (cached) {
      return { ok: true, value: toMetadata(cached) };
    }
    const result = await this.storage.getThumbnail(blockId);
    if (result.ok) {
      this.cacheRecord(result.value);
      return { ok: true, value: toMetadata(result.value) };
    }
    if (result.error.code === "THUMBNAIL_NOT_FOUND") {
      return { ok: true, value: null };
    }
    return { ok: false, error: result.error };
  }

  // -------------------------------------------------------------------------
  // Delete (called when the library record is deleted)
  // -------------------------------------------------------------------------

  async deleteForBlock(blockId: string): Promise<MyBlockResult<{ blockId: string }>> {
    this.cache.delete(blockId);
    return this.storage.removeThumbnail(blockId);
  }

  /** Evict everything from the in-memory cache (tests / memory pressure). */
  clearCache(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // Cache helpers
  // -------------------------------------------------------------------------

  private cacheRecord(record: MyBlockThumbnailRecord): void {
    if (this.cache.has(record.blockId)) {
      this.cache.delete(record.blockId);
    }
    this.cache.set(record.blockId, record);
    while (this.cache.size > MY_BLOCK_THUMBNAIL_CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }

  // -------------------------------------------------------------------------
  // Storage usage (metadata + thumbnails for quota display)
  // -------------------------------------------------------------------------

  async estimateUsage(): Promise<MyBlockResult<{ count: number; bytes: number }>> {
    return this.storage.estimateThumbnailUsage();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toMetadata(
  record: MyBlockThumbnailRecord,
): Omit<MyBlockThumbnailRecord, "data"> {
  return {
    blockId: record.blockId,
    revision: record.revision,
    generatedAt: record.generatedAt,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    byteSize: record.byteSize,
    hash: record.hash,
  };
}

/** SHA-256 via Web Crypto with a deterministic fallback (see thumbnail adapter). */
async function defaultHashFn(blob: Blob): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fall through
  }
  const bytes = await blob.arrayBuffer();
  const view = new Uint8Array(bytes);
  let seed = 0;
  const step = Math.max(1, Math.floor(view.length / 64));
  for (let i = 0; i < view.length; i += step) {
    seed = (seed * 31 + view[i]) | 0;
  }
  return `fnv-${view.length}-${seed >>> 0}`;
}

/** Quota policy metadata used by the UI. */
export const MY_BLOCK_THUMBNAIL_SOFT_LIMIT = MY_BLOCK_THUMBNAIL_SOFT_LIMIT_BYTES;

/** Re-export for tests that want the default MIME preference. */
export {
  MY_BLOCK_THUMBNAIL_MIME_PREFERENCE,
  MY_BLOCK_THUMBNAIL_MIME_FALLBACK,
  MY_BLOCK_THUMBNAIL_QUALITY,
};
