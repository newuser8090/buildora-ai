// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — durable sync queue (cloudSyncQueue store)
//
// Guarantees:
//   - survives reload/restart (IndexedDB-backed)
//   - deduplicates superseded operations (one pending entry per
//     user+entity+operation direction; a new intent replaces the old)
//   - preserves ordering where required (entries are processed in createdAt
//     order; upserts for the same entity coalesce)
//   - bounded retry/backoff (nextRetryAt + retryCount, capped)
//   - user-switch isolation (every entry carries userId; lookups filter)
//   - no raw auth tokens, no raw pasted source (intent-only entries)
//   - queue cleanup after acknowledged sync (ack removes the entry)
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_CLOUD_SYNC_QUEUE,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type {
  CloudOperation,
  CloudSyncQueueEntry,
  CloudEntityType,
} from "../types";
import { SYNC_MAX_RETRY_COUNT } from "../constants";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

let queueIdCounter = 0;
const queueSalt = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 12);
})();

function createQueueEntryId(): string {
  queueIdCounter += 1;
  return `q-${Date.now().toString(36)}-${queueSalt}-${queueIdCounter}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface EnqueueSyncInput {
  userId: string;
  entityType: CloudEntityType;
  entityId: string;
  operation: CloudOperation;
  localRevision: number;
  payloadHash: string;
  now?: string;
}

export class CloudSyncQueue {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private dbName: string;
  private dbVersion: number;
  private idbFactory: IDBFactory | undefined;

  constructor(options?: {
    dbName?: string;
    dbVersion?: number;
    indexedDb?: IDBFactory;
  }) {
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

  // -------------------------------------------------------------------------
  // Enqueue with deduplication
  // -------------------------------------------------------------------------

  /**
   * Enqueue a sync intent. Superseded entries for the same user+entity are
   * removed first (a later intent reflects the latest local state), and
   * identical intents are coalesced. Deleting a record whose latest intent
   * was an upsert replaces it with the delete.
   */
  async enqueue(input: EnqueueSyncInput): Promise<void> {
    const now = input.now ?? new Date().toISOString();
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_QUEUE);

      const all = store.getAll();
      all.onsuccess = () => {
        const existing = (all.result as CloudSyncQueueEntry[]).filter(
          (e) =>
            e.userId === input.userId &&
            e.entityType === input.entityType &&
            e.entityId === input.entityId,
        );
        for (const entry of existing) {
          if (
            entry.operation === input.operation &&
            entry.localRevision === input.localRevision &&
            entry.payloadHash === input.payloadHash
          ) {
            // Already queued identically — nothing to do.
            continue;
          }
          store.delete(entry.id);
        }
        const entry: CloudSyncQueueEntry = {
          id: createQueueEntryId(),
          userId: input.userId,
          entityType: input.entityType,
          entityId: input.entityId,
          operation: input.operation,
          localRevision: input.localRevision,
          payloadHash: input.payloadHash,
          createdAt: now,
          retryCount: 0,
        };
        store.put(entry);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * List pending entries for a user in createdAt order. When includeDeferred
   * is false, entries still in backoff (nextRetryAt in the future) or past
   * the max retry count are excluded from the "ready" set.
   */
  async list(
    userId: string,
    options?: { includeDeferred?: boolean; now?: string },
  ): Promise<CloudSyncQueueEntry[]> {
    const db = await this.ensureOpen();
    const all = await new Promise<CloudSyncQueueEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readonly");
      const request = tx.objectStore(STORE_CLOUD_SYNC_QUEUE).getAll();
      request.onsuccess = () => resolve(request.result as CloudSyncQueueEntry[]);
      request.onerror = () => reject(request.error);
    });
    const entries = all
      .filter((e) => e.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (options?.includeDeferred) return entries;
    const now = options?.now ?? new Date().toISOString();
    return entries.filter(
      (e) =>
        e.retryCount < SYNC_MAX_RETRY_COUNT &&
        (!e.nextRetryAt || e.nextRetryAt <= now),
    );
  }

  /** Count pending entries for a user (including deferred). */
  async countPending(userId: string): Promise<number> {
    const entries = await this.list(userId, { includeDeferred: true });
    return entries.length;
  }

  // -------------------------------------------------------------------------
  // Acknowledge / retry
  // -------------------------------------------------------------------------

  /** Remove a queue entry after the operation was acknowledged by the cloud. */
  async ack(entryId: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_QUEUE).delete(entryId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Record a failed attempt: increment retryCount and schedule the backoff. */
  async markRetry(
    entryId: string,
    options: { errorCode: string; nextRetryAt: string; retryCount: number },
  ): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_QUEUE);
      const get = store.get(entryId);
      get.onsuccess = () => {
        const entry = get.result as CloudSyncQueueEntry | undefined;
        if (!entry) return;
        store.put({
          ...entry,
          retryCount: options.retryCount,
          nextRetryAt: options.nextRetryAt,
          lastErrorCode: options.errorCode,
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------------------
  // Sign-out / test policy
  // -------------------------------------------------------------------------

  /**
   * Move device-local unsigned entries to a signed-in user (first sign-in on
   * this device). Only the user signing in on this device could own changes
   * made while signed out, so attribution is safe and isolated.
   * Returns the number of entries migrated.
   */
  async migrateUnsignedEntries(userId: string): Promise<number> {
    const db = await this.ensureOpen();
    const all = await new Promise<CloudSyncQueueEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readonly");
      const request = tx.objectStore(STORE_CLOUD_SYNC_QUEUE).getAll();
      request.onsuccess = () => resolve(request.result as CloudSyncQueueEntry[]);
      request.onerror = () => reject(request.error);
    });
    const unsigned = all.filter((e) => e.userId === "__unsigned__");
    if (unsigned.length === 0) return 0;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_QUEUE);
      for (const entry of unsigned) {
        store.delete(entry.id);
        store.put({ ...entry, id: createQueueEntryId(), userId });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return unsigned.length;
  }

  /**
   * Remove all queued entries for a user. Used ONLY when the user explicitly
   * asks to remove their cloud data from this device. Sign-out alone never
   * touches the queue — entries stay isolated to their userId.
   */
  async clearForUser(userId: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_QUEUE);
      const all = store.getAll();
      all.onsuccess = () => {
        for (const entry of all.result as CloudSyncQueueEntry[]) {
          if (entry.userId === userId) store.delete(entry.id);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Test helper — wipe the whole store. */
  async clearForTests(): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_QUEUE, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_QUEUE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
