// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — transient UI store
//
// Ephemeral UI state only: dialog open state, which dialog is showing, and a
// refresh tick. Never persisted, never part of project history, never in
// ProjectSchema. The library data itself lives in IndexedDB; this store only
// coordinates the dialogs.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { BaseSection } from "@/types/section";
import type { BlockTree } from "@/features/blocks/types";
import type {
  MyBlockCollection,
  MyBlockRecord,
  MyBlockSourceMetadata,
} from "../types";

// ---------------------------------------------------------------------------
// Save dialog source
// ---------------------------------------------------------------------------

export type SaveMyBlockSource =
  | { kind: "tree"; tree: BlockTree; suggestedName: string; sourceMetadata?: MyBlockSourceMetadata }
  | { kind: "section"; section: BaseSection };

export type CollectionDialogState =
  | { mode: "create" }
  | { mode: "rename"; collection: MyBlockCollection }
  | null;

export interface MyBlocksUiState {
  // ---- Library dialog ----
  libraryOpen: boolean;
  openLibrary: () => void;
  closeLibrary: () => void;

  // ---- Save dialog ----
  saveSource: SaveMyBlockSource | null;
  openSaveDialog: (source: SaveMyBlockSource) => void;
  closeSaveDialog: () => void;

  // ---- Details dialog ----
  detailsBlockId: string | null;
  openDetails: (id: string) => void;
  closeDetails: () => void;

  // ---- Rename dialog ----
  renameBlockId: string | null;
  openRename: (id: string) => void;
  closeRename: () => void;

  // ---- Delete dialog ----
  deleteBlockId: string | null;
  openDelete: (id: string) => void;
  closeDelete: () => void;

  // ---- Import dialog ----
  importOpen: boolean;
  openImport: () => void;
  closeImport: () => void;

  // ---- Placement picker (Phase P5) ----
  placementBlock: MyBlockRecord | null;
  openPlacementPicker: (block: MyBlockRecord) => void;
  closePlacementPicker: () => void;

  // ---- Collection dialog (Phase P5) ----
  collectionDialog: CollectionDialogState;
  openCreateCollection: () => void;
  openRenameCollection: (collection: MyBlockCollection) => void;
  closeCollectionDialog: () => void;

  // ---- Move-to-collection (Phase P5) ----
  moveBlockIds: string[] | null;
  openMoveToCollection: (blockIds: string[]) => void;
  closeMoveToCollection: () => void;

  // ---- Bulk delete confirmation (Phase P5) ----
  bulkDeleteBlockIds: string[] | null;
  openBulkDelete: (blockIds: string[]) => void;
  closeBulkDelete: () => void;

  // ---- Toast (status announcements) ----
  toast: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;

  // ---- Refresh tick — bump to force the library to re-list ----
  refreshTick: number;
  bumpRefresh: () => void;
}

export const useMyBlocksUiStore = create<MyBlocksUiState>()((set) => ({
  libraryOpen: false,
  openLibrary: () => set({ libraryOpen: true }),
  closeLibrary: () =>
    set({
      libraryOpen: false,
      detailsBlockId: null,
      renameBlockId: null,
      deleteBlockId: null,
      placementBlock: null,
      moveBlockIds: null,
      bulkDeleteBlockIds: null,
    }),

  saveSource: null,
  openSaveDialog: (source) => set({ saveSource: source }),
  closeSaveDialog: () => set({ saveSource: null }),

  detailsBlockId: null,
  openDetails: (id) => set({ detailsBlockId: id }),
  closeDetails: () => set({ detailsBlockId: null }),

  renameBlockId: null,
  openRename: (id) => set({ renameBlockId: id }),
  closeRename: () => set({ renameBlockId: null }),

  deleteBlockId: null,
  openDelete: (id) => set({ deleteBlockId: id }),
  closeDelete: () => set({ deleteBlockId: null }),

  importOpen: false,
  openImport: () => set({ importOpen: true }),
  closeImport: () => set({ importOpen: false }),

  placementBlock: null,
  openPlacementPicker: (block) => set({ placementBlock: block }),
  closePlacementPicker: () => set({ placementBlock: null }),

  collectionDialog: null,
  openCreateCollection: () => set({ collectionDialog: { mode: "create" } }),
  openRenameCollection: (collection) =>
    set({ collectionDialog: { mode: "rename", collection } }),
  closeCollectionDialog: () => set({ collectionDialog: null }),

  moveBlockIds: null,
  openMoveToCollection: (blockIds) => set({ moveBlockIds: blockIds }),
  closeMoveToCollection: () => set({ moveBlockIds: null }),

  bulkDeleteBlockIds: null,
  openBulkDelete: (blockIds) => set({ bulkDeleteBlockIds: blockIds }),
  closeBulkDelete: () => set({ bulkDeleteBlockIds: null }),

  toast: null,
  showToast: (message) => set({ toast: message }),
  clearToast: () => set({ toast: null }),

  refreshTick: 0,
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
