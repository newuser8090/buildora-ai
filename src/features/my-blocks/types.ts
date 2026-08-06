// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — core model
//
// A saved personal building block. Pure, serializable, framework-independent
// (no React, no DOM, no Zustand). The tree is a validated native BlockTree —
// raw pasted source code is NEVER stored, and no executable values ever live
// in a record.
//
// Phase P5 extensions (all optional → Phase P4 records stay valid):
//   - favorite?            — starred by the user (local metadata only)
//   - collectionIds?       — personal folders this block belongs to
//   - thumbnail?           — metadata reference to a separately-stored Blob
//   - contentRevision?     — increments only when the TREE changes; used to
//                            detect stale thumbnails without regenerating on
//                            rename/favorite/collection changes
// ---------------------------------------------------------------------------

import type { BlockTree, BlockType } from "@/features/blocks/types";
import type { ImportedCodeLanguage } from "@/features/code-import/types";

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export type MyBlockCategory =
  | "layout"
  | "text"
  | "media"
  | "buttons"
  | "cards"
  | "forms"
  | "navigation"
  | "complete-section"
  | "other";

export const MY_BLOCK_CATEGORIES: MyBlockCategory[] = [
  "layout",
  "text",
  "media",
  "buttons",
  "cards",
  "forms",
  "navigation",
  "complete-section",
  "other",
];

