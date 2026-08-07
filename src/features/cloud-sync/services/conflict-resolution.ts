// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — conflict resolution actions
//
// BlockTree conflicts are NEVER auto-resolved. The user chooses:
//   keep-local   — the local version wins; it is force-uploaded
//   keep-cloud   — the cloud version replaces the local record
//   keep-both    — the cloud version becomes a NEW independent record with
//                  fresh ids; the local version keeps its own lineage
//   review-later — the conflict stays pending (entity excluded from sync)
//
// Decisions are durable + retry-safe: the conflict status is stored and the
// resulting queue intents survive reloads.
// ---------------------------------------------------------------------------

import type { MyBlockCollection, MyBlockRecord, MyBlocksStorageAdapter } from "@/features/my-blocks/types";
import { createMyBlockId } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import type { CloudConflictStore } from "../conflicts/cloud-conflict-store";
import type { CloudSyncQueue } from "../queue/cloud-sync-queue";
import type { CloudSyncMarkers } from "../markers/cloud-sync-markers";
import type { CloudRemoteApplier, RawLibraryWriter } from "./remote-apply";
import {
  cloudToMyBlock,
  cloudToMyBlockCollection,
  parseCloudMyBlockCollectionPayload,
  parseCloudMyBlockPayload,
} from "../serialization/cloud-serializer";
import { cloudHashOfLocalBlock } from "./conflict-resolver";
import { hashPayload } from "../hash";
import type { CloudConflictRecord, CloudSyncMarker } from "../types";
import { makeCloudSyncError } from "../errors";
import { entityMarkerKey } from "../serialization/cloud-serializer";
import { generateUniqueName } from "@/features/my-blocks/schemas/my-block-schema";

export type ConflictResolution =
  | "keep-local"
  | "keep-cloud"
  | "keep-both"
  | "review-later";

export interface ConflictResolutionDeps {
  conflicts: CloudConflictStore;
  markers: CloudSyncMarkers;
  queue: CloudSyncQueue;
  applier: CloudRemoteApplier;
  writer: RawLibraryWriter;
  adapter: MyBlocksStorageAdapter;
  deleteThumbnail?: (blockId: string) => Promise<void>;
  onRefresh?: () => void;
}

export class ConflictResolverService {
  private deps: ConflictResolutionDeps;

  constructor(deps: ConflictResolutionDeps) {
    this.deps = deps;
  }

