// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — core model
//
// Provider-independent types shared by the durable queue, sync markers,
// conflict records, serializer, and the sync engine. No React, no DOM, no
// Zustand. Local-first: IndexedDB remains the immediate source for the UI;
// these types describe the CLOUD layer and the sync bookkeeping around it.
// ---------------------------------------------------------------------------

import type {
  BlockTree,
} from "@/features/blocks/types";
import type {
  MyBlockCategory,
  MyBlockPreviewMetadata,
  MyBlockSourceMetadata,
} from "@/features/my-blocks/types";

// ---------------------------------------------------------------------------
// Sync status (transient UI state — never persisted into ProjectSchema)
// ---------------------------------------------------------------------------

export type CloudSyncStatus =
  | "signed-out"
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "error"
  | "conflict";

/** Entities that participate in cloud sync. */
export type CloudEntityType = "myBlock" | "collection";

/** Durable queue operation. */
export type CloudOperation = "upsert" | "delete";

/**
 * Mutation origin — the reason a write happened. Used to prevent feedback
 * loops: writes originating from a remote download must never re-enqueue an
 * upload for the same entity.
 */
export type MutationOrigin =
  | "local-user"
  | "remote-sync"
  | "migration"
  | "import";

// ---------------------------------------------------------------------------
// Durable sync queue entry (cloudSyncQueue store)
//
// The entry describes the INTENT to sync an entity. The payload itself is
// never duplicated here — the engine reads the current record fresh from the
// canonical local adapter at sync time and compares payloadHash to detect
// superseded work. No raw pasted source ever enters the queue.
// ---------------------------------------------------------------------------

export interface CloudSyncQueueEntry {
  id: string;
  /** Owner user id. Queue entries are isolated per user (sign-out safe). */
  userId: string;
  entityType: CloudEntityType;
  entityId: string;
  operation: CloudOperation;
  /** Record revision at enqueue time (contentRevision for blocks, 1 otherwise). */
  localRevision: number;
  /** Stable hash of the record payload at enqueue time (staleness check). */
  payloadHash: string;
  createdAt: string;
  retryCount: number;
  /** Bounded retry/backoff — the entry is only picked up after this time. */
  nextRetryAt?: string;
  /** Last structured error code, for the "sync needs attention" UI. */
  lastErrorCode?: string;
}

// ---------------------------------------------------------------------------
// Sync markers (cloudSyncMarkers store)
//
// Map a local entity id to its cloud id and record the last-synced state so
// conflicts are detected against a BASELINE (revisions + timestamps), not by
// wall-clock alone.
// ---------------------------------------------------------------------------

