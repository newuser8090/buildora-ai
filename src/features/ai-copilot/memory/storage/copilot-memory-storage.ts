// ---------------------------------------------------------------------------
// AI Copilot — project memory IndexedDB storage adapter (Phase P11)
//
// Persists CopilotMemoryRecord objects in the "copilotMemory" store
// (database version 9). Shares the canonical ensureDatabaseStores() helper so
// every DB-opening adapter creates the store on first connection.
//
// Local-only in P11: never synced, never in ProjectSchema, never exported.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_COPILOT_MEMORY,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { CopilotMemoryRecord, CopilotMemoryResult } from "../types";

export interface CopilotMemoryStorageAdapter {
  getMemory(
    projectId: string,
  ): Promise<CopilotMemoryResult<CopilotMemoryRecord | null>>;
  putMemory(
    record: CopilotMemoryRecord,
  ): Promise<CopilotMemoryResult<CopilotMemoryRecord>>;
  deleteMemory(projectId: string): Promise<CopilotMemoryResult<void>>;
  close(): void;
}

export class IndexedDbCopilotMemoryStorage implements CopilotMemoryStorageAdapter {
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
      const tx = db.transaction(STORE_COPILOT_MEMORY, mode);
      const store = tx.objectStore(STORE_COPILOT_MEMORY);
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
          reject(
            (event.target as IDBRequest).error ?? new Error("Transaction failed."),
          );
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

  async getMemory(
    projectId: string,
  ): Promise<CopilotMemoryResult<CopilotMemoryRecord | null>> {
    try {
      const db = await this.ensureOpen();
      const record = await new Promise<CopilotMemoryRecord | null>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_COPILOT_MEMORY, "readonly");
          const req = tx.objectStore(STORE_COPILOT_MEMORY).get(projectId);
          req.onsuccess = () =>
            resolve((req.result as CopilotMemoryRecord) ?? null);
          req.onerror = () => reject(req.error ?? new Error("Read failed."));
        },
      );
      return { ok: true, value: record };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "COPILOT_MEMORY_STORE_UNAVAILABLE",
          message: "Saved conversations could not be loaded.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async putMemory(
    record: CopilotMemoryRecord,
  ): Promise<CopilotMemoryResult<CopilotMemoryRecord>> {
    try {
      await this.run("readwrite", (store) => {
        store.put(record);
      });
      return { ok: true, value: record };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "COPILOT_MEMORY_STORE_UNAVAILABLE",
          message: "The conversation could not be saved on this device.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async deleteMemory(projectId: string): Promise<CopilotMemoryResult<void>> {
    try {
      await this.run("readwrite", (store) => {
        store.delete(projectId);
      });
      return { ok: true, value: undefined };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "COPILOT_MEMORY_STORE_UNAVAILABLE",
          message: "Saved conversations could not be cleared.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton (browser)
// ---------------------------------------------------------------------------

let singleton: CopilotMemoryStorageAdapter | null = null;

export function getCopilotMemoryStorage(): CopilotMemoryStorageAdapter {
  if (!singleton) {
    singleton = new IndexedDbCopilotMemoryStorage();
  }
  return singleton;
}

export function setCopilotMemoryStorageForTests(
  adapter: CopilotMemoryStorageAdapter | null,
): void {
  singleton = adapter;
}
