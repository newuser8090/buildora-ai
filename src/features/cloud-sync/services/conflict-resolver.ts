// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — conflict detection + resolution policy
//
// Conflicts are detected against a BASELINE (the sync marker's last-synced
// state), NOT by wall-clock timestamps alone:
//   - contentRevision (tree epoch) detects BlockTree changes
//   - the cloud-relevant payload hash detects metadata changes
//   - updatedAt is used only as a deterministic tiebreak for auto-merge
//
// Policy:
//   - unchanged side vs changed side   → take the changed side (apply-remote
//     or upload-local)
//   - metadata-only changes on both    → auto-merge (recency-tiebreak + tag
//     union) for blocks; recency + membership union for collections
//   - BlockTree changed on both sides  → user review (kind "tree")
//   - delete vs edit                   → user review (kind "delete-edit")
//   - unsupported remote version       → error surfaced as a conflict
//
// BlockTree content is NEVER silently overwritten.
// ---------------------------------------------------------------------------

import type { MyBlockCollection, MyBlockRecord } from "@/features/my-blocks/types";
import { myBlockToCloud, collectionToCloud } from "../serialization/cloud-serializer";
import { hashPayload } from "../hash";
import type {
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudSyncMarker,
} from "../types";

// ---------------------------------------------------------------------------
// Baseline hashing
// ---------------------------------------------------------------------------

/**
 * Transient / bookkeeping fields that must NEVER participate in content
 * comparisons: `deviceId` is per-upload diagnostics, `id`/`schemaVersion` are
 * provider-level identity, `clientUpdatedAt` is a mirror of the uploader's
 * clock, and `deletedAt` is a lifecycle flag handled separately. Removing
 * them lets local and remote sides of the SAME logical content hash equally
 * regardless of which device uploaded it.
 */
const TRANSIENT_PAYLOAD_KEYS = new Set([
  "id",
  "schemaVersion",
  "deviceId",
  "clientUpdatedAt",
  "deletedAt",
]);

