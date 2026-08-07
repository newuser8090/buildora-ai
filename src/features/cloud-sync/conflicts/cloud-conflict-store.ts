// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — durable conflict store (cloudSyncConflicts store)
//
// Conflict records and their decisions must survive reloads and be retry-safe,
// so they live in IndexedDB rather than memory. BlockTree conflicts are never
// silently overwritten — they stay open until the user decides.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_CLOUD_SYNC_CONFLICTS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type {
  CloudConflictRecord,
  CloudConflictStatus,
} from "../types";

let conflictIdCounter = 0;
const conflictSalt = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    }
  } catch {
    // fall through
  }
  return Math.random().toString(36).slice(2, 10);
})();

function createConflictId(): string {
  conflictIdCounter += 1;
  return `cf-${Date.now().toString(36)}-${conflictSalt}-${conflictIdCounter}`;
}

export class CloudConflictStore {
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

  async addConflict(
    input: Omit<CloudConflictRecord, "id" | "status" | "createdAt" | "updatedAt"> & {
      status?: CloudConflictStatus;
    },
  ): Promise<CloudConflictRecord> {
    const now = new Date().toISOString();
    const record: CloudConflictRecord = {
      ...input,
      id: createConflictId(),
      status: input.status ?? "open",
      createdAt: now,
      updatedAt: now,
    };
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return record;
  }

  async getConflict(id: string): Promise<CloudConflictRecord | undefined> {
    const db = await this.ensureOpen();
    return new Promise<CloudConflictRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readonly");
      const request = tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS).get(id);
      request.onsuccess = () => resolve(request.result as CloudConflictRecord | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  /** Open conflicts for a user (newest first). */
  async listOpen(userId: string): Promise<CloudConflictRecord[]> {
    const all = await this.listAll(userId);
    return all.filter((c) => c.status === "open");
  }

  async listAll(userId: string): Promise<CloudConflictRecord[]> {
    const db = await this.ensureOpen();
    const all = await new Promise<CloudConflictRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readonly");
      const request = tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS).getAll();
      request.onsuccess = () => resolve(request.result as CloudConflictRecord[]);
      request.onerror = () => reject(request.error);
    });
    return all
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Mark a conflict as resolved (decision). Decision is durable + retry-safe. */
  async resolveConflict(
    id: string,
    status: CloudConflictStatus,
  ): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS);
      const get = store.get(id);
      get.onsuccess = () => {
        const record = get.result as CloudConflictRecord | undefined;
        if (!record) return;
        store.put({
          ...record,
          status,
          decisionAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Remove a conflict record (after resolution is fully applied). */
  async removeConflict(id: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Open conflict count for a user. */
  async countOpen(userId: string): Promise<number> {
    const open = await this.listOpen(userId);
    return open.length;
  }

  /** Remove all conflict records for a user (explicit "remove cloud data"). */
  async clearForUser(userId: string): Promise<void> {
    const all = await this.listAll(userId);
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readwrite");
      const store = tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS);
      for (const record of all) store.delete(record.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Test helper — wipe the store. */
  async clearForTests(): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CLOUD_SYNC_CONFLICTS, "readwrite");
      tx.objectStore(STORE_CLOUD_SYNC_CONFLICTS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
