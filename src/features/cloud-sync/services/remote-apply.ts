// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — remote apply path
//
// Applies validated cloud records to the LOCAL library through a raw
// IndexedDB path that NEVER emits local-user mutation events — this is what
// prevents echo loops (remote applies must not re-enqueue uploads).
//
// Rules:
//   - every remote record is schema-validated before any write
//   - local-only fields (favorite, usage counters) are preserved on update
//   - fresh local ids are assigned to brand-new downloads
//   - markers are written so the next sync has a correct baseline
//   - thumbnails are regenerated locally (best-effort, never blocking)
//   - deletions remove the local record + thumbnail + marker
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_MY_BLOCKS,
  STORE_MY_BLOCK_COLLECTIONS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import {
  parseMyBlockCollection,
  parseMyBlockRecord,
} from "@/features/my-blocks/schemas/my-block-schema";
import { createMyBlockId } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import type {
  MyBlockCollection,
  MyBlockRecord,
} from "@/features/my-blocks/types";
import { makeCloudSyncError, type CloudSyncError } from "../errors";
import {
  cloudToMyBlock,
  cloudToMyBlockCollection,
} from "../serialization/cloud-serializer";
import { cloudHashOfRemote } from "./conflict-resolver";
import type {
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudSyncMarker,
} from "../types";

// ---------------------------------------------------------------------------
// Raw library writer (no mutation events)
// ---------------------------------------------------------------------------

export class RawLibraryWriter {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private dbName: string;
  private dbVersion: number;
  private idbFactory: IDBFactory | undefined;

  constructor(options?: { dbName?: string; dbVersion?: number; indexedDb?: IDBFactory }) {
    this.dbName = options?.dbName ?? DATABASE_NAME;
    this.dbVersion = options?.dbVersion ?? DATABASE_VERSION;
    this.idbFactory =
      options?.indexedDb !== undefined
        ? options.indexedDb
        : typeof globalThis.indexedDB !== "undefined"
          ? globalThis.indexedDB
          : undefined;
  }

