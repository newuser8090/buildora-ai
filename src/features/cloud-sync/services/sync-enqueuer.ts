// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — sync enqueuer
//
// Subscribes to the canonical my-blocks adapter's local mutation events and
// enqueues durable sync intents. There is NO parallel write path — the
// adapter stays canonical and the enqueuer just observes.
//
// While signed out, mutations are attributed to an UNSIGNED device bucket so
// no work is lost (local-first: "keep working locally while signed out").
// On the next sign-in, unsigned entries migrate to that user's queue — the
// only user who could own them is whoever signs in on this device.
// ---------------------------------------------------------------------------

import type { MyBlockLocalMutationEvent } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import { cloudHashOfLocalBlock } from "./conflict-resolver";
import { hashPayload } from "../hash";
import type { CloudSyncQueue } from "../queue/cloud-sync-queue";
import type {
  MyBlockCollection,
  MyBlockRecord,
  MyBlocksStorageAdapter,
} from "@/features/my-blocks/types";

/** Device-local bucket for changes made while signed out. Never synced as-is. */
export const UNSIGNED_USER_ID = "__unsigned__";

export class SyncEnqueuer {
  private queue: CloudSyncQueue;
  private adapter: MyBlocksStorageAdapter;
  private onQueued?: () => void;

  constructor(deps: {
    queue: CloudSyncQueue;
    adapter: MyBlocksStorageAdapter;
    onQueued?: () => void;
  }) {
    this.queue = deps.queue;
    this.adapter = deps.adapter;
    this.onQueued = deps.onQueued;
  }

  /** Handle a local mutation event from the adapter. */
  async handleLocalMutation(
    event: MyBlockLocalMutationEvent,
    userId: string,
  ): Promise<void> {
    if (event.entityType === "myBlock") {
      await this.enqueueBlock(event, userId);
    } else {
      await this.enqueueCollection(event, userId);
    }
    this.onQueued?.();
  }

  private async enqueueBlock(
    event: MyBlockLocalMutationEvent,
    userId: string,
  ): Promise<void> {
    if (event.operation === "delete") {
      await this.queue.enqueue({
        userId,
        entityType: "myBlock",
        entityId: event.entityId,
        operation: "delete",
        localRevision: 0,
        payloadHash: "",
      });
    } else {
      const result = await this.adapter.getMyBlock(event.entityId);
      if (!result.ok) return; // record already gone — superseded by a delete event
      const record = result.value;
      await this.queue.enqueue({
        userId,
        entityType: "myBlock",
        entityId: event.entityId,
        operation: "upsert",
        localRevision: record.contentRevision ?? 1,
        payloadHash: cloudHashOfLocalBlock(record),
      });
    }
    // Membership lives on the cloud collection record — make sure the affected
    // collections are re-uploaded (their blockIds are rebuilt from local state).
    for (const collectionId of event.collectionIds ?? []) {
      await this.enqueueCollectionUpsert(userId, collectionId);
    }
  }

  private async enqueueCollection(
    event: MyBlockLocalMutationEvent,
    userId: string,
  ): Promise<void> {
    if (event.operation === "delete") {
      await this.queue.enqueue({
        userId,
        entityType: "collection",
        entityId: event.entityId,
        operation: "delete",
        localRevision: 0,
        payloadHash: "",
      });
      return;
    }
    await this.enqueueCollectionUpsert(userId, event.entityId);
  }

  private async enqueueCollectionUpsert(
    userId: string,
    collectionId: string,
  ): Promise<void> {
    const result = await this.adapter.getMyBlockCollection(collectionId);
    if (!result.ok) return;
    const collection = result.value;
    await this.queue.enqueue({
      userId,
      entityType: "collection",
      entityId: collectionId,
      operation: "upsert",
      localRevision: 1,
      payloadHash: hashPayload(collection),
    });
  }
}

/**
 * Reconcile the queue with the current local library on sign-in: enqueue
 * upserts for records that have never synced (no marker) or whose cloud-
 * relevant content changed since the last sync (marker hash differs).
 */
export async function reconcileQueueWithLocalLibrary(
  userId: string,
  deps: {
    queue: CloudSyncQueue;
    adapter: MyBlocksStorageAdapter;
    markers: {
      getMarker: (userId: string, entityType: "myBlock" | "collection", localId: string) => Promise<unknown>;
    };
    hashOf: {
      block: (record: MyBlockRecord) => string;
      collection: (collection: MyBlockCollection) => string;
    };
  },
): Promise<void> {
  const blockResult = await deps.adapter.listMyBlocks();
  if (blockResult.ok) {
    for (const block of blockResult.value) {
      const marker = (await deps.markers.getMarker(userId, "myBlock", block.id)) as {
        lastSyncedHash?: string;
      } | undefined;
      const hash = deps.hashOf.block(block);
      if (!marker || (hash && hash !== marker.lastSyncedHash)) {
        await deps.queue.enqueue({
          userId,
          entityType: "myBlock",
          entityId: block.id,
          operation: "upsert",
          localRevision: block.contentRevision ?? 1,
          payloadHash: hash,
        });
      }
    }
  }
  const collectionResult = await deps.adapter.listMyBlockCollections();
  if (collectionResult.ok) {
    for (const collection of collectionResult.value) {
      const marker = (await deps.markers.getMarker(userId, "collection", collection.id)) as {
        lastSyncedHash?: string;
      } | undefined;
      const hash = deps.hashOf.collection(collection);
      if (!marker || (hash && hash !== marker.lastSyncedHash)) {
        await deps.queue.enqueue({
          userId,
          entityType: "collection",
          entityId: collection.id,
          operation: "upsert",
          localRevision: 1,
          payloadHash: hash,
        });
      }
    }
  }
}
