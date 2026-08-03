// ---------------------------------------------------------------------------
// Editor UI store — ephemeral UI state only
//
// NOT persisted, NOT part of the Project model, NOT part of history.
// Holds the right-sidebar active tab and the Add Section dialog visibility.
// ---------------------------------------------------------------------------

import { create } from "zustand";

export type RightSidebarTab = "structure" | "design";

export interface AddSectionDialogState {
  open: boolean;
  /** Optional preset — when set, the dialog preselects this section type. */
  initialType?: string;
}

interface EditorUiState {
  rightSidebarTab: RightSidebarTab;
  setRightSidebarTab: (tab: RightSidebarTab) => void;
  addSectionDialog: AddSectionDialogState;
  openAddSectionDialog: (options?: { initialType?: string }) => void;
  closeAddSectionDialog: () => void;
  /**
   * Where the last selection change originated. Used by the canvas + structure
   * panel selection-sync effects to avoid re-centering/scroll jumps on
   * user-initiated clicks (they only scroll for non-self-origin selections).
   */
  selectionSource: "canvas" | "structure" | null;
  setSelectionSource: (source: "canvas" | "structure" | null) => void;
}

export const useEditorUiStore = create<EditorUiState>()((set) => ({
  rightSidebarTab: "design",
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),

  addSectionDialog: { open: false, initialType: undefined },
  openAddSectionDialog: (options) =>
    set({ addSectionDialog: { open: true, initialType: options?.initialType } }),
  closeAddSectionDialog: () => set({ addSectionDialog: { open: false, initialType: undefined } }),

  selectionSource: null,
  setSelectionSource: (source) => set({ selectionSource: source }),
}));