  /**
   * Resolve a conflict. Throws a CloudSyncError on invalid input (e.g. a
   * cloud payload that no longer validates).
   */
  async resolve(
    userId: string,
    conflictId: string,
    resolution: ConflictResolution,
  ): Promise<void> {
    const conflict = await this.deps.conflicts.getConflict(conflictId);
    if (!conflict || conflict.userId !== userId) {
      throw makeCloudSyncError("PERMISSION_DENIED", "That conflict no longer exists.");
    }

    switch (resolution) {
      case "keep-local":
        await this.keepLocal(userId, conflict);
        break;
      case "keep-cloud":
        await this.keepCloud(userId, conflict);
        break;
      case "keep-both":
        await this.keepBoth(userId, conflict);
        break;
      case "review-later":
        await this.deps.conflicts.resolveConflict(conflictId, "review-later");
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Keep local — the local version wins and is force-uploaded.
  // -------------------------------------------------------------------------

  private async keepLocal(userId: string, conflict: CloudConflictRecord): Promise<void> {
    if (conflict.entityType === "myBlock") {
      const local = await this.deps.writer.getBlock(conflict.localEntityId);
      if (!local) {
        // The local record was deleted → push the deletion as the resolution.
        const marker = await this.deps.markers.getMarker(
          userId,
          "myBlock",
          conflict.localEntityId,
        );
        if (marker) {
          await this.deps.queue.enqueue({
            userId,
            entityType: "myBlock",
            entityId: conflict.localEntityId,
            operation: "delete",
            localRevision: 0,
            payloadHash: "",
          });
        }
      } else {
        const marker = await this.deps.markers.getMarker(userId, "myBlock", conflict.localEntityId);
        const cloudId = marker?.cloudEntityId ?? conflict.cloudEntityId;
        await this.deps.markers.putMarker(this.markerFor(
          userId,
          "myBlock",
          local,
          cloudId,
          local.updatedAt,
          local.contentRevision ?? 1,
          cloudHashOfLocalBlock(local),
        ));
        await this.deps.queue.enqueue({
          userId,
          entityType: "myBlock",
          entityId: local.id,
          operation: "upsert",
          localRevision: local.contentRevision ?? 1,
          payloadHash: cloudHashOfLocalBlock(local),
        });
      }
    } else {
      const local = await this.deps.writer.getCollection(conflict.localEntityId);
      const marker = await this.deps.markers.getMarker(userId, "collection", conflict.localEntityId);
      const cloudId = marker?.cloudEntityId ?? conflict.cloudEntityId;
      if (local) {
        await this.deps.markers.putMarker(this.markerFor(
          userId,
          "collection",
          local,
          cloudId,
          local.updatedAt,
          1,
          hashPayload(local),
        ));
        await this.deps.queue.enqueue({
          userId,
          entityType: "collection",
          entityId: local.id,
          operation: "upsert",
          localRevision: 1,
          payloadHash: hashPayload(local),
        });
      } else if (cloudId) {
        await this.deps.queue.enqueue({
          userId,
          entityType: "collection",
          entityId: conflict.localEntityId,
          operation: "delete",
          localRevision: 0,
          payloadHash: "",
        });
      }
    }
    await this.deps.conflicts.resolveConflict(conflict.id, "resolved-keep-local");
    this.deps.onRefresh?.();
  }

  // -------------------------------------------------------------------------
  // Keep cloud — the cloud version replaces the local record.
  // -------------------------------------------------------------------------

  private async keepCloud(userId: string, conflict: CloudConflictRecord): Promise<void> {
    if (conflict.entityType === "myBlock") {
      const parsed = parseCloudMyBlockPayload(conflict.cloudRecord);
      if (!parsed.ok) throw parsed.error;
      if (parsed.value.deletedAt) {
        if (conflict.localEntityId) {
          await this.deps.applier.deleteBlockLocally(
            userId,
            conflict.localEntityId,
            parsed.value.id,
            this.deps.deleteThumbnail,
          );
        }
      } else {
        const marker = await this.deps.markers.getMarker(userId, "myBlock", conflict.localEntityId);
        await this.deps.applier.applyBlock(userId, parsed.value, marker ?? null);
      }
    } else {
      const parsed = parseCloudMyBlockCollectionPayload(conflict.cloudRecord);
      if (!parsed.ok) throw parsed.error;
      if (parsed.value.deletedAt) {
        if (conflict.localEntityId) {
          await this.deps.applier.deleteCollectionLocally(userId, conflict.localEntityId, parsed.value.id);
        }
      } else {
        const marker = await this.deps.markers.getMarker(userId, "collection", conflict.localEntityId);
        await this.deps.applier.applyCollection(userId, parsed.value, marker ?? null, {
          reconcileMembership: () => Promise.resolve(),
        });
      }
    }
    await this.deps.conflicts.resolveConflict(conflict.id, "resolved-keep-cloud");
    this.deps.onRefresh?.();
  }

  // -------------------------------------------------------------------------
  // Keep both — independent records with fresh ids; no overwrite.
  // -------------------------------------------------------------------------

  private async keepBoth(userId: string, conflict: CloudConflictRecord): Promise<void> {
    const now = new Date().toISOString();
    if (conflict.entityType === "myBlock") {
      const parsed = parseCloudMyBlockPayload(conflict.cloudRecord);
      if (!parsed.ok) throw parsed.error;

      // 1. Force-upload the LOCAL version over its original cloud lineage.
      const local = await this.deps.writer.getBlock(conflict.localEntityId);
      if (local) {
        const marker = await this.deps.markers.getMarker(userId, "myBlock", conflict.localEntityId);
        const cloudId = marker?.cloudEntityId ?? conflict.cloudEntityId;
        await this.deps.markers.putMarker(this.markerFor(
          userId,
          "myBlock",
          local,
          cloudId,
          local.updatedAt,
          local.contentRevision ?? 1,
          cloudHashOfLocalBlock(local),
        ));
        await this.deps.queue.enqueue({
          userId,
          entityType: "myBlock",
          entityId: local.id,
          operation: "upsert",
          localRevision: local.contentRevision ?? 1,
          payloadHash: cloudHashOfLocalBlock(local),
        });
      }

      // 2. Save the CLOUD version as a brand-new independent personal block
      //    with fresh local + cloud ids (duplicate-safe naming).
      if (!parsed.value.deletedAt) {
        const freshLocalId = createMyBlockId();
        const built = cloudToMyBlock({ payload: parsed.value, localId: freshLocalId });
        if (built.ok) {
          const names = await this.deps.adapter.listMyBlocks();
          const existingNames = names.ok ? names.value.map((b) => b.name) : [];
          const record: MyBlockRecord = {
            ...built.record,
            name: generateUniqueName(built.record.name, existingNames),
          };
          await this.deps.writer.putBlock(record);
          const freshCloudId = `cloud-${freshLocalId}`;
          await this.deps.markers.putMarker(this.markerFor(
            userId,
            "myBlock",
            record,
            freshCloudId,
            now,
            record.contentRevision ?? 1,
            cloudHashOfLocalBlock(record),
          ));
          await this.deps.queue.enqueue({
            userId,
            entityType: "myBlock",
            entityId: freshLocalId,
            operation: "upsert",
            localRevision: record.contentRevision ?? 1,
            payloadHash: cloudHashOfLocalBlock(record),
          });
        }
      }
    } else {
      const parsed = parseCloudMyBlockCollectionPayload(conflict.cloudRecord);
      if (!parsed.ok) throw parsed.error;

      const local = await this.deps.writer.getCollection(conflict.localEntityId);
      if (local) {
        const marker = await this.deps.markers.getMarker(userId, "collection", conflict.localEntityId);
        const cloudId = marker?.cloudEntityId ?? conflict.cloudEntityId;
        await this.deps.markers.putMarker(this.markerFor(
          userId,
          "collection",
          local,
          cloudId,
          local.updatedAt,
          1,
          hashPayload(local),
        ));
        await this.deps.queue.enqueue({
          userId,
          entityType: "collection",
          entityId: local.id,
          operation: "upsert",
          localRevision: 1,
          payloadHash: hashPayload(local),
        });
      }

      if (!parsed.value.deletedAt) {
        const freshLocalId = `collection-${createMyBlockId()}`;
        const built = cloudToMyBlockCollection({ payload: parsed.value, localId: freshLocalId });
        if (built.ok) {
          await this.deps.writer.putCollection(built.collection);
          await this.deps.markers.putMarker(this.markerFor(
            userId,
            "collection",
            built.collection,
            `cloud-${freshLocalId}`,
            now,
            1,
            hashPayload(built.collection),
          ));
          await this.deps.queue.enqueue({
            userId,
            entityType: "collection",
            entityId: freshLocalId,
            operation: "upsert",
            localRevision: 1,
            payloadHash: hashPayload(built.collection),
          });
        }
      }
    }
    await this.deps.conflicts.resolveConflict(conflict.id, "resolved-keep-both");
    this.deps.onRefresh?.();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private markerFor(
    userId: string,
    entityType: "myBlock" | "collection",
    record: MyBlockRecord | MyBlockCollection,
    cloudId: string,
    lastSyncedUpdatedAt: string,
    contentRevision: number,
    hash: string,
  ): CloudSyncMarker {
    return {
      key: `${userId}:${entityMarkerKey(entityType, record.id)}`,
      userId,
      entityType,
      localEntityId: record.id,
      cloudEntityId: cloudId,
      lastSyncedUpdatedAt,
      lastSyncedContentRevision: contentRevision,
      lastSyncedHash: hash,
      updatedAt: new Date().toISOString(),
    };
  }
}
