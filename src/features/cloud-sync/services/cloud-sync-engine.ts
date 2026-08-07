// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — sync engine
//
// One sync run at a time, stale-run protection, cancellation on sign-out /
// user change, bounded batches + pagination, structured errors, retry-safe /
// idempotent operations. The canonical local adapter remains the source of
// truth for uploads; validated remote records are applied through the raw
// remote-apply path (no echo loops).
//
// Run order (conflict safety):
//   1. verify session + online state
//   2. fetch remote deltas since the cursor (paginated, bounded)
//   3. decide per record: apply-remote / upload-local / auto-merge / conflict
//   4. process the durable upload queue for non-conflicting entities
//   5. update the cursor + status
//
// BlockTree conflicts are never resolved silently — they surface for review.
// ---------------------------------------------------------------------------

import {
  SYNC_DOWNLOAD_BATCH_SIZE,
  SYNC_RETRY_BASE_DELAY_MS,
  SYNC_RETRY_MAX_DELAY_MS,
  SYNC_UPLOAD_BATCH_SIZE,
} from "../constants";
import {
  makeCloudSyncError,
  toCloudSyncError,
  type CloudSyncError,
} from "../errors";
import { METADATA_KEY_SYNC_CURSOR_PREFIX } from "@/features/persistence/constants";
import { getDeviceId } from "../device-id";
import { SyncMetadataStore } from "../sync-metadata-store";
import type { CloudSyncQueue } from "../queue/cloud-sync-queue";
import type { CloudSyncMarkers } from "../markers/cloud-sync-markers";
import type { CloudConflictStore } from "../conflicts/cloud-conflict-store";
import type { CloudRemoteApplier, RawLibraryWriter, ThumbnailEnsurer } from "./remote-apply";
import type { CloudLibraryProvider } from "../providers/cloud-library-provider";
import {
  cloudHashOfLocalBlock,
  cloudHashOfLocalCollection,
  cloudHashOfRemote,
  decideBlockSync,
  decideCollectionSync,
  type SyncDecision,
} from "./conflict-resolver";
import { reconcileQueueWithLocalLibrary } from "./sync-enqueuer";
import {
  collectionToCloud,
  entityMarkerKey,
  myBlockToCloud,
  parseCloudMyBlockCollectionPayload,
  parseCloudMyBlockPayload,
} from "../serialization/cloud-serializer";
import { hashPayload } from "../hash";
import type {
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudSyncMarker,
  CloudSyncQueueEntry,
} from "../types";
import type {
  MyBlockCollection,
  MyBlockRecord,
  MyBlocksStorageAdapter,
} from "@/features/my-blocks/types";

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface SyncEngineDeps {
  provider: CloudLibraryProvider;
  queue: CloudSyncQueue;
  markers: CloudSyncMarkers;
  conflicts: CloudConflictStore;
  applier: CloudRemoteApplier;
  writer: RawLibraryWriter;
  /** Canonical local adapter (reads current records for uploads). */
  adapter: MyBlocksStorageAdapter;
  isOnline?: () => boolean;
  now?: () => string;
  /** Called after remote records were applied so the UI re-lists. */
  onRefresh?: () => void;
  deleteThumbnail?: (blockId: string) => Promise<void>;
  /** Called on any applied block (thumbnail regeneration, best-effort). */
  thumbnailEnsurer?: ThumbnailEnsurer;
  /**
   * Scoped key/value store for per-user sync cursors. Injected so tests with
   * isolated databases never share cursor state; defaults to the device DB.
   */
  metadata?: SyncMetadataStore;
}

export interface SyncRunReport {
  uploaded: number;
  downloaded: number;
  conflictsDetected: number;
  autoMerged: number;
  failed: number;
  status: "synced" | "offline" | "error" | "conflict";
  error?: CloudSyncError;
}

