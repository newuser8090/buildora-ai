// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — transient UI store
//
// Ephemeral dialog open state only. Library data lives in the cloud and is
// fetched on demand; this store coordinates which panel/dialog is visible.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export type ManageDialogState =
  | { mode: "manage"; libraryId: string }
  | null;

export type DetailsDialogState =
  | { libraryId: string }
  | null;

export type CreateDialogState = { open: boolean };

export interface SharedLibrariesUiState {
  panelOpen: boolean;
  createOpen: boolean;
  manageDialog: ManageDialogState;
  detailsDialog: DetailsDialogState;
  inviteDialog: { libraryId: string } | null;
  /** Owner/editor picker for adding pieces to a library. */
  addBlocksDialog: { libraryId: string } | null;
  /** Refresh tick — bump to re-fetch the listing. */
  refreshTick: number;

  openPanel: () => void;
  closePanel: () => void;
  openCreate: () => void;
  closeCreate: () => void;
  openManage: (libraryId: string) => void;
  closeManage: () => void;
  openDetails: (libraryId: string) => void;
  closeDetails: () => void;
  openInvite: (libraryId: string) => void;
  closeInvite: () => void;
  openAddBlocks: (libraryId: string) => void;
  closeAddBlocks: () => void;
  bumpRefresh: () => void;
}

export const useSharedLibrariesUiStore = create<SharedLibrariesUiState>()((set) => ({
  panelOpen: false,
  createOpen: false,
  manageDialog: null,
  detailsDialog: null,
  inviteDialog: null,
  addBlocksDialog: null,
  refreshTick: 0,

  openPanel: () => set({ panelOpen: true }),
  closePanel: () =>
    set({
      panelOpen: false,
      manageDialog: null,
      detailsDialog: null,
      inviteDialog: null,
      addBlocksDialog: null,
    }),
  openCreate: () => set({ createOpen: true }),
  closeCreate: () => set({ createOpen: false }),
  openManage: (libraryId) => set({ manageDialog: { mode: "manage", libraryId } }),
  closeManage: () => set({ manageDialog: null }),
  openDetails: (libraryId) => set({ detailsDialog: { libraryId } }),
  closeDetails: () => set({ detailsDialog: null }),
  openInvite: (libraryId) => set({ inviteDialog: { libraryId } }),
  closeInvite: () => set({ inviteDialog: null }),
  openAddBlocks: (libraryId) => set({ addBlocksDialog: { libraryId } }),
  closeAddBlocks: () => set({ addBlocksDialog: null }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
