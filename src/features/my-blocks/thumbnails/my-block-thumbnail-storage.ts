// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — thumbnail storage adapter
//
// Dedicated adapter for the myBlockThumbnails object store in the shared
// buildora database (version 4). Blobs only — never base64 JSON. The shared
// ensureDatabaseStores() helper guarantees every store exists regardless of
// which adapter triggers the version bump (first-connection safety).
//
// Guarantees:
//   - schema validation of metadata fields on every read (corrupt records are
//     reported as missing/error, never fatal)
//   - non-empty Blob validation before any write
//   - stale-write protection (never overwrite a NEWER thumbnail)
//   - structured MyBlockResult errors
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_MY_BLOCK_THUMBNAILS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import { makeMyBlockError, toMyBlockError } from "../errors";
import type { MyBlockResult } from "../types";
import type {
  MyBlockThumbnailRecord,
  MyBlockThumbnailStorageAdapter,
} from "./my-block-thumbnail-types";

// ---------------------------------------------------------------------------
// Stored record shape
// ---------------------------------------------------------------------------

interface StoredThumbnailRecord {
  blockId: string;
  revision: number;
  generatedAt: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  hash: string;
  blob: Blob;
}

/** Light validation for a raw stored record — corrupt → null. */
function parseStoredThumbnail(value: unknown): StoredThumbnailRecord | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.blockId !== "string" ||
    typeof raw.revision !== "number" ||
    typeof raw.generatedAt !== "string" ||
    typeof raw.mimeType !== "string" ||
    typeof raw.width !== "number" ||
    typeof raw.height !== "number" ||
    typeof raw.byteSize !== "number" ||
    typeof raw.hash !== "string" ||
    !(raw.blob instanceof Blob) ||
    raw.blob.size === 0
  ) {
    return null;
  }
  return raw as unknown as StoredThumbnailRecord;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MyBlockThumbnailIndexedDbAdapter
  implements MyBlockThumbnailStorageAdapter
{
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
    if (explicitFactory !== undefined) {
      this.idbFactory = explicitFactory;
    } else {
      this.idbFactory =
        typeof globalThis.indexedDB !== "undefined"
          ? globalThis.indexedDB
          : (undefined as unknown as IDBFactory);
    }
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
        return reject(
          makeMyBlockError(
            "STORAGE_UNAVAILABLE",
            "IndexedDB is not available in this environment.",
          ),
        );
      }

      const request = this.idbFactory.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Shared schema helper — non-destructive, first-connection safe.
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

      request.onerror = (event) => {
        const error = (event.target as IDBOpenDBRequest).error;
        reject(
          makeMyBlockError(
            "DATABASE_OPEN_FAILED",
            "Failed to open the saved-blocks database.",
            error?.message,
          ),
        );
      };

      request.onblocked = () => {
        reject(
          makeMyBlockError(
            "DATABASE_OPEN_FAILED",
            "The saved-blocks database is blocked by another connection.",
          ),
        );
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

  // -------------------------------------------------------------------------
  // Get
  // -------------------------------------------------------------------------

  async getThumbnail(
    blockId: string,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    try {
      const db = await this.ensureOpen();
      const raw = await this.getRecord<unknown>(db, STORE_MY_BLOCK_THUMBNAILS, blockId);
      if (raw === undefined) {
        return {
          ok: false,
          error: makeMyBlockError("THUMBNAIL_NOT_FOUND", "No thumbnail is stored for this block."),
        };
      }
      const stored = parseStoredThumbnail(raw);
      if (!stored) {
        // Corrupt blob record — isolated (treated as missing), never fatal.
        return {
          ok: false,
          error: makeMyBlockError("THUMBNAIL_NOT_FOUND", "The stored thumbnail is damaged."),
        };
      }
      return {
        ok: true,
        value: {
          blockId: stored.blockId,
          revision: stored.revision,
          generatedAt: stored.generatedAt,
          mimeType: stored.mimeType === "image/png" ? "image/png" : "image/webp",
          width: stored.width,
          height: stored.height,
          byteSize: stored.byteSize,
          hash: stored.hash,
          data: stored.blob,
        },
      };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Save (with stale-write protection)
  // -------------------------------------------------------------------------

  async saveThumbnail(
    record: MyBlockThumbnailRecord,
  ): Promise<MyBlockResult<MyBlockThumbnailRecord>> {
    try {
      if (!record.data || record.data.size === 0) {
        return {
          ok: false,
          error: makeMyBlockError(
            "THUMBNAIL_GENERATION_FAILED",
            "Refusing to store an empty thumbnail.",
          ),
        };
      }
      const db = await this.ensureOpen();
      const existing = await this.getRecord<StoredThumbnailRecord>(
        db,
        STORE_MY_BLOCK_THUMBNAILS,
        record.blockId,
      );
      if (existing && existing.revision > record.revision) {
        return {
          ok: false,
          error: makeMyBlockError(
            "THUMBNAIL_GENERATION_FAILED",
            "A newer thumbnail already exists for this block.",
          ),
        };
      }
      const stored: StoredThumbnailRecord = {
        blockId: record.blockId,
        revision: record.revision,
        generatedAt: record.generatedAt,
        mimeType: record.mimeType,
        width: record.width,
        height: record.height,
        byteSize: record.byteSize,
        hash: record.hash,
        blob: record.data,
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_MY_BLOCK_THUMBNAILS, "readwrite");
        const store = tx.objectStore(STORE_MY_BLOCK_THUMBNAILS);
        const request = store.put(stored);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject((event.target as IDBRequest).error);
        tx.onerror = (event) => reject((event.target as IDBTransaction).error);
      });
      return { ok: true, value: record };
    } catch (err) {
      return { ok: false, error: mapThumbnailWriteError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Remove
  // -------------------------------------------------------------------------

  async removeThumbnail(
    blockId: string,
  ): Promise<MyBlockResult<{ blockId: string }>> {
    try {
      const db = await this.ensureOpen();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_MY_BLOCK_THUMBNAILS, "readwrite");
        const store = tx.objectStore(STORE_MY_BLOCK_THUMBNAILS);
        store.delete(blockId);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject((event.target as IDBTransaction).error);
      });
      return { ok: true, value: { blockId } };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Metadata + usage (no Blobs — cheap for quota accounting)
  // -------------------------------------------------------------------------

  async listThumbnailMetadata(): Promise<
    MyBlockResult<Array<Omit<MyBlockThumbnailRecord, "data">>>
  > {
    try {
      const db = await this.ensureOpen();
      const raw = await this.getAllRecords<unknown>(db, STORE_MY_BLOCK_THUMBNAILS);
      const items: Array<Omit<MyBlockThumbnailRecord, "data">> = [];
      for (const entry of raw) {
        const stored = parseStoredThumbnail(entry);
        if (!stored) continue;
        items.push({
          blockId: stored.blockId,
          revision: stored.revision,
          generatedAt: stored.generatedAt,
          mimeType: stored.mimeType === "image/png" ? "image/png" : "image/webp",
          width: stored.width,
          height: stored.height,
          byteSize: stored.byteSize,
          hash: stored.hash,
        });
      }
      return { ok: true, value: items };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  async estimateThumbnailUsage(): Promise<
    MyBlockResult<{ count: number; bytes: number }>
  > {
    try {
      const items = await this.listThumbnailMetadata();
      if (!items.ok) return items;
      const bytes = items.value.reduce((sum, i) => sum + i.byteSize, 0);
      return { ok: true, value: { count: items.value.length, bytes } };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private getRecord<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = (event) => reject((event.target as IDBRequest).error);
    });
  }

  private getAllRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = (event) => reject((event.target as IDBRequest).error);
    });
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function mapThumbnailWriteError(
  err: unknown,
): ReturnType<typeof makeMyBlockError> {
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err as DOMException).name === "QuotaExceededError"
  ) {
    return makeMyBlockError(
      "QUOTA_EXCEEDED",
      "Your browser's storage is full while saving a thumbnail. Free up space and try again.",
      (err as DOMException).message,
    );
  }
  return toMyBlockError(err);
}