export function isMyBlockCategory(value: unknown): value is MyBlockCategory {
  return typeof value === "string" && (MY_BLOCK_CATEGORIES as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Source metadata — provenance, never content
// ---------------------------------------------------------------------------

export type MyBlockSource = "imported" | "created" | "duplicated";

export interface MyBlockSourceMetadata {
  source: MyBlockSource;
  /** Original code language when the block came from an import. */
  language?: ImportedCodeLanguage;
  /** Warning count reported by the import conversion, when known. */
  originalWarningCount?: number;
  /** Converter version that produced the tree, when known. */
  converterVersion?: number;
}

// ---------------------------------------------------------------------------
// Preview metadata — cheap, safe, computed at save time
// ---------------------------------------------------------------------------

export interface MyBlockPreviewMetadata {
  blockCount: number;
  rootType: BlockType;
  containsMedia: boolean;
  containsInteractive: boolean;
}

// ---------------------------------------------------------------------------
// Thumbnail metadata — a REFERENCE only (the Blob lives in its own store)
// ---------------------------------------------------------------------------

/**
 * Persisted thumbnail metadata stored on the record. The binary image data
 * NEVER lives inside MyBlockRecord — it is stored in the dedicated
 * myBlockThumbnails object store and referenced by blockId.
 */
export interface MyBlockThumbnailMetadata {
  /** Content revision of the tree this image represents (stale check). */
  revision: number;
  /** ISO timestamp of generation. */
  generatedAt: string;
  mimeType: "image/webp" | "image/png";
  width: number;
  height: number;
  byteSize: number;
  /** Content hash of the encoded image (dedup / corruption detection). */
  hash: string;
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export interface MyBlockRecord {
  /** Library record id (never reused across imports/duplicates). */
  id: string;
  /** Schema/format version for migration readiness. */
  version: number;
  name: string;
  description?: string;
  category: MyBlockCategory;
  /** Max MY_BLOCK_MAX_TAGS tags, each trimmed + length-capped. */
  tags: string[];
  /** The validated native BlockTree. Internal template ids are allowed. */
  tree: BlockTree;
  createdAt: string;
  updatedAt: string;
  sourceMetadata?: MyBlockSourceMetadata;
  previewMetadata: MyBlockPreviewMetadata;
  /** Optional lightweight usage metadata (UI only). */
  lastUsedAt?: string;
  useCount?: number;
  /** Phase P5: starred by the user. Local metadata, never project history. */
  favorite?: boolean;
  /** Phase P5: personal collection/folder ids this block belongs to. */
  collectionIds?: string[];
  /** Phase P5: thumbnail metadata reference (Blob stored separately). */
  thumbnail?: MyBlockThumbnailMetadata;
  /** Phase P5: increments only when the TREE changes (thumbnail staleness). */
  contentRevision?: number;
}

// ---------------------------------------------------------------------------
// Collections (Phase P5)
// ---------------------------------------------------------------------------

export interface MyBlockCollection {
  id: string;
  /** Schema/format version (currently 1). */
  version: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Deterministic tiebreak for the collections list (0, 1, 2, …). */
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Sort options (deterministic)
// ---------------------------------------------------------------------------

export type MyBlockSortOption =
  | "recent"        // recently updated
  | "recently-used" // recently inserted (lastUsedAt)
  | "oldest"        // oldest first (createdAt)
  | "name-asc"      // name A–Z
  | "name-desc"     // name Z–A
  | "most-used";    // useCount desc

// ---------------------------------------------------------------------------
// Storage / service result shapes
// ---------------------------------------------------------------------------

export type MyBlockErrorCode =
  | "BLOCK_NOT_FOUND"
  | "INVALID_RECORD"
  | "QUOTA_EXCEEDED"
  | "RECORD_TOO_LARGE"
  | "STORAGE_UNAVAILABLE"
  | "DATABASE_OPEN_FAILED"
  | "TRANSACTION_FAILED"
  | "UNKNOWN_ERROR"
  | "INVALID_NAME"
  | "INVALID_TARGET"
  | "EMPTY_LIBRARY"
  | "COLLECTION_NOT_FOUND"
  | "DUPLICATE_COLLECTION_NAME"
  | "THUMBNAIL_NOT_FOUND"
  | "THUMBNAIL_GENERATION_FAILED";

export interface MyBlockError {
  code: MyBlockErrorCode;
  message: string;
  cause?: string;
}

export type MyBlockResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MyBlockError };

// ---------------------------------------------------------------------------
// Adapter interface (swap-in for tests)
// ---------------------------------------------------------------------------

export interface MyBlocksStorageAdapter {
  listMyBlocks(): Promise<MyBlockResult<MyBlockRecord[]>>;
  getMyBlock(id: string): Promise<MyBlockResult<MyBlockRecord>>;
  createMyBlock(input: CreateMyBlockInput): Promise<MyBlockResult<MyBlockRecord>>;
  updateMyBlock(id: string, patch: UpdateMyBlockPatch): Promise<MyBlockResult<MyBlockRecord>>;
  deleteMyBlock(id: string): Promise<MyBlockResult<{ id: string }>>;
  duplicateMyBlock(id: string): Promise<MyBlockResult<MyBlockRecord>>;
  clearMyBlocksForTests(): Promise<void>;

  // ---- Collections (Phase P5) ----
  listMyBlockCollections(): Promise<MyBlockResult<MyBlockCollection[]>>;
  getMyBlockCollection(id: string): Promise<MyBlockResult<MyBlockCollection>>;
  createMyBlockCollection(
    input: CreateMyBlockCollectionInput,
  ): Promise<MyBlockResult<MyBlockCollection>>;
  updateMyBlockCollection(
    id: string,
    patch: UpdateMyBlockCollectionPatch,
  ): Promise<MyBlockResult<MyBlockCollection>>;
  /**
   * Delete a collection. Blocks are NEVER deleted — each block's
   * collectionIds is cleaned of the removed id.
   */
  deleteMyBlockCollection(id: string): Promise<MyBlockResult<{ id: string }>>;
}

// ---------------------------------------------------------------------------
// Input / patch shapes
// ---------------------------------------------------------------------------

export interface CreateMyBlockInput {
  name: string;
  description?: string;
  category: MyBlockCategory;
  tags?: string[];
  tree: BlockTree;
  sourceMetadata?: MyBlockSourceMetadata;
  /** Injectable id factory (deterministic tests). */
  idFactory?: () => string;
  /** Injectable clock (deterministic tests). */
  clock?: () => Date;
}

export interface UpdateMyBlockPatch {
  name?: string;
  description?: string;
  category?: MyBlockCategory;
  tags?: string[];
  /** Usage metadata updates (library metadata only, never project history). */
  lastUsedAt?: string;
  useCount?: number;
  /** Phase P5: star toggle. */
  favorite?: boolean;
  /** Phase P5: replace the block's collection membership. */
  collectionIds?: string[];
  /** Phase P5: thumbnail metadata reference (Blob lives in its own store). */
  thumbnail?: MyBlockThumbnailMetadata | null;
  /** Phase P5: tree content epoch (thumbnail staleness). */
  contentRevision?: number;
}

export interface CreateMyBlockCollectionInput {
  name: string;
  description?: string;
  /** Injectable id factory (deterministic tests). */
  idFactory?: () => string;
  /** Injectable clock (deterministic tests). */
  clock?: () => Date;
}

export interface UpdateMyBlockCollectionPatch {
  name?: string;
  description?: string;
  sortOrder?: number;
}
