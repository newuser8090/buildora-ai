// ---------------------------------------------------------------------------
// IndexedDbThumbnailAdapter
//
// Dedicated thumbnail storage adapter sharing the same IndexedDB database as
// the project adapter (buildora, version 2 with the projectThumbnails store).
//
// Features:
//   - Blob storage (never base64 JSON)
//   - Atomic stale-write protection: revision check + write in ONE transaction
//   - Same-revision idempotent detection via content hash
//   - Non-destructive schema (projectThumbnails store created on upgrade)
//   - Structured ThumbnailError mapping
//   - Constructor-injected IDBFactory for testability
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_PROJECT_THUMBNAILS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import { thumbnailErrors, toThumbnailError } from "../errors";
import type {
  ProjectThumbnailRecord,
  ProjectThumbnailMetadata,
  ProjectThumbnailStorageAdapter,
  ThumbnailError,
  ThumbnailLoadResult,
  ThumbnailSaveResult,
  ThumbnailResult,
  ThumbnailMetadataListResult,
  ThumbnailUsageResult,
} from "../types";

// ---------------------------------------------------------------------------
// Stored record shape (Blob lives here — never a data URL)
// ---------------------------------------------------------------------------

interface StoredThumbnailRecord {
  projectId: string;
  revision: number;
  generatedAt: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  blob: Blob;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class IndexedDbThumbnailAdapter implements ProjectThumbnailStorageAdapter {
  private dbName: string;
  private dbVersion: number;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private clock: () => Date;
  private idbFactory: IDBFactory;
  /** Injectable content-hash function (default: SHA-256 via Web Crypto). */
  private hashFn: (blob: Blob) => Promise<string>;

  constructor(options?: {
    dbName?: string;
    dbVersion?: number;
    clock?: () => Date;
    indexedDb?: IDBFactory;
    hashFn?: (blob: Blob) => Promise<string>;
  }) {
    this.dbName = options?.dbName ?? DATABASE_NAME;
    this.dbVersion = options?.dbVersion ?? DATABASE_VERSION;
    this.clock = options?.clock ?? (() => new Date());
    this.hashFn = options?.hashFn ?? defaultHashFn;
    const explicitFactory = options?.indexedDb;
    if (explicitFactory !== undefined) {
      this.idbFactory = explicitFactory;
    } else {
      this.idbFactory = typeof globalThis.indexedDB !== "undefined" ? globalThis.indexedDB : undefined as unknown as IDBFactory;
    }
  }

  // -----------------------------------------------------------------------
  // Database lifecycle
  // -----------------------------------------------------------------------

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
          thumbnailErrors.renderTargetUnavailable(undefined, undefined),
        );
      }

      const request = this.idbFactory.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Non-destructive: create missing stores only. Shared schema helper
        // guarantees EVERY store exists regardless of which adapter triggers
        // the version bump (first-connection safety).
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
          toThumbnailError(error, "STORAGE_FAILED", { retryable: true }),
        );
      };

      request.onblocked = () => {
        reject(
          thumbnailErrors.storageFailed(
            undefined,
            undefined,
            "Database upgrade blocked by another connection.",
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

  // -----------------------------------------------------------------------
  // Load
  // -----------------------------------------------------------------------

  async getThumbnail(projectId: string): Promise<ThumbnailLoadResult> {
    try {
      const db = await this.ensureOpen();
      const record = await this.getRecord<StoredThumbnailRecord>(
        db,
        STORE_PROJECT_THUMBNAILS,
        projectId,
      );
      if (!record) {
        return {
          success: false,
          error: thumbnailErrors.projectNotFound(projectId),
        };
      }
      return {
        success: true,
        record: {
          projectId: record.projectId,
          revision: record.revision,
          generatedAt: record.generatedAt,
          mimeType: record.mimeType === "image/png" ? "image/png" : "image/webp",
          width: record.width,
          height: record.height,
          byteSize: record.byteSize,
          data: record.blob,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: toThumbnailError(err, "STORAGE_FAILED", {
          projectId,
          retryable: true,
        }),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Save — atomic revision check + write in one transaction
  //
  // Policy (Phase G §14):
  //   - no existing thumbnail → accept
  //   - incoming revision > stored → accept (replace)
  //   - incoming revision === stored:
  //       - identical blob (hash) → idempotent success, no write
  //       - different output → replace only if generatedAt is newer
  //   - incoming revision < stored → STALE_REVISION
  // -----------------------------------------------------------------------

  async saveThumbnail(
    record: ProjectThumbnailRecord,
  ): Promise<ThumbnailSaveResult> {
    try {
      const db = await this.ensureOpen();

      // Validate the Blob before any write.
      if (!record.data || record.data.size === 0) {
        return {
          success: false,
          error: thumbnailErrors.encodingFailed(
            record.projectId,
            record.revision,
            "Refusing to store an empty thumbnail Blob.",
          ),
        };
      }

      const incomingHash = await this.hashFn(record.data);

      return await this.saveWithRevisionCheck(db, record, incomingHash);
    } catch (err) {
      return {
        success: false,
        error: toThumbnailError(err, "STORAGE_FAILED", {
          projectId: record.projectId,
          revision: record.revision,
          retryable: true,
        }),
      };
    }
  }

  private saveWithRevisionCheck(
    db: IDBDatabase,
    record: ProjectThumbnailRecord,
    incomingHash: string,
  ): Promise<ThumbnailSaveResult> {
    return new Promise<ThumbnailSaveResult>((resolve) => {
      const tx = db.transaction([STORE_PROJECT_THUMBNAILS], "readwrite");
      const store = tx.objectStore(STORE_PROJECT_THUMBNAILS);

      // Tracks whether a write was actually issued. Success is resolved on
      // tx.oncomplete ONLY when a write happened, so a save is never reported
      // as "ready" before the record is durably committed and readable from a
      // separate connection (completion-ordering contract, Phase G §6).
      let writeIssued = false;

      const getRequest = store.get(record.projectId);

      getRequest.onsuccess = async () => {
        const existing = getRequest.result as StoredThumbnailRecord | undefined;

        if (existing) {
          if (existing.revision > record.revision) {
            resolve({
              success: false,
              error: thumbnailErrors.staleRevision(record.projectId, record.revision),
            });
            return;
          }

          if (existing.revision === record.revision) {
            // Same revision: compare content hash for idempotency.
            const existingHash = await this.hashFn(existing.blob).catch(() => null);
            if (existingHash !== null && existingHash === incomingHash) {
              resolve({
                success: true,
                record: {
                  ...record,
                  data: existing.blob,
                },
                deduplicated: true,
              });
              return;
            }
            // Different output at the same revision — replace only if the
            // incoming generatedAt is newer than the stored one.
            if (record.generatedAt <= existing.generatedAt) {
              resolve({
                success: false,
                error: thumbnailErrors.staleRevision(record.projectId, record.revision),
              });
              return;
            }
          }
        }

        const stored: StoredThumbnailRecord = {
          projectId: record.projectId,
          revision: record.revision,
          generatedAt: record.generatedAt,
          mimeType: record.mimeType,
          width: record.width,
          height: record.height,
          byteSize: record.byteSize,
          blob: record.data,
        };

        writeIssued = true;
        const putRequest = store.put(stored);
        // NOTE: success is intentionally NOT resolved from putRequest.onsuccess
        // — a request-level success can fire before the transaction commits.
        // Resolution happens in tx.oncomplete below so a separate connection
        // can read the record immediately after saveThumbnail resolves.
        putRequest.onerror = (event) => {
          const err = (event.target as IDBRequest).error;
          resolve({
            success: false,
            error: mapStoreError(err, record.projectId, record.revision),
          });
        };
      };

      getRequest.onerror = (event) => {
        const err = (event.target as IDBRequest).error;
        resolve({
          success: false,
          error: mapStoreError(err, record.projectId, record.revision),
        });
      };

      // Completion ordering: a save is only "ready" once the transaction has
      // committed. If no write was issued the promise already resolved above
      // (deduplicated / stale-rejection paths) — these handlers are no-ops.
      tx.oncomplete = () => {
        if (writeIssued) {
          resolve({ success: true, record, deduplicated: false });
        }
      };
      tx.onerror = (event) => {
        if (writeIssued) {
          const err = (event.target as IDBTransaction).error;
          resolve({
            success: false,
            error: mapStoreError(err, record.projectId, record.revision),
          });
        }
      };
      tx.onabort = (event) => {
        if (writeIssued) {
          const err = (event.target as IDBTransaction).error;
          resolve({
            success: false,
            error: mapStoreError(err, record.projectId, record.revision),
          });
        }
      };
    });
  }

  // -----------------------------------------------------------------------
  // Remove
  // -----------------------------------------------------------------------

  async removeThumbnail(projectId: string): Promise<ThumbnailResult> {
    try {
      const db = await this.ensureOpen();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_PROJECT_THUMBNAILS, "readwrite");
        const store = tx.objectStore(STORE_PROJECT_THUMBNAILS);
        store.delete(projectId);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          reject((event.target as IDBTransaction).error);
        };
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: toThumbnailError(err, "STORAGE_FAILED", {
          projectId,
          retryable: true,
        }),
      };
    }
  }

  // -----------------------------------------------------------------------
  // List metadata (no Blobs) + usage
  // -----------------------------------------------------------------------

  async listThumbnailMetadata(): Promise<ThumbnailMetadataListResult> {
    try {
      const db = await this.ensureOpen();
      const records = await this.getAllRecords<StoredThumbnailRecord>(
        db,
        STORE_PROJECT_THUMBNAILS,
      );
      const items: ProjectThumbnailMetadata[] = records.map((r) => ({
        projectId: r.projectId,
        revision: r.revision,
        generatedAt: r.generatedAt,
        mimeType: r.mimeType,
        width: r.width,
        height: r.height,
        byteSize: r.byteSize,
      }));
      return { success: true, items };
    } catch (err) {
      return {
        success: false,
        error: toThumbnailError(err, "STORAGE_FAILED", { retryable: true }),
      };
    }
  }

  async estimateThumbnailUsage(): Promise<ThumbnailUsageResult> {
    try {
      const db = await this.ensureOpen();
      const records = await this.getAllRecords<StoredThumbnailRecord>(
        db,
        STORE_PROJECT_THUMBNAILS,
      );
      let bytes = 0;
      for (const r of records) {
        bytes += r.byteSize ?? r.blob?.size ?? 0;
      }
      return { success: true, count: records.length, bytes };
    } catch (err) {
      return {
        success: false,
        error: toThumbnailError(err, "STORAGE_FAILED", { retryable: true }),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private getRecord<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  private getAllRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStoreError(
  err: DOMException | null | undefined,
  projectId?: string,
  revision?: number,
): ThumbnailError {
  if (err?.name === "QuotaExceededError") {
    // User-safe message mentions quota; technical cause goes in `cause`.
    return {
      code: "STORAGE_FAILED",
      message: "Storage quota exceeded while saving the thumbnail. Free up space and try again.",
      projectId,
      revision,
      retryable: true,
      cause: err.message,
    };
  }
  return {
    code: "STORAGE_FAILED",
    message: "The thumbnail could not be saved to storage.",
    projectId,
    revision,
    retryable: true,
    cause: err?.message ?? "IndexedDB transaction failed.",
  };
}

/**
 * Default content hash: SHA-256 of the Blob via Web Crypto.
 * Falls back to a stable size+timestamp hash when crypto.subtle is absent
 * (e.g. non-secure contexts or test environments).
 */
async function defaultHashFn(blob: Blob): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // Fall through to deterministic fallback below.
  }
  // Deterministic fallback: byteSize + first/last bytes + generatedAt-free.
  const bytes = await blob.arrayBuffer();
  const view = new Uint8Array(bytes);
  let seed = 0;
  const step = Math.max(1, Math.floor(view.length / 64));
  for (let i = 0; i < view.length; i += step) {
    seed = (seed * 31 + view[i]) | 0;
  }
  return `fnv-${view.length}-${seed >>> 0}`;
}
