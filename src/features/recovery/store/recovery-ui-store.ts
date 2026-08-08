// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — UI store
//
// Owns open state for the recovery dialog. The editor can open it manually
// ("Backups") or automatically when a project fails to load.
// ---------------------------------------------------------------------------

import { create } from "zustand";

interface RecoveryUiState {
  open: boolean;
  projectId: string | null;
  openRecovery: (projectId: string) => void;
  closeRecovery: () => void;
}

export const useRecoveryUiStore = create<RecoveryUiState>((set) => ({
  open: false,
  projectId: null,
  openRecovery: (projectId) => set({ open: true, projectId }),
  closeRecovery: () => set({ open: false, projectId: null }),
}));
