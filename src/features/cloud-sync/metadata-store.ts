// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — metadata store access
//
// Small, shared reader/writer for the buildora `metadata` object store
// (key/value). Used for the device id and per-user sync cursors. Opens the
// shared database through the canonical schema helper so every store exists.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_METADATA,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";

export interface MetadataValue {
  key: string;
  value: unknown;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let idbFactory: IDBFactory | undefined;

/** Test hook: inject an IDBFactory (fake-indexeddb in unit tests). */
export function setMetadataIdbFactoryForTests(factory: IDBFactory | null): void {
  idbFactory = factory ?? undefined;
  dbPromise = null;
}

function resolveFactory(): IDBFactory | undefined {
  if (idbFactory !== undefined) return idbFactory;
  return typeof globalThis.indexedDB !== "undefined"
    ? globalThis.indexedDB
    : undefined;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = resolveFactory();
      if (!factory || typeof factory.open !== "function") {
        reject(new Error("IndexedDB is not available."));
        return;
      }
      const request = factory.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        ensureDatabaseStores(db);
      };
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () =>
        reject((request as IDBOpenDBRequest).error ?? new Error("open failed"));
    });
  }
  return dbPromise;
}

export async function readMetadata(key: string): Promise<unknown> {
  const db = await openDatabase();
  return new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readonly");
    const store = tx.objectStore(STORE_METADATA);
    const request = store.get(key);
    request.onsuccess = () => {
      const entry = request.result as MetadataValue | undefined;
      resolve(entry?.value);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function writeMetadata(key: string, value: unknown): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_METADATA, "readwrite");
    const store = tx.objectStore(STORE_METADATA);
    store.put({ key, value } satisfies MetadataValue);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
