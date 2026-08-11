// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — transport abstraction
//
// React components and the session service never talk to Supabase channels or
// the mock HTTP API directly — they go through this boundary (same pattern as
// WorkspaceProvider / PresenceProvider). Responsibilities:
//
//   connect     — join the project room. Resolves with the durable join
//                 snapshot (the current workspace project payload, atomically
//                 consistent with the room seq) so the session can init its
//                 Y.Doc deterministically.
//   send        — relay a binary Yjs update (editor/owner only; the server
//                 rejects viewers, non-members, and downgraded/removed users).
//   checkpoint  — prune room updates already durably persisted (called after
//                 the session writes the workspace payload via the P14 path).
//   lock/unlock — owner-only maintenance lock (version restore / import).
//   onMessage   — relayed updates, plus rebase snapshots (client fell behind
//                 the pruned frontier → re-init from the durable base).
//   onStatus    — transport phase changes (connected/offline/reconnecting/…).
//   disconnect  — leave the room (StrictMode-safe; cleanup must be registered).
//
// All implementations are asynchronous on purpose (production and mock).
// ---------------------------------------------------------------------------

import type {
  CollabRoomRef,
  CollabSeedResult,
  CollabTestControls,
  CollabTransportMessage,
  CollabTransportPhase,
} from "../types";

/** Result of joining a room: durable base + room seq it corresponds to. */
export interface CollabJoinResult {
  /** Canonical Project payload (the durable base at join time). */
  base: unknown;
  /** Room seq the base corresponds to (updates after this are pending). */
  seq: number;
  /**
   * Canonical shared Yjs state (base64) when the room already has one — the
   * joiner applies it via applyUpdate instead of rebuilding content locally
   * (identical structs ⇒ no content duplication on merge).
   */
  state?: string;
}

export interface CollabConnectOptions {
  /** True when this client may send mutation updates (editor/owner). */
  canSend: boolean;
  /** Stable per-tab client id (also the Yjs clientId). */
  clientId: string;
  /** User id (server derives authority; used for actor hints only). */
  userId?: string;
}

export interface CollabTransport {
  readonly kind: "mock" | "supabase";

  /** Join the room and resolve with the durable join snapshot. */
  connect(room: CollabRoomRef, options: CollabConnectOptions): Promise<CollabJoinResult>;

  /**
   * Seed the room with this client's init state when it has none (first joiner
   * wins). Returns the canonical state to apply — null when this client's seed
   * won (keep local structs), or a base64 state when another client won first
   * (re-apply theirs, discarding local structs).
   */
  seed(state: Uint8Array): Promise<CollabSeedResult>;

  /** Relay a binary Yjs update. Rejects on authorization loss / offline. */
  send(update: Uint8Array): Promise<void>;

  /**
   * Prune room updates ≤ the given server seq (after a durable save) and, when
   * `state` is provided, refresh the room's canonical Yjs state so late joiners
   * converge to identical structs.
   */
  checkpoint(seq: number, state?: Uint8Array): Promise<void>;

  /** Owner-only maintenance lock (version restore / import coordination). */
  lock(room: CollabRoomRef): Promise<void>;
  unlock(room: CollabRoomRef): Promise<void>;

  /** Subscribe to relayed updates + rebase snapshots. Returns unsubscribe. */
  onMessage(callback: (message: CollabTransportMessage) => void): () => void;

  /** Subscribe to transport phase changes. Returns unsubscribe. */
  onStatus(callback: (phase: CollabTransportPhase) => void): () => void;

  /**
   * Subscribe to authorization loss detected by the transport itself (e.g. a
   * poll/send rejected with 403/401 after the client was removed or downgraded).
   * Returns unsubscribe.
   */
  onAuthError(callback: () => void): () => void;

  /** Leave the room and tear down subscriptions. */
  disconnect(): Promise<void>;

  /** Test-only controls (undefined outside mock/dev). */
  testControls?: CollabTestControls;
}
