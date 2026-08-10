// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — editor access store
//
// Standalone Zustand store (NO editor-store import — the editor store imports
// THIS store's getState() to enforce the read-only boundary, so a circular
// dependency is impossible). Owns:
//   - the EditorAccessContext (editable / readonly + reason)
//   - the workspace context of the active project
//   - the current edit lease (client mirror of the server lease)
//   - server revision + save-conflict state
//
// This store is TRANSIENT UI state. It resets on sign-out / project switch.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type {
  EditorAccessContext,
  ProjectEditLease,
  WorkspaceRole,
} from "../types";

export type WorkspaceSaveConflict =
  | { kind: "stale-revision"; currentRevision: number; serverRevision: number }
  | null;

export interface WorkspaceAccessState {
  /** True while resolving access for a workspace project. */
  loading: boolean;
  /** Editor permission boundary (default: editable — personal projects). */
  access: EditorAccessContext;
  /** Non-null when the active project is a workspace project. */
  workspaceId: string | null;
  workspaceName: string | null;
  /** Role of the current user in that workspace. */
  role: WorkspaceRole | null;
  /** Server revision of the workspace project (optimistic concurrency base). */
  serverRevision: number | null;
  /** Client mirror of the active edit lease. */
  lease: ProjectEditLease | null;
  /** Member name holding the lease when blocked ("being-edited"). */
  leaseHolderName: string | null;
  /** Save conflict surfaced by a rejected save. */
  saveConflict: WorkspaceSaveConflict;
  /** True when the editor is offline (shared projects read-only). */
  offline: boolean;

  // ---- Actions ----
  setLoading: (loading: boolean) => void;
  setAccess: (access: EditorAccessContext) => void;
  setWorkspaceContext: (ctx: {
    workspaceId: string | null;
    workspaceName: string | null;
    role: WorkspaceRole | null;
    serverRevision: number | null;
  }) => void;
  setLease: (lease: ProjectEditLease | null) => void;
  setLeaseHolderName: (name: string | null) => void;
  setSaveConflict: (conflict: WorkspaceSaveConflict) => void;
  setOffline: (offline: boolean) => void;
  /** Reset everything (sign-out / project switch / account switch). */
  reset: () => void;
}

const initialAccess: EditorAccessContext = { mode: "editable" };

export const useWorkspaceAccessStore = create<WorkspaceAccessState>()((set) => ({
  loading: false,
  access: initialAccess,
  workspaceId: null,
  workspaceName: null,
  role: null,
  serverRevision: null,
  lease: null,
  leaseHolderName: null,
  saveConflict: null,
  offline: false,

  setLoading: (loading) => set({ loading }),
  setAccess: (access) => set({ access }),
  setWorkspaceContext: (ctx) =>
    set({
      workspaceId: ctx.workspaceId,
      workspaceName: ctx.workspaceName,
      role: ctx.role,
      serverRevision: ctx.serverRevision,
    }),
  setLease: (lease) => set({ lease }),
  setLeaseHolderName: (name) => set({ leaseHolderName: name }),
  setSaveConflict: (conflict) => set({ saveConflict: conflict }),
  setOffline: (offline) => set({ offline }),
  reset: () =>
    set({
      loading: false,
      access: { mode: "editable" },
      workspaceId: null,
      workspaceName: null,
      role: null,
      serverRevision: null,
      lease: null,
      leaseHolderName: null,
      saveConflict: null,
      offline: false,
    }),
}));

// ---------------------------------------------------------------------------
// Central writability check used by the editor store's mutation guard.
// ---------------------------------------------------------------------------

/** True when the current editor session may mutate the project. */
export function isEditorWritable(): boolean {
  return useWorkspaceAccessStore.getState().access.mode === "editable";
}

/** True when the current session is a workspace read-only session. */
export function isWorkspaceReadOnly(): boolean {
  return useWorkspaceAccessStore.getState().access.mode === "readonly";
}