export interface CloudSyncMarker {
  /** `${userId}:${entityType}:${localEntityId}`. */
  key: string;
  userId: string;
  entityType: CloudEntityType;
  localEntityId: string;
  cloudEntityId: string;
  /** The cloud record's updated_at at last sync (baseline timestamp). */
  lastSyncedUpdatedAt: string;
  /** The record's content revision at last sync (tree epoch). */
  lastSyncedContentRevision: number;
  /** Stable hash of the payload at last sync (tree/content baseline). */
  lastSyncedHash: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Cloud payloads (schemaVersion 1) — validated native model only
//
// These are the on-the-wire / on-the-database records. Rules:
//   - preserve the validated native BlockTree (never raw pasted source)
//   - strip local-only UI fields (favorite, thumbnail metadata, useCount,
//     lastUsedAt) — thumbnails are regenerable and never uploaded
//   - carry contentRevision so tree epochs survive round-trips
//   - soft-delete support via deletedAt (tombstone)
// ---------------------------------------------------------------------------

export { CLOUD_SCHEMA_VERSION } from "./constants";

export interface CloudMyBlockPayload {
  /** Stable cloud record id (server-owned uuid). */
  id: string;
  schemaVersion: number;
  name: string;
  description?: string;
  category: MyBlockCategory;
  tags: string[];
  tree: BlockTree;
  sourceMetadata?: MyBlockSourceMetadata;
  previewMetadata: MyBlockPreviewMetadata;
  /** Tree epoch — increments ONLY when the tree changes. */
  contentRevision: number;
  createdAt: string;
  updatedAt: string;
  /** Last client-side change timestamp (diagnostics / tiebreak only). */
  clientUpdatedAt: string;
  /** Which device last wrote (diagnostics / conflict metadata only). */
  deviceId?: string;
  /** Soft-delete tombstone. */
  deletedAt?: string | null;
}

/** Tombstone intent pushed to the cloud (soft-delete a record by cloud id). */
export interface CloudPushTombstone {
  id: string;
  entityType: CloudEntityType;
  deletedAt: string;
}

export interface CloudMyBlockCollectionPayload {
  id: string;
  schemaVersion: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  /**
   * Collection membership (cloud block ids). Membership is owned by the
   * COLLECTION record so serialization never needs to remap ids inside a
   * block payload. Unresolved local memberships are skipped until their
   * blocks have synced (markers exist).
   */
  blockIds: string[];
  deletedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Delta sync
// ---------------------------------------------------------------------------

export interface CloudDelta {
  blocks: CloudMyBlockPayload[];
  collections: CloudMyBlockCollectionPayload[];
}

export interface CloudChangesPage extends CloudDelta {
  /** Opaque cursor for the next fetch. */
  cursor: string;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Durable conflict records (cloudSyncConflicts store)
// ---------------------------------------------------------------------------

export type CloudConflictKind =
  | "tree"                 // BlockTree changed on both sides
  | "delete-edit"          // one side deleted, the other edited
  | "collection"           // incompatible collection changes
  | "unsupported-version"; // remote schema version unsupported

export type CloudConflictStatus =
  | "open"
  | "resolved-keep-local"
  | "resolved-keep-cloud"
  | "resolved-keep-both"
  | "review-later";

export interface CloudConflictRecord {
  id: string;
  userId: string;
  entityType: CloudEntityType;
  /** Local entity id ("" when the local side does not exist yet). */
  localEntityId: string;
  /** Cloud entity id ("" when the cloud side does not exist yet). */
  cloudEntityId: string;
  kind: CloudConflictKind;
  /** Serialized LOCAL record (validated MyBlockRecord / collection). */
  localRecord?: unknown;
  /** Serialized CLOUD payload (validated). */
  cloudRecord?: unknown;
  localModifiedAt: string;
  cloudModifiedAt: string;
  status: CloudConflictStatus;
  decisionAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Initial merge decisions
// ---------------------------------------------------------------------------

export type InitialMergeChoice =
  | "merge"
  | "upload-local"
  | "download-cloud"
  | "review";

export interface InitialMergeDecision {
  userId: string;
  choice: InitialMergeChoice;
  decidedAt: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CloudSyncErrorCode =
  | "AUTH_REQUIRED"
  | "SESSION_EXPIRED"
  | "OFFLINE"
  | "NETWORK_FAILED"
  | "RATE_LIMITED"
  | "REMOTE_VALIDATION_FAILED"
  | "UNSUPPORTED_REMOTE_VERSION"
  | "CONFLICT"
  | "PERMISSION_DENIED"
  | "INVITE_EXPIRED"
  | "INVITE_INVALID"
  | "STORAGE_QUOTA"
  | "SYNC_CANCELLED"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export interface CloudSyncError {
  code: CloudSyncErrorCode;
  /** User-safe message — never SQL, tokens, table names, or stack traces. */
  message: string;
  /** Internal diagnostic detail (never shown to beginners). */
  cause?: string;
  /** True when retrying later is likely to succeed. */
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Shared libraries (Phase P6)
// ---------------------------------------------------------------------------

export type SharedLibraryRole = "viewer" | "editor";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface CloudSharedLibrary {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  /** Role of the CURRENT user in this library (owner / viewer / editor). */
  memberRole: "owner" | SharedLibraryRole;
  /** Denormalized member count (owner + editors + viewers). */
  memberCount: number;
  /** Denormalized block count. */
  blockCount: number;
}

export interface CloudSharedLibraryBlock {
  id: string;
  libraryId: string;
  /** The validated cloud block payload (the block record owned by the owner). */
  block: CloudMyBlockPayload;
}

export interface CloudLibraryInvitation {
  id: string;
  libraryId: string;
  libraryName: string;
  /** Normalized recipient email (lowercased). Never exposed to other users. */
  recipientEmail: string;
  role: SharedLibraryRole;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
}
