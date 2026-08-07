// ---------------------------------------------------------------------------
// Site Settings — UI store (Phase P7)
//
// Ephemeral UI state only. The actual settings live in ProjectSchema and are
// edited through the editor store's updateSiteSettings (one history entry).
// ---------------------------------------------------------------------------

import { create } from "zustand";

export type SiteSettingsTab = "basics" | "search" | "icon" | "advanced";

interface SiteSettingsUiState {
  dialogOpen: boolean;
  initialTab: SiteSettingsTab;
  openDialog: (tab?: SiteSettingsTab) => void;
  closeDialog: () => void;
}

export const useSiteSettingsUiStore = create<SiteSettingsUiState>()((set) => ({
  dialogOpen: false,
  initialTab: "basics",
  openDialog: (tab) => set({ dialogOpen: true, initialTab: tab ?? "basics" }),
  closeDialog: () => set({ dialogOpen: false }),
}));
