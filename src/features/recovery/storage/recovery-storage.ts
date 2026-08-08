// ---------------------------------------------------------------------------
// Draft Recovery (Phase P9) — IndexedDB storage adapter
//
// Persists RecoverySnapshot objects in the "recoverySnapshots" store
// (database version 8). Shares the canonical ensureDatabaseStores() helper.
// Snapshots are bounded per project (eviction handled by the service).
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_RECOVERY_SNAPSHOTS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { RecoveryError, RecoverySnapshot } from "../types";

export type RecoveryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RecoveryError };

export interface RecoveryStorageAdapter {
  listSnapshots(projectId: string): Promise<RecoveryResult<RecoverySnapshot[]>>;
  getSnapshot(snapshotId: string): Promise<RecoveryResult<RecoverySnapshot | null>>;
  saveSnapshot(snapshot: RecoverySnapshot): Promise<RecoveryResult<RecoverySnapshot>>;
  deleteSnapshot(snapshotId: string): Promise<RecoveryResult<void>>;
  countSnapshots(projectId: string): Promise<RecoveryResult<number>>;
  clearForProject(projectId: string): Promise<RecoveryResult<void>>;
  close(): void;
}

export class IndexedDbRecoveryStorage implements RecoveryStorageAdapter {
  private dbName: string;
  private dbVersion: number;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private idbFactory: IDBFactory;

  constructor(options?: {
    dbName?: string;
    dbVersion?: number;
    indexedDb?: IDBFactory;
  }) {
    this.dbName = options?.dbName ?? DATABASE_NAME;
    this.dbVersion = options?.dbVersion ?? DATABASE_VERSION;
    const explicitFactory = options?.indexedDb;
    this.idbFactory =
      explicitFactory !== undefined
        ? explicitFactory
        : typeof globalThis.indexedDB !== "undefined"
          ? globalThis.indexedDB
          : (undefined as unknown as IDBFactory);
  }

  private async ensureOpen(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (!this.openPromise) {
      this.openPromise = this.openDatabase();
    }
    try {
      this.db = await this.openPromise;
      return this.db;
    } catch (err) {
      this.openPromise = null;
      throw err;
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.idbFactory || typeof this.idbFactory.open !== "function") {
        reject(new Error("IndexedDB is not available in this environment."));
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
      request.onerror = () => {
        reject(new Error("Failed to open the project database."));
      };
      request.onblocked = () => {
        reject(new Error("The project database is blocked by another connection."));
      };
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.openPromise = null;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T> {
    const db = await this.ensureOpen();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_RECOVERY_SNAPSHOTS, mode);
      const store = tx.objectStore(STORE_RECOVERY_SNAPSHOTS);
      let result: T;
      let settled = false;
      Promise.resolve(fn(store))
        .then((value) => {
          result = value;
        })
        .catch(reject);
      tx.oncomplete = () => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      tx.onerror = (event) => {
        if (!settled) {
          settled = true;
          reject((event.target as IDBRequest).error ?? new Error("Transaction failed."));
        }
      };
      tx.onabort = () => {
        if (!settled) {
          settled = true;
          reject(new Error("Transaction aborted."));
        }
      };
    });
  }

  async listSnapshots(
    projectId: string,
  ): Promise<RecoveryResult<RecoverySnapshot[]>> {
    try {
      const db = await this.ensureOpen();
      const all = await new Promise<RecoverySnapshot[]>((resolve, reject) => {
        const tx = db.transaction(STORE_RECOVERY_SNAPSHOTS, "readonly");
        const req = tx.objectStore(STORE_RECOVERY_SNAPSHOTS).getAll();
        req.onsuccess = () => resolve((req.result as RecoverySnapshot[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error("List failed."));
      });
      const sorted = all
        .filter((s) => s.projectId === projectId)
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
        );
      return { ok: true, value: sorted };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_STORE_UNAVAILABLE",
          message: "Backups could not be loaded.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async getSnapshot(
    snapshotId: string,
  ): Promise<RecoveryResult<RecoverySnapshot | null>> {
    try {
      const db = await this.ensureOpen();
      const record = await new Promise<RecoverySnapshot | null>((resolve, reject) => {
        const tx = db.transaction(STORE_RECOVERY_SNAPSHOTS, "readonly");
        const req = tx.objectStore(STORE_RECOVERY_SNAPSHOTS).get(snapshotId);
        req.onsuccess = () => resolve((req.result as RecoverySnapshot) ?? null);
        req.onerror = () => reject(req.error ?? new Error("Read failed."));
      });
      return { ok: true, value: record };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_STORE_UNAVAILABLE",
          message: "The backup could not be loaded.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async saveSnapshot(
    snapshot: RecoverySnapshot,
  ): Promise<RecoveryResult<RecoverySnapshot>> {
    try {
      await this.run("readwrite", (store) => {
        store.put(snapshot);
      });
      return { ok: true, value: snapshot };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_STORE_UNAVAILABLE",
          message: "The backup could not be saved.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<RecoveryResult<void>> {
    try {
      await this.run("readwrite", (store) => {
        store.delete(snapshotId);
      });
      return { ok: true, value: undefined };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_STORE_UNAVAILABLE",
          message: "The backup could not be removed.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async countSnapshots(projectId: string): Promise<RecoveryResult<number>> {
    try {
      const list = await this.listSnapshots(projectId);
      if (!list.ok) return list;
      return { ok: true, value: list.value.length };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_STORE_UNAVAILABLE",
          message: "Backups could not be counted.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async clearForProject(projectId: string): Promise<RecoveryResult<void>> {
    try {
      const list = await this.listSnapshots(projectId);
      if (!list.ok) return list;
      for (const snapshot of list.value) {
        await this.deleteSnapshot(snapshot.id);
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "RECOVERY_STORE_UNAVAILABLE",
          message: "Backups could not be cleared.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton (browser)
// ---------------------------------------------------------------------------

let singleton: IndexedDbRecoveryStorage | null = null;

export function getRecoveryStorage(): RecoveryStorageAdapter {
  if (!singleton) {
    singleton = new IndexedDbRecoveryStorage();
  }
  return singleton;
}

export function setRecoveryStorageForTests(
  adapter: RecoveryStorageAdapter | null,
): void {
  singleton = adapter as IndexedDbRecoveryStorage | null;
}