  private ensureOpen(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (!this.openPromise) {
      this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (!this.idbFactory || typeof this.idbFactory.open !== "function") {
          reject(new Error("IndexedDB is not available."));
          return;
        }
        const request = this.idbFactory.open(this.dbName, this.dbVersion);
        request.onupgradeneeded = (event) => {
          ensureDatabaseStores((event.target as IDBOpenDBRequest).result);
        };
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          db.onversionchange = () => {
            this.db = null;
            this.openPromise = null;
            db.close();
          };
          resolve(db);
        };
        request.onerror = () =>
          reject((request as IDBOpenDBRequest).error ?? new Error("open failed"));
      });
    }
    return this.openPromise;
  }

  async putBlock(record: MyBlockRecord): Promise<void> {
    const parsed = parseMyBlockRecord(record);
    if (!parsed) {
      throw makeCloudSyncError("REMOTE_VALIDATION_FAILED", "A cloud copy could not be written.");
    }
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCKS, "readwrite");
      tx.objectStore(STORE_MY_BLOCKS).put(parsed as MyBlockRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteBlock(id: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCKS, "readwrite");
      tx.objectStore(STORE_MY_BLOCKS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBlock(id: string): Promise<MyBlockRecord | undefined> {
    const db = await this.ensureOpen();
    return new Promise<MyBlockRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCKS, "readonly");
      const request = tx.objectStore(STORE_MY_BLOCKS).get(id);
      request.onsuccess = () => {
        const raw = request.result as unknown;
        const parsed = parseMyBlockRecord(raw);
        resolve(parsed ? (parsed as MyBlockRecord) : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async listBlocks(): Promise<MyBlockRecord[]> {
    const db = await this.ensureOpen();
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCKS, "readonly");
      const request = tx.objectStore(STORE_MY_BLOCKS).getAll();
      request.onsuccess = () => resolve(request.result as unknown[]);
      request.onerror = () => reject(request.error);
    });
    const out: MyBlockRecord[] = [];
    for (const raw of all) {
      const parsed = parseMyBlockRecord(raw);
      if (parsed) out.push(parsed as MyBlockRecord);
    }
    return out;
  }

  async putCollection(collection: MyBlockCollection): Promise<void> {
    const parsed = parseMyBlockCollection(collection);
    if (!parsed) {
      throw makeCloudSyncError("REMOTE_VALIDATION_FAILED", "A cloud collection could not be written.");
    }
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCK_COLLECTIONS, "readwrite");
      tx.objectStore(STORE_MY_BLOCK_COLLECTIONS).put(parsed as MyBlockCollection);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteCollection(id: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCK_COLLECTIONS, "readwrite");
      tx.objectStore(STORE_MY_BLOCK_COLLECTIONS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCollection(id: string): Promise<MyBlockCollection | undefined> {
    const db = await this.ensureOpen();
    return new Promise<MyBlockCollection | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_MY_BLOCK_COLLECTIONS, "readonly");
      const request = tx.objectStore(STORE_MY_BLOCK_COLLECTIONS).get(id);
      request.onsuccess = () => {
        const raw = request.result as unknown;
        const parsed = parseMyBlockCollection(raw);
        resolve(parsed ? (parsed as MyBlockCollection) : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async putBlockMembership(record: MyBlockRecord): Promise<void> {
    await this.putBlock(record);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.openPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Remote applier
// ---------------------------------------------------------------------------

export type ThumbnailEnsurer = (record: MyBlockRecord) => Promise<void>;

export interface RemoteApplyResult {
  /** What happened to the local record. */
  outcome: "created" | "updated" | "deleted" | "skipped";
  localId: string;
  cloudId: string;
}

export class CloudRemoteApplier {
  private writer: RawLibraryWriter;
  private markers: {
    put: (marker: CloudSyncMarker) => Promise<void>;
    remove: (userId: string, entityType: "myBlock" | "collection", localId: string) => Promise<void>;
  };
  private ensureThumbnail: ThumbnailEnsurer;

  constructor(deps: {
    writer?: RawLibraryWriter;
    markers: {
      put: (marker: CloudSyncMarker) => Promise<void>;
      remove: (userId: string, entityType: "myBlock" | "collection", localId: string) => Promise<void>;
    };
    ensureThumbnail?: ThumbnailEnsurer;
  }) {
    this.writer = deps.writer ?? new RawLibraryWriter();
    this.markers = deps.markers;
    this.ensureThumbnail = deps.ensureThumbnail ?? (async () => undefined);
  }

  /**
   * Apply a validated cloud block. When the record already exists locally
   * (marker present), local-only fields are preserved. Returns the local id.
   */
  async applyBlock(
    userId: string,
    payload: CloudMyBlockPayload,
    existingMarker: CloudSyncMarker | null,
  ): Promise<RemoteApplyResult> {
    const localId = existingMarker?.localEntityId ?? createMyBlockId();
    const existing = await this.writer.getBlock(localId);

    const built = cloudToMyBlock({ payload, localId });
    if (!built.ok) {
      throw built.error;
    }
    const incoming = built.record;

    // Preserve per-device fields when updating an existing local record.
    const merged: MyBlockRecord = existing
      ? {
          ...incoming,
          favorite: existing.favorite,
          lastUsedAt: existing.lastUsedAt,
          useCount: existing.useCount,
          thumbnail: existing.thumbnail?.revision === incoming.contentRevision ? existing.thumbnail : undefined,
        }
      : incoming;

    await this.writer.putBlock(merged);

    const marker: CloudSyncMarker = {
      key: `${userId}:myBlock:${localId}`,
      userId,
      entityType: "myBlock",
      localEntityId: localId,
      cloudEntityId: payload.id,
      lastSyncedUpdatedAt: payload.updatedAt,
      lastSyncedContentRevision: payload.contentRevision,
      lastSyncedHash: cloudHashOfRemote(payload),
      updatedAt: new Date().toISOString(),
    };
    await this.markers.put(marker);

    // Regenerate thumbnails locally (never blocks core sync).
    await this.ensureThumbnail(merged).catch(() => undefined);

    return {
      outcome: existing ? "updated" : "created",
      localId,
      cloudId: payload.id,
    };
  }

  /** Apply a validated cloud collection (+ reconcile block membership). */
  async applyCollection(
    userId: string,
    payload: CloudMyBlockCollectionPayload,
    existingMarker: CloudSyncMarker | null,
    options: { reconcileMembership?: (localCollectionId: string, cloudBlockIds: string[]) => Promise<void> },
  ): Promise<RemoteApplyResult> {
    const localId = existingMarker?.localEntityId ?? `collection-${createMyBlockId()}`;
    const built = cloudToMyBlockCollection({ payload, localId });
    if (!built.ok) throw built.error;
    await this.writer.putCollection(built.collection);

    const marker: CloudSyncMarker = {
      key: `${userId}:collection:${localId}`,
      userId,
      entityType: "collection",
      localEntityId: localId,
      cloudEntityId: payload.id,
      lastSyncedUpdatedAt: payload.updatedAt,
      lastSyncedContentRevision: 1,
      lastSyncedHash: cloudHashOfRemote(payload),
      updatedAt: new Date().toISOString(),
    };
    await this.markers.put(marker);

    if (options.reconcileMembership) {
      await options.reconcileMembership(localId, payload.blockIds);
    }

    return {
      outcome: existingMarker ? "updated" : "created",
      localId,
      cloudId: payload.id,
    };
  }

  /** Apply a remote deletion for a block: remove local record + thumbnail. */
  async deleteBlockLocally(
    userId: string,
    localId: string,
    cloudId: string,
    deleteThumbnail?: (blockId: string) => Promise<void>,
  ): Promise<void> {
    await this.writer.deleteBlock(localId);
    await this.markers.remove(userId, "myBlock", localId);
    await (deleteThumbnail ? deleteThumbnail(localId).catch(() => undefined) : undefined);
    void cloudId;
  }

  /** Apply a remote deletion for a collection. */
  async deleteCollectionLocally(
    userId: string,
    localId: string,
    cloudId: string,
  ): Promise<void> {
    await this.writer.deleteCollection(localId);
    await this.markers.remove(userId, "collection", localId);
    void cloudId;
  }

  /**
   * Reconcile block↔collection membership after a collection download:
   * local blocks whose cloud id is in the collection's cloud blockIds become
   * members; local members that are no longer in the cloud list are removed.
   */
  async reconcileMembership(
    userId: string,
    localCollectionId: string,
    cloudBlockIds: string[],
    markersByCloudId: Map<string, CloudSyncMarker>,
  ): Promise<void> {
    const blocks = await this.writer.listBlocks();
    const cloudSet = new Set(cloudBlockIds);
    let changed = false;
    for (const block of blocks) {
      const marker = markersByCloudId.get(block.id);
      const isMember = cloudSet.has(marker?.cloudEntityId ?? "");
      const currently = !!block.collectionIds?.includes(localCollectionId);
      if (isMember && !currently) {
        block.collectionIds = [...(block.collectionIds ?? []), localCollectionId];
        changed = true;
      } else if (!isMember && currently && block.collectionIds) {
        block.collectionIds = block.collectionIds.filter((id) => id !== localCollectionId);
        changed = true;
      }
    }
    if (changed) {
      for (const block of blocks) {
        await this.writer.putBlockMembership(block);
      }
    }
    void userId;
  }
}

/** Convenience error factory matching the applier's throw contract. */
export function remoteApplyError(message: string): CloudSyncError {
  return makeCloudSyncError("REMOTE_VALIDATION_FAILED", message);
}
