// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — thumbnail types
//
// Persistent visual previews for saved blocks. The binary image lives in the
// dedicated myBlockThumbnails object store (keyed by blockId); MyBlockRecord
// holds ONLY metadata (MyBlockThumbnailMetadata) as a reference. Thumbnails
// are generated from the validated native BlockTree — never from pasted
// source, never from executable values.
// ---------------------------------------------------------------------------

import type { MyBlockResult } from "../types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Source/output thumbnail dimensions (16:10, matching project thumbnails). */
export const MY_BLOCK_THUMBNAIL_WIDTH = 480;
export const MY_BLOCK_THUMBNAIL_HEIGHT = 300;

/** Preferred/fallback MIME types. */
export const MY_BLOCK_THUMBNAIL_MIME_PREFERENCE = "image/webp" as const;
export const MY_BLOCK_THUMBNAIL_MIME_FALLBACK = "image/png" as const;

/** Encoding quality for lossy formats. */
export const MY_BLOCK_THUMBNAIL_QUALITY = 0.82;

/** Overall render+capture timeout (ms). */
export const MY_BLOCK_THUMBNAIL_RENDER_TIMEOUT_MS = 10_000;

/** Asset/font readiness wait (ms). */
export const MY_BLOCK_THUMBNAIL_ASSET_WAIT_MS = 4_000;

/** Bounded in-memory Blob/record cache size (entries). */
export const MY_BLOCK_THUMBNAIL_CACHE_MAX = 60;

/** Maximum bytes of thumbnail data before eviction starts (4 MB). */
export const MY_BLOCK_THUMBNAIL_SOFT_LIMIT_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Persisted record (IndexedDB blob store)
// ---------------------------------------------------------------------------

export interface MyBlockThumbnailRecord {
  /** Owning My Block record id (also the IndexedDB key). */
  blockId: string;
  /** Content revision of the tree this image represents. */
  revision: number;
  /** ISO timestamp of generation. */
  generatedAt: string;
  mimeType: "image/webp" | "image/png";
  width: number;
  height: number;
  byteSize: number;
  /** Content hash of the encoded image (dedup / corruption detection). */
  hash: string;
  /** Binary image data — never base64 JSON. */
  data: Blob;
}

// ---------------------------------------------------------------------------
// UI status
// ---------------------------------------------------------------------------

export type MyBlockThumbnailStatus =
  | "idle"      // not requested yet (off-screen)
  | "loading"
  | "ready"
  | "error"
  | "missing"; // record says thumbnail exists but the blob is gone/corrupt

// ---------------------------------------------------------------------------
// Storage adapter interface
// ---------------------------------------------------------------------------

export interface MyBlockThumbnailStorageAdapter {
  getThumbnail(blockId: string): Promise<MyBlockResult<MyBlockThumbnailRecord>>;
  saveThumbnail(
    record: MyBlockThumbnailRecord,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>>;
  removeThumbnail(blockId: string): Promise<MyBlockResult<{ blockId: string }>>;
  /** Metadata only (no Blobs) — used by quota accounting + lazy lists. */
  listThumbnailMetadata(): Promise<
    MyBlockResult<Array<Omit<MyBlockThumbnailRecord, "data">>>
  >;
  estimateThumbnailUsage(): Promise<MyBlockResult<{ count: number; bytes: number }>>;
  close(): void;
}
