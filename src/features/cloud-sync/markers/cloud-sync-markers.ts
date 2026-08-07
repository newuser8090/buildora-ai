// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — sync markers (cloudSyncMarkers store)
//
// Markers map a local entity id to its cloud id and hold the last-synced
// baseline (updatedAt + contentRevision + payload hash) used for conflict
// detection. They are local-only bookkeeping — never uploaded, never part of
// the record itself, and isolated per user.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_CLOUD_SYNC_MARKERS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import { entityMarkerKey } from "../serialization/cloud-serializer";
import type { CloudEntityType, CloudSyncMarker } from "../types";

export function markerStoreKey(
  userId: string,
  entityType: CloudEntityType,
  localEntityId: string,
): string {
  return `${userId}:${entityMarkerKey(entityType, localEntityId)}`;
}

export class CloudSyncMarkers {
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
          const db = (event.target as IDBOpenDBRequest).result;
          ensureDatabaseStores(db);
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

  async getMarker(
    userId: string,
    entityType: CloudEntityType,
    localEntityId: string,
  ): Promise<CloudSyncMarker | undefined> {
    const key = markerStoreKey(userId, entityType, localEntityId);
    const db = await this.ensureOpen();
    return new Promise<CloudSyncMarker | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_MARKERS, "readonly");
      const request = tx.objectStore(STORE_CLOUD_SYNC_MARKERS).get(key);
      request.onsuccess = () => resolve(request.result as CloudSyncMarker | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async putMarker(marker: CloudSyncMarker): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_MARKERS, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_MARKERS).put(marker);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeMarker(
    userId: string,
    entityType: CloudEntityType,
    localEntityId: string,
  ): Promise<void> {
    const key = markerStoreKey(userId, entityType, localEntityId);
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_MARKERS, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_MARKERS).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** All markers for a user (used by the serializer for id remapping). */
  async listMarkers(userId: string): Promise<CloudSyncMarker[]> {
    const db = await this.ensureOpen();
    const all = await new Promise<CloudSyncMarker[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_MARKERS, "readonly");
      const request = tx.objectStore(STORE_CLOUD_SYNC_MARKERS).getAll();
      request.onsuccess = () => resolve(request.result as CloudSyncMarker[]);
      request.onerror = () => reject(request.error);
    });
    return all.filter((m) => m.userId === userId);
  }

  /** Build a lookup map keyed by `${entityType}:${localId}` (serializer input). */
  async buildLookupMap(
    userId: string,
  ): Promise<Map<string, CloudSyncMarker>> {
    const markers = await this.listMarkers(userId);
    const map = new Map<string, CloudSyncMarker>();
    for (const marker of markers) {
      map.set(entityMarkerKey(marker.entityType, marker.localEntityId), marker);
    }
    return map;
  }

  /** Remove all markers for a user (explicit "remove cloud data" only). */
  async clearForUser(userId: string): Promise<void> {
    const markers = await this.listMarkers(userId);
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_MARKERS, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_MARKERS);
      for (const marker of markers) store.delete(marker.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Test helper — wipe the store. */
  async clearForTests(): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_MARKERS, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_MARKERS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
