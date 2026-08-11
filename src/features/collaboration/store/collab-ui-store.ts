// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — collab UI store
//
// TRANSIENT UI state (like workspace-access-store): sync status, maintenance
// lock state, and last remote actor. Resets on session end / project switch /
// sign-out. Never an authorization source.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { CollabSyncStatus } from "../types";

/** The remote-change hint auto-hides after this long (UI-derived). */
const HINT_HIDE_MS = 4000;

export interface CollabUiState {
  /** Editor-visible collaboration sync status. */
  status: CollabSyncStatus;
  /** True while a maintenance operation (restore/import) holds the room. */
  maintenance: boolean;
  /** Last remote actor display name (batched, debounced — never spam). */
  lastActorName: string | null;
  /** Last remote change description (e.g. "updated the homepage"). */
  lastChangeLabel: string | null;

  // ---- Actions ----
  setStatus: (status: CollabSyncStatus) => void;
  setMaintenance: (maintenance: boolean) => void;
  setLastChange: (actorName: string | null, changeLabel: string | null) => void;
  reset: () => void;
}

let hintTimer: ReturnType<typeof setTimeout> | null = null;

export const useCollabUiStore = create<CollabUiState>()((set) => ({
  status: "idle",
  maintenance: false,
  lastActorName: null,
  lastChangeLabel: null,

  setStatus: (status) => set({ status }),
  setMaintenance: (maintenance) => set({ maintenance }),
  setLastChange: (actorName, changeLabel) => {
    // Show the hint now and auto-hide it after a short window (never a toast
    // per character — the session batches updates before calling this).
    set({ lastActorName: actorName, lastChangeLabel: changeLabel });
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hintTimer = null;
      set({ lastActorName: null, lastChangeLabel: null });
    }, HINT_HIDE_MS);
  },
  reset: () => {
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = null;
    set({
      status: "idle",
      maintenance: false,
      lastActorName: null,
      lastChangeLabel: null,
    });
  },
}));
