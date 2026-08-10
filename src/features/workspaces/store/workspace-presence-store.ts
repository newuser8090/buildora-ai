"use client";

// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: workspace presence store
//
// TRANSIENT UI state only — presence is ephemeral collaboration state with a
// server-side TTL. Scoped by the active (workspaceId, projectId); resets on
// sign-out / scope change. The server is the only source of truth: sessions
// are stored here only after a successful fetch (never guessed locally), so
// the UI can't display fake live state.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { WorkspacePresence } from "../types";

export interface WorkspacePresenceState {
  /** Active scope (null when no workspace project is open). */
  workspaceId: string | null;
  projectId: string | null;
  /** Raw sessions (one per tab) for the active scope, newest-joined first. */
  sessions: WorkspacePresence[];
  /** True while a presence session is joined and being heartbeated. */
  active: boolean;
  /** True when the last presence read failed (connection lost — show nothing). */
  disconnected: boolean;
  lastUpdatedAt: string | null;

  setScope: (workspaceId: string | null, projectId: string | null) => void;
  setSessions: (sessions: WorkspacePresence[]) => void;
  setActive: (active: boolean) => void;
  setDisconnected: (disconnected: boolean) => void;
  reset: () => void;
}

export const useWorkspacePresenceStore = create<WorkspacePresenceState>()((set) => ({
  workspaceId: null,
  projectId: null,
  sessions: [],
  active: false,
  disconnected: false,
  lastUpdatedAt: null,

  setScope: (workspaceId, projectId) =>
    set({ workspaceId, projectId, sessions: [], lastUpdatedAt: null }),
  setSessions: (sessions) =>
    set({ sessions, disconnected: false, lastUpdatedAt: new Date().toISOString() }),
  setActive: (active) => set({ active }),
  setDisconnected: (disconnected) => set({ disconnected }),
  reset: () =>
    set({
      workspaceId: null,
      projectId: null,
      sessions: [],
      active: false,
      disconnected: false,
      lastUpdatedAt: null,
    }),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** Presence sessions for OTHER users in the active scope (self filtered out). */
export function selectOtherSessions(state: WorkspacePresenceState, ownUserId: string | null) {
  return state.sessions
    .filter((s) => s.userId !== ownUserId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

/** Dedupe sessions by user (a user with two tabs appears once, most recent first). */
export function dedupeByUser(sessions: WorkspacePresence[]): WorkspacePresence[] {
  const byUser = new Map<string, WorkspacePresence>();
  for (const session of sessions) {
    const existing = byUser.get(session.userId);
    if (!existing || session.joinedAt > existing.joinedAt) {
      byUser.set(session.userId, session);
    }
  }
  return [...byUser.values()];
}
