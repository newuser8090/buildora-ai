// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — initial sign-in merge
//
// When a user signs in on a device for the first time, local and cloud
// libraries must never be blindly overwritten. Choices:
//   merge          — cloud-only records applied; local-only records uploaded;
//                    content-matched records LINKED (same piece, no copies)
//   upload-local   — local records uploaded; matches linked (no duplicates)
//   download-cloud — cloud records applied; matches linked (no duplicates)
//   review         — no automatic action; the review UI drives decisions
//
// Duplicate detection uses content hashes (cloud-relevant payload hash),
// NEVER the name alone. The decision is durable (metadata store) so the flow
// runs once per user per device.
// ---------------------------------------------------------------------------

import { METADATA_KEY_INITIAL_MERGE_PREFIX } from "@/features/persistence/constants";
import { SyncMetadataStore } from "../sync-metadata-store";
import { cloudHashOfLocalBlock, cloudHashOfRemote } from "./conflict-resolver";
import type { CloudSyncMarkers } from "../markers/cloud-sync-markers";
import type { CloudRemoteApplier, RawLibraryWriter, ThumbnailEnsurer } from "./remote-apply";
import type { CloudLibraryProvider } from "../providers/cloud-library-provider";
import type {
  InitialMergeChoice,
  CloudMyBlockPayload,
  CloudMyBlockCollectionPayload,
  CloudSyncMarker,
} from "../types";
import type { MyBlockRecord, MyBlocksStorageAdapter } from "@/features/my-blocks/types";
import { SYNC_DOWNLOAD_BATCH_SIZE } from "../constants";
import { collectionToCloud, myBlockToCloud } from "../serialization/cloud-serializer";
import { getDeviceId } from "../device-id";

export interface InitialMergeSummary {
  localCount: number;
  cloudCount: number;
  matchedCount: number;
  localOnlyCount: number;
  cloudOnlyCount: number;
}

export interface InitialMergeDeps {
  provider: CloudLibraryProvider;
  markers: CloudSyncMarkers;
  applier: CloudRemoteApplier;
  writer: RawLibraryWriter;
  adapter: MyBlocksStorageAdapter;
  deleteThumbnail?: (blockId: string) => Promise<void>;
  thumbnailEnsurer?: ThumbnailEnsurer;
  now?: () => string;
  /** Scoped key/value store for the durable decision + cursor (test-injectable). */
  metadata?: SyncMetadataStore;
}

const MAX_MERGE_PAGES = 10;

export class InitialMergeService {
  private deps: InitialMergeDeps;
  private metadata: SyncMetadataStore;

  constructor(deps: InitialMergeDeps) {
    this.deps = deps;
    this.metadata = deps.metadata ?? new SyncMetadataStore();
  }

  // -------------------------------------------------------------------------
  // Decision persistence
  // -------------------------------------------------------------------------

  private decisionKey(userId: string): string {
    return `${METADATA_KEY_INITIAL_MERGE_PREFIX}${userId}`;
  }

  private cursorKey(userId: string): string {
    return `cloudSyncCursor:${userId}`;
  }

  async hasDecision(userId: string): Promise<boolean> {
    const value = await this.metadata.read(this.decisionKey(userId));
    return value !== undefined && value !== null;
  }