const MAX_PAGES_PER_RUN = 5;

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class CloudSyncEngine {
  private deps: SyncEngineDeps;
  private metadata: SyncMetadataStore;
  private running = false;
  private pendingRun = false;
  private generation = 0;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
    this.metadata = deps.metadata ?? new SyncMetadataStore();
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Cancel the active run and any coalesced follow-up. */
  cancel(): void {
    this.generation += 1;
    this.pendingRun = false;
  }

  /**
   * Run a full sync cycle. Coalesces concurrent calls (one active run; a
   * second request marks a pending re-run). Never throws — failures are
   * reported through the report.
   */
  async run(userId: string): Promise<SyncRunReport> {
    if (this.running) {
      this.pendingRun = true;
      return this.emptyReport("synced");
    }
    const generation = this.generation;
    this.running = true;
    try {
      const report = await this.executeRun(userId, generation);
      if (this.pendingRun && this.generation === generation) {
        this.pendingRun = false;
        const again = await this.executeRun(userId, this.generation);
        return this.mergeReports(report, again);
      }
      return report;
    } finally {
      this.running = false;
    }
  }

  /**
   * Called right after a successful sign-in: migrate device-local unsigned
   * queue entries to the user and reconcile the queue with the local library
   * (catches records created/edited while signed out or before this phase).
   */
  async prepareForSignIn(userId: string): Promise<void> {
    await this.deps.queue.migrateUnsignedEntries(userId);
    await reconcileQueueWithLocalLibrary(userId, {
      queue: this.deps.queue,
      adapter: this.deps.adapter,
      markers: this.deps.markers,
      hashOf: {
        block: cloudHashOfLocalBlock,
        collection: (collection) => hashPayload(collection),
      },
    });
  }

  /** Upload only (no fetch). Used by initial-merge "upload" and reconnects. */
  async uploadOnly(userId: string): Promise<SyncRunReport> {
    if (this.running) {
      this.pendingRun = true;
      return this.emptyReport("synced");
    }
    const generation = this.generation;
    this.running = true;
    try {
      const uploaded = await this.processUploadQueue(userId, generation, false);
      return { ...this.emptyReport("synced"), uploaded };
    } finally {
      this.running = false;
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private emptyReport(status: SyncRunReport["status"]): SyncRunReport {
    return { uploaded: 0, downloaded: 0, conflictsDetected: 0, autoMerged: 0, failed: 0, status };
  }

  private mergeReports(a: SyncRunReport, b: SyncRunReport): SyncRunReport {
    return {
      uploaded: a.uploaded + b.uploaded,
      downloaded: a.downloaded + b.downloaded,
      conflictsDetected: a.conflictsDetected + b.conflictsDetected,
      autoMerged: a.autoMerged + b.autoMerged,
      failed: a.failed + b.failed,
      status: b.status,
      error: b.error,
    };
  }

  private nowIso(): string {
    return this.deps.now?.() ?? new Date().toISOString();
  }

  private isOnline(): boolean {
    return this.deps.isOnline ? this.deps.isOnline() : true;
  }

  private cursorKey(userId: string): string {
    return `${METADATA_KEY_SYNC_CURSOR_PREFIX}${userId}`;
  }

  private async readCursor(userId: string): Promise<string | null> {
    const value = await this.metadata.read(this.cursorKey(userId));
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private async writeCursor(userId: string, cursor: string): Promise<void> {
    // Non-fatal: a lost cursor just re-fetches (markers make it a no-op).
    await this.metadata.write(this.cursorKey(userId), cursor).catch(() => undefined);
  }

  private async executeRun(userId: string, generation: number): Promise<SyncRunReport> {
    const report = this.emptyReport("synced");
    try {
      if (generation !== this.generation) {
        throw makeCloudSyncError("SYNC_CANCELLED", "Sync was cancelled.");
      }
      if (!this.isOnline()) return { ...report, status: "offline" };

      const session = await this.deps.provider.getSessionUser();
      if (!session || session.id !== userId) {
        throw makeCloudSyncError("AUTH_REQUIRED", "Sign in to sync.");
      }

      // 1. Fetch + apply remote deltas.
      const download = await this.applyRemoteDeltas(userId, generation);
      report.downloaded = download.applied;
      report.conflictsDetected = download.conflicts;
      report.autoMerged = download.autoMerged;

      // 2. Upload queued local changes (skip conflicting entities).
      report.uploaded = await this.processUploadQueue(userId, generation, true);

      // 3. Final status.
      const openConflicts = await this.deps.conflicts.countOpen(userId);
      if (openConflicts > 0) {
        report.status = "conflict";
        report.conflictsDetected = Math.max(report.conflictsDetected, openConflicts);
      } else {
        report.status = "synced";
      }
      return report;
    } catch (err) {
      const error = toCloudSyncError(err);
      report.failed = 1;
      report.error = error;
      report.status =
        error.code === "OFFLINE"
          ? "offline"
          : error.code === "SYNC_CANCELLED"
            ? "synced"
            : "error";
      return report;
    }
  }

  // -------------------------------------------------------------------------
  // Downloads
  // -------------------------------------------------------------------------

  private async applyRemoteDeltas(
    userId: string,
    generation: number,
  ): Promise<{ applied: number; conflicts: number; autoMerged: number }> {
    let cursor = await this.readCursor(userId);
    let applied = 0;
    let conflicts = 0;
    let autoMerged = 0;

    for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
      if (generation !== this.generation) {
        throw makeCloudSyncError("SYNC_CANCELLED", "Sync was cancelled.");
      }
      const changes = await this.deps.provider.fetchChanges(cursor, SYNC_DOWNLOAD_BATCH_SIZE);
      if (changes.blocks.length === 0 && changes.collections.length === 0) {
        if (changes.cursor && changes.cursor !== cursor) cursor = changes.cursor;
        break;
      }

      const markerMap = await this.deps.markers.buildLookupMap(userId);

      for (const remoteBlock of changes.blocks) {
        const parsed = parseCloudMyBlockPayload(remoteBlock);
        if (!parsed.ok) {
          conflicts += await this.recordUnreadableDelta(
            userId,
            "myBlock",
            remoteBlock.id,
            remoteBlock.updatedAt,
            remoteBlock,
            parsed.error.code === "UNSUPPORTED_REMOTE_VERSION" ? "unsupported-version" : "tree",
            markerMap,
          );
          continue;
        }
        const marker = await this.findMarkerByCloudId(userId, "myBlock", parsed.value.id, markerMap);
        const local = marker ? await this.deps.writer.getBlock(marker.localEntityId) : undefined;
        const decision = decideBlockSync({
          marker,
          local: local ?? null,
          remote: parsed.value.deletedAt ? null : parsed.value,
          localCloudHash: local ? cloudHashOfLocalBlock(local) : "",
          remoteHash: cloudHashOfRemote(parsed.value),
        });
        const outcome = await this.applyBlockDecision(userId, parsed.value, decision, marker, local);
        applied += outcome.applied;
        conflicts += outcome.conflicts;
        autoMerged += outcome.autoMerged;
      }

      for (const remoteCollection of changes.collections) {
        const parsed = parseCloudMyBlockCollectionPayload(remoteCollection);
        if (!parsed.ok) {
          conflicts += await this.recordUnreadableDelta(
            userId,
            "collection",
            remoteCollection.id,
            remoteCollection.updatedAt,
            remoteCollection,
            "collection",
            markerMap,
          );
          continue;
        }
        const marker = await this.findMarkerByCloudId(userId, "collection", parsed.value.id, markerMap);
        const local = marker ? await this.deps.writer.getCollection(marker.localEntityId) : undefined;
        const localBlocks = await this.deps.writer.listBlocks();
        const localHash = local
          ? cloudHashOfLocalCollection(local, localBlocks, markerMap)
          : "";
        const decision = decideCollectionSync({
          marker,
          local: local ?? null,
          remote: parsed.value.deletedAt ? null : parsed.value,
          localCloudHash: localHash,
          remoteHash: cloudHashOfRemote(parsed.value),
        });
        const outcome = await this.applyCollectionDecision(userId, parsed.value, decision, marker, local);
        applied += outcome.applied;
        conflicts += outcome.conflicts;
        autoMerged += outcome.autoMerged;
      }

      cursor = changes.cursor;
      if (!changes.hasMore) break;
    }

    await this.writeCursor(userId, cursor ?? "");
    this.deps.onRefresh?.();
    return { applied, conflicts, autoMerged };
  }

  /** Surface a delta that failed validation as a durable conflict (or skip). */
  private async recordUnreadableDelta(
    userId: string,
    entityType: "myBlock" | "collection",
    cloudId: string,
    cloudUpdatedAt: string,
    cloudRecord: unknown,
    kind: "tree" | "unsupported-version" | "collection",
    markerMap: Map<string, CloudSyncMarker>,
  ): Promise<number> {
    const marker = await this.findMarkerByCloudId(userId, entityType, cloudId, markerMap);
    if (!marker) return 0; // never synced → nothing local to protect, skip safely
    const local =
      entityType === "myBlock"
        ? await this.deps.writer.getBlock(marker.localEntityId)
        : await this.deps.writer.getCollection(marker.localEntityId);
    await this.deps.conflicts.addConflict({
      userId,
      entityType,
      localEntityId: marker.localEntityId,
      cloudEntityId: cloudId,
      kind,
      localRecord: local,
      cloudRecord,
      localModifiedAt: local?.updatedAt ?? this.nowIso(),
      cloudModifiedAt: cloudUpdatedAt,
      status: "open",
    });
    return 1;
  }

  private async applyBlockDecision(
    userId: string,
    remote: CloudMyBlockPayload,
    decision: SyncDecision,
    marker: CloudSyncMarker | null,
    local?: MyBlockRecord,
  ): Promise<{ applied: number; conflicts: number; autoMerged: number }> {
    switch (decision.kind) {
      case "apply-remote": {
        if (remote.deletedAt) {
          if (marker) {
            await this.deps.applier.deleteBlockLocally(
              userId,
              marker.localEntityId,
              remote.id,
              this.deps.deleteThumbnail,
            );
          }
        } else {
          await this.deps.applier.applyBlock(userId, remote, marker);
        }
        await this.ackQueueForEntity(userId, "myBlock", marker?.localEntityId ?? "");
        return { applied: 1, conflicts: 0, autoMerged: 0 };
      }
      case "upload-local":
        return { applied: 0, conflicts: 0, autoMerged: 0 };
      case "link": {
        // Identical content, no baseline → link the local record to the cloud
        // id so future syncs share one lineage (no duplicate copy).
        if (local) {
          await this.linkMarkerFromRemote(userId, "myBlock", local, remote);
          await this.ackQueueForEntity(userId, "myBlock", local.id);
        }
        return { applied: 0, conflicts: 0, autoMerged: 0 };
      }
      case "auto-merge": {
        const merged = decision.merged as MyBlockRecord | CloudMyBlockPayload;
        if ("schemaVersion" in merged) {
          await this.deps.applier.applyBlock(userId, merged as CloudMyBlockPayload, marker);
        } else if (marker) {
          await this.deps.writer.putBlock(merged as MyBlockRecord);
          await this.enqueueExplicitUpload(userId, "myBlock", marker.localEntityId);
        }
        return { applied: 1, conflicts: 0, autoMerged: 1 };
      }
      case "conflict": {
        const local = marker ? await this.deps.writer.getBlock(marker.localEntityId) : undefined;
        await this.upsertConflictRecord(userId, {
          entityType: "myBlock",
          localEntityId: marker?.localEntityId ?? "",
          cloudEntityId: remote.id,
          kind: decision.conflictKind,
          localRecord: local,
          cloudRecord: remote,
          localModifiedAt: local?.updatedAt ?? this.nowIso(),
          cloudModifiedAt: remote.updatedAt,
        });
        return { applied: 0, conflicts: 1, autoMerged: 0 };
      }
      case "no-op":
        return { applied: 0, conflicts: 0, autoMerged: 0 };
    }
  }

  private async applyCollectionDecision(
    userId: string,
    remote: CloudMyBlockCollectionPayload,
    decision: SyncDecision,
    marker: CloudSyncMarker | null,
    local?: MyBlockCollection,
  ): Promise<{ applied: number; conflicts: number; autoMerged: number }> {
    switch (decision.kind) {
      case "apply-remote": {
        if (remote.deletedAt) {
          if (marker) {
            await this.deps.applier.deleteCollectionLocally(userId, marker.localEntityId, remote.id);
          }
        } else {
          await this.deps.applier.applyCollection(userId, remote, marker, {
            reconcileMembership: (localCollectionId, cloudBlockIds) =>
              this.reconcileMembershipForCollection(userId, localCollectionId, cloudBlockIds),
          });
        }
        await this.ackQueueForEntity(userId, "collection", marker?.localEntityId ?? "");
        return { applied: 1, conflicts: 0, autoMerged: 0 };
      }
      case "upload-local":
        return { applied: 0, conflicts: 0, autoMerged: 0 };
      case "link": {
        if (local) {
          await this.linkMarkerFromRemote(userId, "collection", local, remote);
          await this.ackQueueForEntity(userId, "collection", local.id);
        }
        return { applied: 0, conflicts: 0, autoMerged: 0 };
      }
      case "auto-merge": {
        const merged = decision.merged as MyBlockCollection | CloudMyBlockCollectionPayload;
        if ("schemaVersion" in merged) {
          await this.deps.applier.applyCollection(userId, merged as CloudMyBlockCollectionPayload, marker, {
            reconcileMembership: (localCollectionId, cloudBlockIds) =>
              this.reconcileMembershipForCollection(userId, localCollectionId, cloudBlockIds),
          });
        } else if (marker) {
          await this.deps.writer.putCollection(merged as MyBlockCollection);
          await this.enqueueExplicitUpload(userId, "collection", marker.localEntityId);
        }
        return { applied: 1, conflicts: 0, autoMerged: 1 };
      }
      case "conflict": {
        const local = marker ? await this.deps.writer.getCollection(marker.localEntityId) : undefined;
        await this.upsertConflictRecord(userId, {
          entityType: "collection",
          localEntityId: marker?.localEntityId ?? "",
          cloudEntityId: remote.id,
          kind: decision.conflictKind,
          localRecord: local,
          cloudRecord: remote,
          localModifiedAt: local?.updatedAt ?? this.nowIso(),
          cloudModifiedAt: remote.updatedAt,
        });
        return { applied: 0, conflicts: 1, autoMerged: 0 };
      }
      case "no-op":
        return { applied: 0, conflicts: 0, autoMerged: 0 };
    }
  }

  /** Keep one OPEN conflict per entity pair — replace any prior open record. */
  private async upsertConflictRecord(
    userId: string,
    input: {
      entityType: "myBlock" | "collection";
      localEntityId: string;
      cloudEntityId: string;
      kind: "tree" | "delete-edit" | "collection" | "unsupported-version";
      localRecord?: unknown;
      cloudRecord?: unknown;
      localModifiedAt: string;
      cloudModifiedAt: string;
    },
  ): Promise<void> {
    const open = await this.deps.conflicts.listOpen(userId);
    const match = open.find(
      (c) => c.entityType === input.entityType && c.cloudEntityId === input.cloudEntityId,
    );
    if (match) {
      await this.deps.conflicts.removeConflict(match.id);
    }
    await this.deps.conflicts.addConflict({ ...input, userId });
  }

  /** Find a marker by its CLOUD id within a per-user lookup map. */
  private findMarkerByCloudId(
    userId: string,
    entityType: "myBlock" | "collection",
    cloudId: string,
    markerMap: Map<string, CloudSyncMarker>,
  ): CloudSyncMarker | null {
    for (const marker of markerMap.values()) {
      if (
        marker.userId === userId &&
        marker.entityType === entityType &&
        marker.cloudEntityId === cloudId
      ) {
        return marker;
      }
    }
    return null;
  }

  /** Create a marker linking an existing local record to a cloud record. */
  private async linkMarkerFromRemote(
    userId: string,
    entityType: "myBlock" | "collection",
    local: MyBlockRecord | MyBlockCollection,
    remote: CloudMyBlockPayload | CloudMyBlockCollectionPayload,
  ): Promise<void> {
    const marker: CloudSyncMarker = {
      key: `${userId}:${entityMarkerKey(entityType, local.id)}`,
      userId,
      entityType,
      localEntityId: local.id,
      cloudEntityId: remote.id,
      lastSyncedUpdatedAt: remote.updatedAt,
      lastSyncedContentRevision:
        entityType === "myBlock" ? (remote as CloudMyBlockPayload).contentRevision : 1,
      lastSyncedHash: cloudHashOfRemote(remote),
      updatedAt: this.nowIso(),
    };
    await this.deps.markers.putMarker(marker);
  }

  private async reconcileMembershipForCollection(
    userId: string,
    localCollectionId: string,
    cloudBlockIds: string[],
  ): Promise<void> {
    const markers = await this.deps.markers.listMarkers(userId);
    const byCloudId = new Map<string, CloudSyncMarker>();
    for (const marker of markers) {
      if (marker.entityType === "myBlock") byCloudId.set(marker.cloudEntityId, marker);
    }
    await this.deps.applier.reconcileMembership(userId, localCollectionId, cloudBlockIds, byCloudId);
  }

  // -------------------------------------------------------------------------
  // Uploads
  // -------------------------------------------------------------------------

  private async enqueueExplicitUpload(
    userId: string,
    entityType: "myBlock" | "collection",
    localEntityId: string,
  ): Promise<void> {
    const record =
      entityType === "myBlock"
        ? await this.deps.writer.getBlock(localEntityId)
        : await this.deps.writer.getCollection(localEntityId);
    if (!record) return;
    const hash =
      entityType === "myBlock"
        ? cloudHashOfLocalBlock(record as MyBlockRecord)
        : hashPayload(record);
    await this.deps.queue.enqueue({
      userId,
      entityType,
      entityId: localEntityId,
      operation: "upsert",
      localRevision: entityType === "myBlock" ? (record as MyBlockRecord).contentRevision ?? 1 : 1,
      payloadHash: hash,
      now: this.nowIso(),
    });
  }

  private async ackQueueForEntity(
    userId: string,
    entityType: "myBlock" | "collection",
    localEntityId: string,
  ): Promise<void> {
    const entries = await this.deps.queue.list(userId, { includeDeferred: true });
    for (const entry of entries) {
      if (entry.entityType === entityType && entry.entityId === localEntityId) {
        await this.deps.queue.ack(entry.id);
      }
    }
  }

  private async processUploadQueue(
    userId: string,
    generation: number,
    skipConflicts: boolean,
  ): Promise<number> {
    const ready = await this.deps.queue.list(userId, { now: this.nowIso() });
    const batch = ready.slice(0, SYNC_UPLOAD_BATCH_SIZE);
    const blocks: CloudMyBlockPayload[] = [];
    const collections: CloudMyBlockCollectionPayload[] = [];
    const tombstones: { entityType: "myBlock" | "collection"; id: string }[] = [];
    const acks: string[] = [];

    for (const entry of batch) {
      if (generation !== this.generation) {
        throw makeCloudSyncError("SYNC_CANCELLED", "Sync was cancelled.");
      }
      if (skipConflicts) {
        const open = await this.deps.conflicts.listOpen(userId);
        if (open.some((c) => c.entityType === entry.entityType && c.localEntityId === entry.entityId)) {
          continue; // wait for the user's decision
        }
      }
      try {
        const handled = await this.prepareUploadEntry(userId, entry, blocks, collections, tombstones);
        if (handled) acks.push(entry.id);
      } catch (err) {
        const error = toCloudSyncError(err);
        const retryCount = entry.retryCount + 1;
        const delay = Math.min(
          SYNC_RETRY_BASE_DELAY_MS * Math.pow(2, Math.min(retryCount, 8)),
          SYNC_RETRY_MAX_DELAY_MS,
        );
        const nextRetryAt = new Date(Date.parse(this.nowIso()) + delay).toISOString();
        await this.deps.queue.markRetry(entry.id, {
          errorCode: error.code,
          nextRetryAt,
          retryCount,
        });
      }
    }

    if (blocks.length > 0) await this.deps.provider.pushBlockBatch(blocks);
    if (collections.length > 0) await this.deps.provider.pushCollectionBatch(collections);
    if (tombstones.length > 0) await this.deps.provider.pushTombstones(tombstones);
    const uploaded = blocks.length + collections.length + tombstones.length;

    for (const ack of acks) {
      await this.deps.queue.ack(ack);
    }
    return uploaded;
  }

  /**
   * Build the actual cloud payload for a queue entry (re-reading the current
   * local state) OR a tombstone. Returns true when the entry can be acked.
   * Payloads are collected into the batch arrays.
   */
  private async prepareUploadEntry(
    userId: string,
    entry: CloudSyncQueueEntry,
    blocks: CloudMyBlockPayload[],
    collections: CloudMyBlockCollectionPayload[],
    tombstones: { entityType: "myBlock" | "collection"; id: string }[],
  ): Promise<boolean> {
    const marker = await this.deps.markers.getMarker(userId, entry.entityType, entry.entityId);

    if (entry.operation === "delete") {
      const cloudId = marker?.cloudEntityId ?? entry.entityId;
      tombstones.push({ entityType: entry.entityType, id: cloudId });
      if (marker) {
        await this.deps.markers.removeMarker(userId, entry.entityType, entry.entityId);
      }
      return true;
    }

    if (entry.entityType === "myBlock") {
      const result = await this.deps.adapter.getMyBlock(entry.entityId);
      if (!result.ok) {
        if (result.error.code === "BLOCK_NOT_FOUND") {
          tombstones.push({ entityType: "myBlock", id: marker?.cloudEntityId ?? entry.entityId });
          if (marker) {
            await this.deps.markers.removeMarker(userId, "myBlock", entry.entityId);
          }
          return true;
        }
        throw makeCloudSyncError("UNKNOWN", result.error.message);
      }
      const record = result.value;
      const serialized = myBlockToCloud(record, { deviceId: await getDeviceId() });
      if (!serialized.ok) throw serialized.error;
      const cloudId = marker?.cloudEntityId ?? serialized.payload.id;
      blocks.push({ ...serialized.payload, id: cloudId });
      await this.setMarkerAfterUpload(userId, "myBlock", entry.entityId, cloudId, record);
      return true;
    }

    const result = await this.deps.adapter.getMyBlockCollection(entry.entityId);
    if (!result.ok) {
      if (result.error.code === "COLLECTION_NOT_FOUND") {
        tombstones.push({ entityType: "collection", id: marker?.cloudEntityId ?? entry.entityId });
        if (marker) {
          await this.deps.markers.removeMarker(userId, "collection", entry.entityId);
        }
        return true;
      }
      throw makeCloudSyncError("UNKNOWN", result.error.message);
    }
    const collection = result.value;
    const blockList = await this.deps.adapter.listMyBlocks();
    const markerMap = await this.deps.markers.buildLookupMap(userId);
    const serialized = collectionToCloud(
      collection,
      blockList.ok ? blockList.value : [],
      markerMap,
    );
    if (!serialized.ok) throw serialized.error;
    const cloudId = marker?.cloudEntityId ?? serialized.payload.id;
    const finalPayload = { ...serialized.payload, id: cloudId };
    collections.push(finalPayload);
    await this.setMarkerAfterUpload(
      userId,
      "collection",
      entry.entityId,
      cloudId,
      collection,
      cloudHashOfRemote(finalPayload),
    );
    return true;
  }

  private async setMarkerAfterUpload(
    userId: string,
    entityType: "myBlock" | "collection",
    localEntityId: string,
    cloudId: string,
    record: MyBlockRecord | MyBlockCollection,
    explicitHash?: string,
  ): Promise<void> {
    const marker: CloudSyncMarker = {
      key: `${userId}:${entityMarkerKey(entityType, localEntityId)}`,
      userId,
      entityType,
      localEntityId,
      cloudEntityId: cloudId,
      lastSyncedUpdatedAt: record.updatedAt,
      lastSyncedContentRevision:
        entityType === "myBlock" ? (record as MyBlockRecord).contentRevision ?? 1 : 1,
      lastSyncedHash:
        entityType === "myBlock"
          ? cloudHashOfLocalBlock(record as MyBlockRecord)
          : (explicitHash ?? hashPayload(record)),
      updatedAt: this.nowIso(),
    };
    await this.deps.markers.putMarker(marker);
  }
}
