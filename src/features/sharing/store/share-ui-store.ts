// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — transient UI store
//
// Ephemeral dialog state only. All data comes from the server through the
// ShareLinkService; this store coordinates which surface is open. The
// canonical ShareDialog is the ONE surface every entry point opens.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export type ShareDialogTab = "create" | "manage" | "feedback";

export interface ShareUiState {
  /** Canonical share dialog open state. */
  dialogOpen: boolean;
  /** Active tab inside the dialog. */
  tab: ShareDialogTab;
  /** Bump to re-fetch the link list / comments. */
  refreshTick: number;

  openShareDialog: (tab?: ShareDialogTab) => void;
  closeShareDialog: () => void;
  setTab: (tab: ShareDialogTab) => void;
  bumpRefresh: () => void;
}

export const useShareUiStore = create<ShareUiState>()((set) => ({
  dialogOpen: false,
  tab: "create",
  refreshTick: 0,

  openShareDialog: (tab = "create") => set({ dialogOpen: true, tab }),
  closeShareDialog: () => set({ dialogOpen: false }),
  setTab: (tab) => set({ tab }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));

/** Open the canonical share surface (used by TopNav + command palette). */
export function openShareDialog(tab: ShareDialogTab = "create"): void {
  useShareUiStore.getState().openShareDialog(tab);
}
