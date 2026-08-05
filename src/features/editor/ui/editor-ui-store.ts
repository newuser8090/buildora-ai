// ---------------------------------------------------------------------------
// Editor UI store — ephemeral UI state only
//
// NOT persisted, NOT part of the Project model, NOT part of history.
// Holds the right-sidebar active tab and the Add Section dialog visibility.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { SectionInsertPosition } from "@/features/editor/store/section-structure";
import { useCodeImportStore } from "@/features/code-import/store/code-import-store";
import type { ImportInsertionTarget } from "@/features/code-import/store/code-import-store";

export type RightSidebarTab = "structure" | "design" | "blocks";

export interface AddSectionDialogState {
  open: boolean;
  /** Optional preset — when set, the dialog preselects this section type. */
  initialType?: string;
  /** Optional preset insertion position (Phase N insertion points). */
  initialPosition?: SectionInsertPosition;
}

interface EditorUiState {
  rightSidebarTab: RightSidebarTab;
  setRightSidebarTab: (tab: RightSidebarTab) => void;
  addSectionDialog: AddSectionDialogState;
  openAddSectionDialog: (options?: {
    initialType?: string;
    initialPosition?: SectionInsertPosition;
  }) => void;
  closeAddSectionDialog: () => void;
  /**
   * Where the last selection change originated. Used by the canvas + structure
   * panel selection-sync effects to avoid re-centering/scroll jumps on
   * user-initiated clicks (they only scroll for non-self-origin selections).
   */
  selectionSource: "canvas" | "structure" | null;
  setSelectionSource: (source: "canvas" | "structure" | null) => void;

  // ---- Import Studio (Phase P3) — opens the shared CodeImportDialog ----
  openCodeImportDialog: (target?: ImportInsertionTarget | null) => void;
  closeCodeImportDialog: () => void;
}

export const useEditorUiStore = create<EditorUiState>()((set) => ({
  rightSidebarTab: "design",
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),

  addSectionDialog: { open: false, initialType: undefined, initialPosition: undefined },
  openAddSectionDialog: (options) =>
    set({
      addSectionDialog: {
        open: true,
        initialType: options?.initialType,
        initialPosition: options?.initialPosition,
      },
    }),
  closeAddSectionDialog: () =>
    set({
      addSectionDialog: {
        open: false,
        initialType: undefined,
        initialPosition: undefined,
      },
    }),

  selectionSource: null,
  setSelectionSource: (source) => set({ selectionSource: source }),

  openCodeImportDialog: (target) => {
    useCodeImportStore.getState().openDialog(target ?? null);
  },
  closeCodeImportDialog: () => {
    useCodeImportStore.getState().closeDialog();
  },
}));
