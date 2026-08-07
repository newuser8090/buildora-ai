// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — scoped sync metadata store
//
// Key/value access to the shared `metadata` store scoped to a SPECIFIC
// database (dbName/dbVersion), unlike the module-level default in
// metadata-store.ts. Used for per-user sync cursors and initial-merge
// decisions so no cursor state ever leaks between isolated databases (test
// fixtures) or accounts — cursor keys remain user-scoped AND db-scoped.
//
// Opens the shared database through the canonical schema helper so every
// store exists regardless of which adapter triggers the version bump.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_METADATA,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { MetadataValue } from "./metadata-store";

export class SyncMetadataStore {
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

  /** Read a stored value (undefined when absent). Never throws. */
  async read(key: string): Promise<unknown> {
    try {
      const db = await this.ensureOpen();
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE_METADATA, "readonly");
        const request = tx.objectStore(STORE_METADATA).get(key);
        request.onsuccess = () => {
          const entry = request.result as MetadataValue | undefined;
          resolve(entry?.value);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return undefined;
    }
  }

  /** Write a stored value. */
  async write(key: string, value: unknown): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_METADATA, "readwrite");
      const store = tx.objectStore(STORE_METADATA);
      store.put({ key, value } satisfies MetadataValue);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Remove a stored value (used by the explicit "remove cloud data" action). */
  async remove(key: string): Promise<void> {
    try {
      const db = await this.ensureOpen();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_METADATA, "readwrite");
        tx.objectStore(STORE_METADATA).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Best-effort cleanup only.
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.openPromise = null;
  }
}
