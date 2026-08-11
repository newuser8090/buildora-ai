// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — shared types
//
// Provider-independent types for the collaboration engine: room references,
// transaction origins, transport messages/status, and the editor sync status.
// No React, no DOM, no Zustand.
// ---------------------------------------------------------------------------

/** Identifies one collaborative room (one per workspace project). */
export interface CollabRoomRef {
  workspaceId: string;
  projectId: string;
}

/** The lifecycle phase of the collaboration transport. */
export type CollabTransportPhase =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "disconnected"
  | "error";

/** A binary Yjs update relayed from a peer (or the room snapshot). */
export interface CollabTransportMessage {
  /** Base64-encoded Yjs binary update (or full state for snapshots). */
  update: string;
  /** Sequence number assigned by the room (monotonic per room). */
  seq: number;
  /** Client id of the sender (empty for server snapshots). */
  actorClientId?: string;
  /** True for a full-state snapshot (e.g. join / after restore). */
  snapshot?: boolean;
  /** True when this is a room reset (clients re-init from a checkpoint). */
  reset?: boolean;
  /** True when the poll fell behind the pruned frontier (re-init from base). */
  rebase?: boolean;
  /** Durable canonical Project payload accompanying a snapshot/rebase. */
  base?: unknown;
}

/** Editor-visible sync status (never color alone — always text). */
export type CollabSyncStatus =
  | "idle"
  | "connecting"
  | "syncing"
  | "synced"
  | "offline"
  | "reconnecting"
  | "error";

/** Origin constants for Yjs transactions (undo scoping). */
export const COLLAB_LOCAL_PREFIX = "collab-local";
export const COLLAB_REMOTE_PREFIX = "collab-remote";

export function localOrigin(clientId: string): string {
  return `${COLLAB_LOCAL_PREFIX}:${clientId}`;
}

export function remoteOrigin(clientId: string): string {
  return `${COLLAB_REMOTE_PREFIX}:${clientId}`;
}

export function isRemoteOrigin(origin: unknown): boolean {
  return (
    typeof origin === "string" && origin.startsWith(COLLAB_REMOTE_PREFIX)
  );
}

/** Test-only transport controls (guarded to mock/dev environments). */
export interface CollabTestControls {
  forceDisconnect(): void;
  forceReconnect(): void;
}

/**
 * Canonical shared-state seed: when a room has no canonical Yjs state yet, the
 * FIRST joiner's init state becomes canonical and later joiners apply it via
 * applyUpdate (identical structs — no content duplication). This mirrors the
 * production contract (Supabase stores the canonical state row).
 */
export interface CollabSeedResult {
  /** Canonical state to apply (base64). null when THIS client's seed won. */
  state: string | null;
}

/** Resource limits (architecture §39). */
export const COLLAB_MAX_UPDATE_BYTES = 256 * 1024; // 256 KB
export const COLLAB_OFFLINE_QUEUE_MAX = 256;
export const COLLAB_OFFLINE_QUEUE_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const COLLAB_SEND_COALESCE_MS = 100;
export const COLLAB_CHECKPOINT_DEBOUNCE_MS = 1500;