  async recordDecision(userId: string, choice: InitialMergeChoice): Promise<void> {
    await this.metadata.write(this.decisionKey(userId), {
      choice,
      decidedAt: this.deps.now?.() ?? new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Data gathering
  // -------------------------------------------------------------------------

  async fetchCloudLibrary(_userId: string): Promise<{
    blocks: CloudMyBlockPayload[];
    collections: CloudMyBlockCollectionPayload[];
  }> {
    const blocks: CloudMyBlockPayload[] = [];
    const collections: CloudMyBlockCollectionPayload[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_MERGE_PAGES; page += 1) {
      const changes = await this.deps.provider.fetchChanges(cursor, SYNC_DOWNLOAD_BATCH_SIZE);
      for (const block of changes.blocks) {
        if (!block.deletedAt) blocks.push(block);
      }
      for (const collection of changes.collections) {
        if (!collection.deletedAt) collections.push(collection);
      }
      cursor = changes.cursor;
      if (!changes.hasMore) break;
    }
    return { blocks, collections };
  }

  /** Block content-hash → cloud payload map (dedup key). */
  private async buildCloudHashMap(
    cloudBlocks: CloudMyBlockPayload[],
  ): Promise<Map<string, CloudMyBlockPayload[]>> {
    const map = new Map<string, CloudMyBlockPayload[]>();
    for (const block of cloudBlocks) {
      const hash = cloudHashOfRemote(block);
      const list = map.get(hash) ?? [];
      list.push(block);
      map.set(hash, list);
    }
    return map;
  }

  async computeSummary(userId: string): Promise<InitialMergeSummary> {
    const local = await this.deps.adapter.listMyBlocks();
    const cloud = await this.fetchCloudLibrary(userId);
    const localBlocks = local.ok ? local.value : [];
    const cloudHashMap = await this.buildCloudHashMap(cloud.blocks);

    let matched = 0;
    for (const block of localBlocks) {
      const hash = cloudHashOfLocalBlock(block);
      if (hash && (cloudHashMap.get(hash)?.length ?? 0) > 0) matched += 1;
    }

    return {
      localCount: localBlocks.length,
      cloudCount: cloud.blocks.length,
      matchedCount: matched,
      localOnlyCount: Math.max(0, localBlocks.length - matched),
      cloudOnlyCount: Math.max(0, cloud.blocks.length - matched),
    };
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  async execute(userId: string, choice: InitialMergeChoice): Promise<InitialMergeSummary> {
    const local = await this.deps.adapter.listMyBlocks();
    const cloud = await this.fetchCloudLibrary(userId);
    const localBlocks = local.ok ? local.value : [];
    const cloudHashMap = await this.buildCloudHashMap(cloud.blocks);

    let matched = 0;
    const localIdsByHash = new Map<string, MyBlockRecord[]>();

    for (const block of localBlocks) {
      const hash = cloudHashOfLocalBlock(block);
      const matches = hash ? (cloudHashMap.get(hash) ?? []) : [];
      if (matches.length > 0) {
        matched += 1;
        const list = localIdsByHash.get(hash) ?? [];
        list.push(block);
        localIdsByHash.set(hash, list);
      }
    }

    const existingMarkers = await this.deps.markers.listMarkers(userId);
    const hasMarkerForCloud = (cloudId: string): boolean =>
      existingMarkers.some((m) => m.cloudEntityId === cloudId);

    // Link content-matched pairs (local record ↔ cloud record).
    const linkedCloudIds = new Set<string>();
    for (const [hash, localRecords] of localIdsByHash) {
      const cloudMatches = cloudHashMap.get(hash) ?? [];
      let index = 0;
      for (const localRecord of localRecords) {
        const cloudRecord = cloudMatches[index];
        if (!cloudRecord) break;
        if (hasMarkerForCloud(cloudRecord.id)) {
          index += 1;
          continue;
        }
        await this.linkBlockMarker(userId, localRecord, cloudRecord);
        linkedCloudIds.add(cloudRecord.id);
        index += 1;
      }
    }

    let cloudOnlyCount = 0;
    if (choice === "merge" || choice === "download-cloud") {
      for (const block of cloud.blocks) {
        if (linkedCloudIds.has(block.id) || hasMarkerForCloud(block.id)) continue;
        const marker = existingMarkers.find((m) => m.cloudEntityId === block.id);
        await this.deps.applier.applyBlock(userId, block, marker ?? null);
        cloudOnlyCount += 1;
      }
    } else {
      cloudOnlyCount = cloud.blocks.filter((b) => !linkedCloudIds.has(b.id) && !hasMarkerForCloud(b.id)).length;
    }

    let localOnlyCount = 0;
    if (choice === "merge" || choice === "upload-local") {
      for (const block of localBlocks) {
        const hash = cloudHashOfLocalBlock(block);
        const matchedCloud = hash ? (cloudHashMap.get(hash) ?? []) : [];
        // A cloud copy already exists → linked above; never upload a duplicate.
        if (matchedCloud.length > 0) continue;
        // Local-only record → upload as an independent personal copy.
        await this.enqueueBlockUpload(userId, block);
        localOnlyCount += 1;
      }
    } else {
      localOnlyCount = localBlocks.filter((b) => {
        const hash = cloudHashOfLocalBlock(b);
        return !hash || (cloudHashMap.get(hash)?.length ?? 0) === 0;
      }).length;
    }

    // Collections: apply cloud-only collections; enqueue local-only ones.
    await this.reconcileCollections(userId, choice);

    // Advance the cursor past everything fetched so the next regular sync is
    // a small delta (markers already make re-fetching a no-op).
    await this.advanceCursorToCloud(userId, cloud);

    return {
      localCount: localBlocks.length,
      cloudCount: cloud.blocks.length,
      matchedCount: matched,
      localOnlyCount,
      cloudOnlyCount,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async linkBlockMarker(
    userId: string,
    localRecord: MyBlockRecord,
    cloudRecord: CloudMyBlockPayload,
  ): Promise<void> {
    const marker: CloudSyncMarker = {
      key: `${userId}:myBlock:${localRecord.id}`,
      userId,
      entityType: "myBlock",
      localEntityId: localRecord.id,
      cloudEntityId: cloudRecord.id,
      lastSyncedUpdatedAt: cloudRecord.updatedAt,
      lastSyncedContentRevision: cloudRecord.contentRevision,
      lastSyncedHash: cloudHashOfRemote(cloudRecord),
      updatedAt: this.deps.now?.() ?? new Date().toISOString(),
    };
    await this.deps.markers.putMarker(marker);
  }

  private async enqueueBlockUpload(userId: string, block: MyBlockRecord): Promise<void> {
    const serialized = myBlockToCloud(block, { deviceId: await getDeviceId() });
    if (!serialized.ok) return;
    const cloudId = `cloud-${block.id}`;
    // Push directly (upload-only semantics; idempotent upsert by cloud id).
    await this.deps.provider.pushBlockBatch([{ ...serialized.payload, id: cloudId }]);
    const marker: CloudSyncMarker = {
      key: `${userId}:myBlock:${block.id}`,
      userId,
      entityType: "myBlock",
      localEntityId: block.id,
      cloudEntityId: cloudId,
      lastSyncedUpdatedAt: block.updatedAt,
      lastSyncedContentRevision: block.contentRevision ?? 1,
      lastSyncedHash: serialized.ok ? cloudHashOfRemote({ ...serialized.payload, id: cloudId }) : "",
      updatedAt: this.deps.now?.() ?? new Date().toISOString(),
    };
    await this.deps.markers.putMarker(marker);
  }

  private async reconcileCollections(
    userId: string,
    choice: InitialMergeChoice,
  ): Promise<void> {
    const localResult = await this.deps.adapter.listMyBlockCollections();
    const cloud = await this.fetchCloudLibrary(userId);
    const localCollections = localResult.ok ? localResult.value : [];
    const localNames = new Set(localCollections.map((c) => c.name.toLowerCase().trim()));

    // Apply cloud collections that don't match a local collection by name.
    if (choice === "merge" || choice === "download-cloud") {
      for (const cloudCollection of cloud.collections) {
        const nameMatch = localNames.has(cloudCollection.name.toLowerCase().trim());
        if (nameMatch) {
          // Link by name (collections are low-stakes; block content is the
          // authoritative dedup key).
          const local = localCollections.find(
            (c) => c.name.toLowerCase().trim() === cloudCollection.name.toLowerCase().trim(),
          );
          if (local) {
            const marker: CloudSyncMarker = {
              key: `${userId}:collection:${local.id}`,
              userId,
              entityType: "collection",
              localEntityId: local.id,
              cloudEntityId: cloudCollection.id,
              lastSyncedUpdatedAt: cloudCollection.updatedAt,
              lastSyncedContentRevision: 1,
              lastSyncedHash: cloudHashOfRemote(cloudCollection),
              updatedAt: this.deps.now?.() ?? new Date().toISOString(),
            };
            await this.deps.markers.putMarker(marker);
          }
          continue;
        }
        await this.deps.applier.applyCollection(userId, cloudCollection, null, {
          reconcileMembership: () => Promise.resolve(),
        });
      }
    }

    // Upload local-only collections.
    if (choice === "merge" || choice === "upload-local") {
      const cloudNames = new Set(cloud.collections.map((c) => c.name.toLowerCase().trim()));
      for (const collection of localCollections) {
        if (cloudNames.has(collection.name.toLowerCase().trim())) continue;
        const blockList = await this.deps.adapter.listMyBlocks();
        const markerMap = await this.deps.markers.buildLookupMap(userId);
        const serialized = collectionToCloud(
          collection,
          blockList.ok ? blockList.value : [],
          markerMap,
        );
        if (!serialized.ok) continue;
        const cloudId = `cloud-${collection.id}`;
        await this.deps.provider.pushCollectionBatch([{ ...serialized.payload, id: cloudId }]);
        const marker: CloudSyncMarker = {
          key: `${userId}:collection:${collection.id}`,
          userId,
          entityType: "collection",
          localEntityId: collection.id,
          cloudEntityId: cloudId,
          lastSyncedUpdatedAt: collection.updatedAt,
          lastSyncedContentRevision: 1,
          lastSyncedHash: cloudHashOfRemote({ ...serialized.payload, id: cloudId }),
          updatedAt: this.deps.now?.() ?? new Date().toISOString(),
        };
        await this.deps.markers.putMarker(marker);
      }
    }
  }

  private async advanceCursorToCloud(
    userId: string,
    cloud: { blocks: CloudMyBlockPayload[]; collections: CloudMyBlockCollectionPayload[] },
  ): Promise<void> {
    const all = [
      ...cloud.blocks.map((b) => ({ ts: b.updatedAt, id: b.id })),
      ...cloud.collections.map((c) => ({ ts: c.updatedAt, id: c.id })),
    ].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
    const last = all[all.length - 1];
    if (last) {
      await this.metadata.write(this.cursorKey(userId), `${last.ts}|${last.id}`);
    }
  }
}
