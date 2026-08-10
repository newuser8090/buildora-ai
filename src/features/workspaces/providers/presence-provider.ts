// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: provider interface
//
// Presence is EPHEMERAL collaboration state (never durable business data).
// The UI never talks to a transport directly — it goes through this boundary
// (same pattern as WorkspaceProvider / ShareLinkProvider). Authorization is
// ALWAYS enforced server-side:
//   - mock: membership enforced on every join/read; mode derived from the lease
//   - supabase: channel authorization via RLS on the workspace_presence table;
//     the client only ever tracks its OWN server-resolved mode (a client
//     cannot claim "editing" without actually holding the lease)
// ---------------------------------------------------------------------------

import type { WorkspacePresence, WorkspacePresenceMode } from "../types";

export interface PresenceJoinInput {
  workspaceId: string;
  /** Null = workspace-wide presence. */
  projectId?: string | null;
  /** Client-generated; one per open tab. */
  sessionId: string;
  /**
   * The caller's own server-resolved mode (editing only while it holds the
   * lease). The mock derives mode from the lease regardless; Supabase tracks
   * this value because the client's lease IS server-resolved.
   */
  mode: WorkspacePresenceMode;
}

export interface PresenceProvider {
  readonly kind: "mock" | "supabase";

  /** Upsert this session (idempotent per sessionId). */
  join(input: PresenceJoinInput): Promise<void>;

  /** Refresh the session TTL; Supabase re-tracks the latest mode. */
  heartbeat(
    workspaceId: string,
    sessionId: string,
    mode: WorkspacePresenceMode,
  ): Promise<void>;

  /** Best-effort removal (idempotent). */
  leave(sessionId: string): Promise<void>;

  /** Current active sessions for a workspace (optionally project-scoped). */
  getPresence(
    workspaceId: string,
    projectId?: string | null,
  ): Promise<WorkspacePresence[]>;

  /**
   * Realtime subscription (Supabase). Returns an unsubscribe function. The
   * mock provider returns a no-op — the hook polls getPresence instead.
   */
  subscribe(
    workspaceId: string,
    onPresence: (presence: WorkspacePresence[]) => void,
  ): () => void;
}
