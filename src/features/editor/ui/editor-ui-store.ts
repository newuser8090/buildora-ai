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
// Phase P22-K — panel shell state persists as UI-only localStorage prefs
// (never project state, never history).
import {
  DEFAULT_EDITOR_UI_PREFS,
  MAX_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  loadEditorUIPrefs,
  saveEditorUIPrefs,
  type EditorUIPrefs,
} from "./editor-ui-prefs";

export type RightSidebarTab = "structure" | "elements" | "data" | "design" | "blocks";

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

  // ---- Panel shell (Phase P22-K) — UI-only, persisted to localStorage ----
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  /** Re-read persisted panel prefs into state (safe no-op on first mount). */
  hydratePanelPrefs: () => void;
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

export const useEditorUiStore = create<EditorUiState>()((set, get) => ({
  rightSidebarTab: "design",
  setRightSidebarTab: (tab) => set({ rightSidebarTab: tab }),

  // ---- Panel shell (Phase P22-K) — hydrated from localStorage prefs ----
  ...panelPrefsToState(loadEditorUIPrefs()),
  setLeftPanelCollapsed: (collapsed) => {
    set({ leftPanelCollapsed: collapsed });
    persistPanelPrefs(get());
  },
  setRightPanelCollapsed: (collapsed) => {
    set({ rightPanelCollapsed: collapsed });
    persistPanelPrefs(get());
  },
  setLeftPanelWidth: (width) => {
    set({ leftPanelWidth: clampWidth(width) });
    persistPanelPrefs(get());
  },
  setRightPanelWidth: (width) => {
    set({ rightPanelWidth: clampWidth(width) });
    persistPanelPrefs(get());
  },
  hydratePanelPrefs: () => {
    set(panelPrefsToState(loadEditorUIPrefs()));
  },

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

// ---------------------------------------------------------------------------
// Panel shell helpers (Phase P22-K)
// ---------------------------------------------------------------------------

/** Map persisted prefs onto the store's panel fields. */
function panelPrefsToState(prefs: EditorUIPrefs): {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
} {
  return {
    leftPanelCollapsed: prefs.leftPanelCollapsed,
    rightPanelCollapsed: prefs.rightPanelCollapsed,
    leftPanelWidth: prefs.leftPanelWidth,
    rightPanelWidth: prefs.rightPanelWidth,
  };
}

/** Clamp an incoming width before it can enter store state. */
function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_EDITOR_UI_PREFS.leftPanelWidth;
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)));
}

/** Persist the current panel fields as one atomic localStorage blob. */
function persistPanelPrefs(state: {
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
}): void {
  saveEditorUIPrefs({
    leftPanelCollapsed: state.leftPanelCollapsed,
    rightPanelCollapsed: state.rightPanelCollapsed,
    leftPanelWidth: state.leftPanelWidth,
    rightPanelWidth: state.rightPanelWidth,
  });
}
