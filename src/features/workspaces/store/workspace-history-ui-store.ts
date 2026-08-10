"use client";

// ---------------------------------------------------------------------------
// Phase P15 — version history UI store (transient editor UI state)
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { ProjectVersionMeta } from "../types";

export type HistoryTab = "versions" | "activity";

interface WorkspaceHistoryUiState {
  dialogOpen: boolean;
  activeTab: HistoryTab;
  /** Version currently being previewed (read-only). */
  previewVersion: ProjectVersionMeta | null;
  /** Version queued for restore confirmation. */
  restoreVersion: ProjectVersionMeta | null;
  /** Version queued for copy (workspace or personal). */
  copyVersion: ProjectVersionMeta | null;

  openDialog: (tab?: HistoryTab) => void;
  closeDialog: () => void;
  setActiveTab: (tab: HistoryTab) => void;
  setPreviewVersion: (version: ProjectVersionMeta | null) => void;
  setRestoreVersion: (version: ProjectVersionMeta | null) => void;
  setCopyVersion: (version: ProjectVersionMeta | null) => void;
  reset: () => void;
}

export const useWorkspaceHistoryUiStore = create<WorkspaceHistoryUiState>()((set) => ({
  dialogOpen: false,
  activeTab: "versions",
  previewVersion: null,
  restoreVersion: null,
  copyVersion: null,

  openDialog: (tab) => set({ dialogOpen: true, activeTab: tab ?? "versions" }),
  closeDialog: () =>
    set({
      dialogOpen: false,
      previewVersion: null,
      restoreVersion: null,
      copyVersion: null,
    }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setPreviewVersion: (previewVersion) => set({ previewVersion }),
  setRestoreVersion: (restoreVersion) => set({ restoreVersion }),
  setCopyVersion: (copyVersion) => set({ copyVersion }),
  reset: () =>
    set({
      dialogOpen: false,
      activeTab: "versions",
      previewVersion: null,
      restoreVersion: null,
      copyVersion: null,
    }),
}));
