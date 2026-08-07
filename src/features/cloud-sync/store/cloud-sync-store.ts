// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — transient sync status store
//
// Pure UI state: current status, counts, last sync times, dialog visibility.
// NEVER persisted into ProjectSchema or editor history. The store is updated
// by the sync engine reporter and the lifecycle provider.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { CloudSyncError, CloudSyncStatus } from "../types";

export interface CloudSyncUiState {
  status: CloudSyncStatus;
  lastSuccessfulSyncAt: string | null;
  lastAttemptAt: string | null;
  pendingUploadCount: number;
  pendingDownloadCount: number;
  conflictCount: number;
  latestError: CloudSyncError | null;
  online: boolean;
  activeUserId: string | null;
  /** Bumped on every sync run (drives memoized derived status updates). */
  syncGeneration: number;

  // ---- Dialogs ----
  detailsOpen: boolean;
  conflictsOpen: boolean;
  initialMergeOpen: boolean;
  accountSettingsOpen: boolean;

  // ---- Actions ----
  setStatus: (status: CloudSyncStatus) => void;
  setLastSuccessfulSync: (at: string) => void;
  setPending: (upload: number, download: number) => void;
  setConflictCount: (count: number) => void;
  setError: (error: CloudSyncError | null) => void;
  setOnline: (online: boolean) => void;
  setActiveUser: (userId: string | null) => void;
  bumpGeneration: () => void;
  openDetails: () => void;
  closeDetails: () => void;
  openConflicts: () => void;
  closeConflicts: () => void;
  openInitialMerge: () => void;
  closeInitialMerge: () => void;
  openAccountSettings: () => void;
  closeAccountSettings: () => void;
  resetForSignOut: () => void;
}

export const useCloudSyncStore = create<CloudSyncUiState>()((set) => ({
  status: "signed-out",
  lastSuccessfulSyncAt: null,
  lastAttemptAt: null,
  pendingUploadCount: 0,
  pendingDownloadCount: 0,
  conflictCount: 0,
  latestError: null,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  activeUserId: null,
  syncGeneration: 0,

  detailsOpen: false,
  conflictsOpen: false,
  initialMergeOpen: false,
  accountSettingsOpen: false,

  setStatus: (status) => set({ status }),
  setLastSuccessfulSync: (at) => set({ lastSuccessfulSyncAt: at, lastAttemptAt: at }),
  setPending: (upload, download) => set({ pendingUploadCount: upload, pendingDownloadCount: download }),
  setConflictCount: (count) => set({ conflictCount: count }),
  setError: (error) => set({ latestError: error }),
  setOnline: (online) => set({ online }),
  setActiveUser: (userId) => set({ activeUserId: userId }),
  bumpGeneration: () => set((s) => ({ syncGeneration: s.syncGeneration + 1 })),

  openDetails: () => set({ detailsOpen: true }),
  closeDetails: () => set({ detailsOpen: false }),
  openConflicts: () => set({ conflictsOpen: true }),
  closeConflicts: () => set({ conflictsOpen: false }),
  openInitialMerge: () => set({ initialMergeOpen: true }),
  closeInitialMerge: () => set({ initialMergeOpen: false }),
  openAccountSettings: () => set({ accountSettingsOpen: true }),
  closeAccountSettings: () => set({ accountSettingsOpen: false }),

  resetForSignOut: () =>
    set({
      status: "signed-out",
      activeUserId: null,
      latestError: null,
      conflictCount: 0,
      pendingUploadCount: 0,
      pendingDownloadCount: 0,
      detailsOpen: false,
      conflictsOpen: false,
      initialMergeOpen: false,
      accountSettingsOpen: false,
    }),
}));
