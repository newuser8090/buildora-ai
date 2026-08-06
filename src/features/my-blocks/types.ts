// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — core model
//
// A saved personal building block. Pure, serializable, framework-independent
// (no React, no DOM, no Zustand). The tree is a validated native BlockTree —
// raw pasted source code is NEVER stored, and no executable values ever live
// in a record.
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
}

// ---------------------------------------------------------------------------
// Sort options (deterministic)
// ---------------------------------------------------------------------------

export type MyBlockSortOption = "recent" | "oldest" | "name";

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
  | "EMPTY_LIBRARY";

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
}
