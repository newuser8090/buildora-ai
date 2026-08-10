// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — dashboard store
//
// Owns dashboard-scope workspace state:
//   - the selected workspace context (null = Personal view)
//   - owned/shared workspace listings (lazy-fetched)
//   - pending invitations for the current user
//   - workspace projects for the selected workspace
//   - loading / error state
//
// This store is TRANSIENT UI state. It resets on sign-out / account switch so
// one account's workspace context can never leak into the next session. It is
// NEVER an authorization source — the server decides access.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type {
  Workspace,
  WorkspaceInvitation,
  WorkspaceProjectSummary,
} from "../types";

export interface WorkspaceDashboardState {
  /** Selected workspace id (null = Personal view). */
  selectedWorkspaceId: string | null;
  /** Workspaces owned by the current user. */
  owned: Workspace[];
  /** Workspaces the current user belongs to (not owner). */
  shared: Workspace[];
  /** Pending invitations for the current user (recipient-scoped). */
  invitations: WorkspaceInvitation[];
  /** Projects in the selected workspace (server-authoritative summaries). */
  workspaceProjects: WorkspaceProjectSummary[];
  /** True while workspace data loads. */
  loading: boolean;
  /** Dashboard-scope error (workspace list/project fetch). */
  error: string | null;
  /** True when the workspace backend is unavailable (local-only mode). */
  unavailable: boolean;

  // ---- Actions ----
  setSelectedWorkspaceId: (id: string | null) => void;
  setWorkspaces: (owned: Workspace[], shared: Workspace[]) => void;
  setInvitations: (invitations: WorkspaceInvitation[]) => void;
  setWorkspaceProjects: (projects: WorkspaceProjectSummary[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setUnavailable: (unavailable: boolean) => void;
  /** Clear the selected workspace's projects + selection (workspace deleted / access lost). */
  clearWorkspaceContext: (workspaceId: string) => void;
  /** Reset everything on sign-out / account switch. */
  reset: () => void;
}

export const useWorkspaceDashboardStore = create<WorkspaceDashboardState>()(
  (set) => ({
    selectedWorkspaceId: null,
    owned: [],
    shared: [],
    invitations: [],
    workspaceProjects: [],
    loading: false,
    error: null,
    unavailable: false,

    setSelectedWorkspaceId: (id) => set({ selectedWorkspaceId: id }),
    setWorkspaces: (owned, shared) => set({ owned, shared }),
    setInvitations: (invitations) => set({ invitations }),
    setWorkspaceProjects: (projects) => set({ workspaceProjects: projects }),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error }),
    setUnavailable: (unavailable) => set({ unavailable }),
    clearWorkspaceContext: (workspaceId) =>
      set((s) => ({
        selectedWorkspaceId: s.selectedWorkspaceId === workspaceId ? null : s.selectedWorkspaceId,
        owned: s.owned.filter((w) => w.id !== workspaceId),
        shared: s.shared.filter((w) => w.id !== workspaceId),
        workspaceProjects:
          s.selectedWorkspaceId === workspaceId ? [] : s.workspaceProjects,
      })),
    reset: () =>
      set({
        selectedWorkspaceId: null,
        owned: [],
        shared: [],
        invitations: [],
        workspaceProjects: [],
        loading: false,
        error: null,
        unavailable: false,
      }),
  }),
);
