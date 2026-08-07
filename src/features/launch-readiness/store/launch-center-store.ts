// ---------------------------------------------------------------------------
// Launch Center — UI store (Phase P7)
//
// Ephemeral UI state only. The readiness report itself is derived by the
// hook from real project state.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { LaunchCategoryId } from "../types";

interface LaunchCenterState {
  open: boolean;
  /** Optional category filter when opened from a specific section. */
  focusedCategory: LaunchCategoryId | null;
  openLaunchCenter: (category?: LaunchCategoryId) => void;
  closeLaunchCenter: () => void;
}

export const useLaunchCenterStore = create<LaunchCenterState>()((set) => ({
  open: false,
  focusedCategory: null,
  openLaunchCenter: (category) =>
    set({ open: true, focusedCategory: category ?? null }),
  closeLaunchCenter: () => set({ open: false, focusedCategory: null }),
}));
