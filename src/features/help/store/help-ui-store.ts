// ---------------------------------------------------------------------------
// Help (Phase P9) — UI store
//
// Owns open state for the keyboard-shortcuts dialog and the lightweight
// help panel. No data logic.
// ---------------------------------------------------------------------------

import { create } from "zustand";

interface HelpUiState {
  shortcutsDialogOpen: boolean;
  helpPanelOpen: boolean;
  openShortcutsDialog: () => void;
  closeShortcutsDialog: () => void;
  openHelpPanel: () => void;
  closeHelpPanel: () => void;
}

export const useHelpUiStore = create<HelpUiState>((set) => ({
  shortcutsDialogOpen: false,
  helpPanelOpen: false,
  openShortcutsDialog: () => set({ shortcutsDialogOpen: true }),
  closeShortcutsDialog: () => set({ shortcutsDialogOpen: false }),
  openHelpPanel: () => set({ helpPanelOpen: true }),
  closeHelpPanel: () => set({ helpPanelOpen: false }),
}));