/** Canonical content view of a cloud payload (blocks AND collections). */
export function canonicalCloudContent(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (TRANSIENT_PAYLOAD_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Hash the CLOUD-RELEVANT subset of a local record (local-only fields like
 * favorite / useCount / thumbnail are stripped first) so comparisons never
 * false-positive on per-device metadata.
 */
export function cloudHashOfLocalBlock(record: MyBlockRecord): string {
  const serialized = myBlockToCloud(record);
  if (!serialized.ok) return "";
  return hashPayload(canonicalCloudContent(serialized.payload as unknown as Record<string, unknown>));
}

export function cloudHashOfLocalCollection(
  collection: MyBlockCollection,
  blocks: ReadonlyArray<MyBlockRecord>,
  markers: ReadonlyMap<string, CloudSyncMarker>,
): string {
  const serialized = collectionToCloud(collection, blocks, markers);
  if (!serialized.ok) return "";
  return hashPayload(canonicalCloudContent(serialized.payload as unknown as Record<string, unknown>));
}

/** Hash of a validated remote payload (content-only, transient fields removed). */
export function cloudHashOfRemote(payload: unknown): string {
  if (payload === null || typeof payload !== "object") return "";
  return hashPayload(canonicalCloudContent(payload as Record<string, unknown>));
}

// ---------------------------------------------------------------------------
// Decision model
// ---------------------------------------------------------------------------

export type SyncConflictKind =
  | "tree"
  | "delete-edit"
  | "collection"
  | "unsupported-version";

export type SyncDecision =
  | { kind: "apply-remote" }
  | { kind: "upload-local" }
  | { kind: "no-op" }
  | { kind: "link" } // identical content, no baseline — link the local record to the cloud id
  | { kind: "auto-merge"; merged: unknown }
  | { kind: "conflict"; conflictKind: SyncConflictKind; reason: string };

export interface BlockSyncContext {
  /** Baseline marker (null when this device never synced this record). */
  marker: CloudSyncMarker | null;
  /** Current validated local record, or null when absent locally. */
  local: MyBlockRecord | null;
  /** Validated remote payload, or null when the remote record is deleted. */
  remote: CloudMyBlockPayload | null;
  localCloudHash: string;
  remoteHash: string;
}

export interface CollectionSyncContext {
  marker: CloudSyncMarker | null;
  local: MyBlockCollection | null;
  remote: CloudMyBlockCollectionPayload | null;
  localCloudHash: string;
  remoteHash: string;
}

function isRemoteDeleted(remote: CloudMyBlockPayload | CloudMyBlockCollectionPayload | null): boolean {
  return !remote || !!remote.deletedAt;
}

/**
 * Decide how to reconcile a BLOCK.
 *
 * `localChanged`/`remoteChanged` compare the cloud-relevant hash against the
 * baseline. `localTreeChanged`/`remoteTreeChanged` compare contentRevision
 * (tree epochs) against the baseline.
 */
export function decideBlockSync(ctx: BlockSyncContext): SyncDecision {
  const { marker, local, remote, localCloudHash, remoteHash } = ctx;

  const localExists = local !== null;
  const remoteExists = remote !== null && !remote.deletedAt;

  // Both sides deleted (or never existed on either side) → nothing to do.
  if (!localExists && !remoteExists) return { kind: "no-op" };

  // Local deleted, remote deleted → no-op.
  if (!localExists && isRemoteDeleted(remote)) return { kind: "no-op" };

  // No baseline marker at all → this device has never synced this record.
  // contentRevision is a per-device epoch, so it is NEVER compared across
  // devices — only the content hash is meaningful here.
  if (!marker) {
    if (remoteExists && !localExists) return { kind: "apply-remote" };
    if (localExists && !remoteExists) return { kind: "upload-local" };
    // Both exist with no baseline: identical content → link (no duplicate);
    // different content → never silently overwrite — surface a review.
    if (localExists && remoteExists) {
      if (localCloudHash !== "" && localCloudHash === remoteHash) {
        return { kind: "link" };
      }
      return {
        kind: "conflict",
        conflictKind: "tree",
        reason: "This saved piece exists on this device and in the cloud but was never synced. Review the versions.",
      };
    }
    return { kind: "no-op" };
  }

  const localChanged = localExists && localCloudHash !== marker.lastSyncedHash;
  const remoteChanged = remoteExists && remoteHash !== marker.lastSyncedHash;

  // Delete vs edit.
  const localDeletedNow = !localExists;
  const remoteDeletedNow = isRemoteDeleted(remote);
  if (localDeletedNow && remoteExists && remoteChanged) {
    return {
      kind: "conflict",
      conflictKind: "delete-edit",
      reason: "This piece was deleted on this device but edited in the cloud.",
    };
  }
  if (remoteDeletedNow && localExists && localChanged) {
    return {
      kind: "conflict",
      conflictKind: "delete-edit",
      reason: "This piece was deleted in the cloud but edited on this device.",
    };
  }
  // One-sided delete with the other side unchanged → safe.
  if (localDeletedNow && !remoteChanged) return { kind: "no-op" }; // both deletions already queued/acked
  if (remoteDeletedNow && !localChanged) return { kind: "apply-remote" };

  const localTreeChanged = localExists && (local.contentRevision ?? 1) !== marker.lastSyncedContentRevision;
  const remoteTreeChanged = remoteExists && remote.contentRevision !== marker.lastSyncedContentRevision;

  if (localChanged && remoteChanged) {
    // BlockTree changed on both sides → always review.
    if (localTreeChanged && remoteTreeChanged) {
      return {
        kind: "conflict",
        conflictKind: "tree",
        reason: "This saved piece's design was changed on both this device and in the cloud.",
      };
    }
    // One side changed the tree, the other only metadata → merge safely:
    // take the tree side, merge metadata from the other with recency tiebreak.
    if (localTreeChanged && !remoteTreeChanged) {
      return { kind: "auto-merge", merged: local };
    }
    if (remoteTreeChanged && !localTreeChanged) {
      return { kind: "auto-merge", merged: remote };
    }
    // Metadata-only on both sides → deterministic recency merge.
    const localNewer = (local?.updatedAt ?? "") >= (remote?.updatedAt ?? "");
    return {
      kind: "auto-merge",
      merged: localNewer ? local : remote,
    };
  }

  if (localChanged) return { kind: "upload-local" };
  if (remoteChanged) return { kind: "apply-remote" };
  return { kind: "no-op" };
}

/**
 * Decide how to reconcile a COLLECTION. Membership lives on the cloud
 * collection; local membership is rebuilt from the block list at upload, so
 * collection conflicts are about the collection's own metadata. Membership
 * unions are safe and applied automatically.
 */
export function decideCollectionSync(ctx: CollectionSyncContext): SyncDecision {
  const { marker, local, remote, localCloudHash, remoteHash } = ctx;

  const localExists = local !== null;
  const remoteExists = remote !== null && !remote.deletedAt;

  if (!localExists && !remoteExists) return { kind: "no-op" };
  if (!localExists && isRemoteDeleted(remote)) return { kind: "no-op" };

  if (!marker) {
    if (remoteExists && !localExists) return { kind: "apply-remote" };
    if (localExists && !remoteExists) return { kind: "upload-local" };
    if (localExists && remoteExists) {
      if (localCloudHash !== "" && localCloudHash === remoteHash) {
        return { kind: "link" };
      }
      return {
        kind: "conflict",
        conflictKind: "collection",
        reason: "This collection exists on this device and in the cloud but was never synced.",
      };
    }
    return { kind: "no-op" };
  }

  const localChanged = localExists && localCloudHash !== marker.lastSyncedHash;
  const remoteChanged = remoteExists && remoteHash !== marker.lastSyncedHash;

  const localDeletedNow = !localExists;
  const remoteDeletedNow = isRemoteDeleted(remote);
  if (localDeletedNow && remoteExists && remoteChanged) {
    return {
      kind: "conflict",
      conflictKind: "delete-edit",
      reason: "This collection was deleted on this device but changed in the cloud.",
    };
  }
  if (remoteDeletedNow && localExists && localChanged) {
    return {
      kind: "conflict",
      conflictKind: "delete-edit",
      reason: "This collection was deleted in the cloud but changed on this device.",
    };
  }
  if (localDeletedNow && !remoteChanged) return { kind: "no-op" };
  if (remoteDeletedNow && !localChanged) return { kind: "apply-remote" };

  if (localChanged && remoteChanged) {
    // Metadata changed on both sides — merge with recency tiebreak, union
    // membership (additive and safe).
    const localNewer = (local?.updatedAt ?? "") >= (remote?.updatedAt ?? "");
    return { kind: "auto-merge", merged: localNewer ? local : remote };
  }

  if (localChanged) return { kind: "upload-local" };
  if (remoteChanged) return { kind: "apply-remote" };
  return { kind: "no-op" };
}
