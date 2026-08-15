// ---------------------------------------------------------------------------
// Element Library (Phase P22-D) — catalog types
//
// The library is a REUSABLE discovery + insertion surface over the existing
// element registry. Items are derived from registered element definitions
// (block types only — every exposed item must have a valid render + persist
// path today). The catalog stays centralized and framework-independent; the
// UI layer renders it.
// ---------------------------------------------------------------------------

import type { BlockType } from "@/features/blocks/types";

/** User-facing categories. Each maps 1:1 to an element-registry category. */
export type LibraryCategoryId =
  | "layout"
  | "content"
  | "interactive"
  | "composite"
  | "navigation";

export interface LibraryCategory {
  id: LibraryCategoryId;
  label: string;
  description: string;
}

/** One discoverable library item (derived from the element registry). */
export interface LibraryItem {
  /** The element/block type to create on insert. */
  type: BlockType;
  label: string;
  description: string;
  iconKey: string;
  category: LibraryCategoryId;
  keywords: string[];
  beginnerFriendly: boolean;
  canHaveChildren: boolean;
}

/** Where a library insert lands. */
export type LibraryInsertionMode = "inside-selected" | "new-section";

/** Structured insertion result. */
export type InsertLibraryElementResult =
  | {
      ok: true;
      sectionId: string;
      pageId: string;
      /** The newly created block id (root of the inserted section). */
      blockId: string;
      mode: LibraryInsertionMode;
    }
  | { ok: false; error: { code: string; message: string } };
