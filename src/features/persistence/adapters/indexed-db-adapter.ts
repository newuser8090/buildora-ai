// ---------------------------------------------------------------------------
// IndexedDB Project Persistence Adapter
//
// Stores serialized Buildora project envelopes in IndexedDB using the
// canonical Phase A serialization/deserialization pipeline.
//
// Features:
//   - Revision-based stale-write protection
//   - Same-revision idempotent detection (identical content → no-op success)
//   - Explicit active-project metadata
//   - Structured error mapping from DOMExceptions
//   - Shared in-flight open promise
//   - Framework-independent (no React, no Zustand)
//   - Constructor-injected IDBFactory for testability
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_PROJECTS,
  STORE_METADATA,
  STORE_PROJECT_THUMBNAILS,
  STORE_MY_BLOCKS,
  METADATA_KEY_ACTIVE_PROJECT,
} from "../constants";
import { serializeProject } from "../services/project-serializer";
import { deserializeProject } from "../services/project-serializer";
import { getStorageEstimate } from "../services/storage-estimate";
import type {
  ProjectPersistenceAdapter,
  SaveProjectRequest,
  ProjectLoadResult,
  SaveProjectResult,
  ProjectPersistenceResult,
  ProjectSummaryResult,
  ProjectSummary,
  ActiveProjectResult,
  StorageEstimateResult,
  StoredProjectRecord,
  PersistenceError,
} from "../types";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class IndexedDbProjectAdapter implements ProjectPersistenceAdapter {
  private dbName: string;
  private dbVersion: number;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private clock: () => Date;
  private idbFactory: IDBFactory;

  constructor(options?: {
    dbName?: string;
    dbVersion?: number;
    /** Clock function for deterministic timestamps. Defaults to Date constructor. */
    clock?: () => Date;
    /** IDBFactory implementation. Defaults to global indexedDB for browser environments. */
    indexedDb?: IDBFactory;
  }) {
    this.dbName = options?.dbName ?? DATABASE_NAME;
    this.dbVersion = options?.dbVersion ?? DATABASE_VERSION;
    this.clock = options?.clock ?? (() => new Date());
    // Use explicit undefined check so that passing { indexedDb: undefined }
    // (from spread patterns) uses the global fallback, while explicitly passing
    // a nullish factory for testing is detected correctly.
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

  /**
   * Open (or reuse) the IndexedDB connection.
   */
  private async ensureOpen(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    if (!this.openPromise) {
      this.openPromise = this.openDatabase();
    }

    try {
      this.db = await this.openPromise;
      return this.db;
    } catch (err) {
      // Clear the failed promise so a later retry can re-open
      this.openPromise = null;
      throw err;
    }
  }

  /**
   * Open the database with upgrade handler.
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.idbFactory || typeof this.idbFactory.open !== "function") {
        return reject(
          makePersistenceError(
            "INDEXED_DB_UNAVAILABLE",
            "IndexedDB is not available in this environment.",
          ),
        );
      }

      const request = this.idbFactory.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Non-destructive upgrade: create missing stores only. Existing
        // projects / metadata are never touched during a version upgrade.
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_PROJECT_THUMBNAILS)) {
          db.createObjectStore(STORE_PROJECT_THUMBNAILS, { keyPath: "projectId" });
        }
        // Phase P4: personal block library — non-destructive addition. The
        // myBlocks store is also created by the MyBlocks adapter's own upgrade
        // handler, so either connection may trigger the version bump.
        if (!db.objectStoreNames.contains(STORE_MY_BLOCKS)) {
          db.createObjectStore(STORE_MY_BLOCKS, { keyPath: "id" });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        // Close this connection when another tab opens a newer version
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
          mapDOMException(
            error,
            "DATABASE_OPEN_FAILED",
            "Failed to open the project database.",
          ),
        );
      };

      request.onblocked = () => {
        reject(
          makePersistenceError(
            "DATABASE_BLOCKED",
            "The project database is blocked by another connection.",
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

  async loadProject(projectId: string): Promise<ProjectLoadResult> {
    try {
      const db = await this.ensureOpen();

      const record = await this.getRecord<StoredProjectRecord>(
        db,
        STORE_PROJECTS,
        projectId,
      );

      if (!record) {
        return {
          success: false,
          error: makePersistenceError(
            "PROJECT_NOT_FOUND",
            `Project "${projectId}" was not found.`,
            projectId,
          ),
        };
      }

      // Deserialize through the canonical Phase A pipeline
      const result = deserializeProject(record.envelope);

      if (!result.success) {
        return {
          success: false,
          error: {
            code: "DESERIALIZATION_FAILED",
            message: result.error.message,
            projectId,
            cause: result.error.cause,
          },
        };
      }

      return {
        success: true,
        project: result.project,
        revision: record.revision,
        savedAt: record.savedAt,
      };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR", projectId),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Save
  // -----------------------------------------------------------------------

  async saveProject(request: SaveProjectRequest): Promise<SaveProjectResult> {
    const { project, revision } = request;

    try {
      const db = await this.ensureOpen();

      // Serialize the project into an envelope
      let envelope: ReturnType<typeof JSON.parse>;
      try {
        const json = serializeProject(project);
        envelope = JSON.parse(json);
      } catch (err) {
        return {
          success: false,
          error: makePersistenceError(
            "SERIALIZATION_FAILED",
            "Failed to serialize the project for storage.",
            project.id,
            err instanceof Error ? err.message : String(err),
          ),
        };
      }

      // Run revision check and write in the same transaction
      const result = await this.saveWithRevisionCheck(
        db,
        project,
        revision,
        envelope,
      );

      return result;
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR", project.id),
      };
    }
  }

  /**
   * Perform revision-atomic save inside a single readwrite transaction.
   *
   * Revision policy (preferred):
   *   - existing.revision > incoming revision → STALE_REVISION
   *   - existing.revision === incoming revision AND identical content → idempotent success, no write
   *   - existing.revision === incoming revision AND different content → STALE_REVISION
   *   - existing.revision < incoming revision OR no existing → accept, store at incoming revision
   */
  private async saveWithRevisionCheck(
    db: IDBDatabase,
    project: Project,
    revision: number,
    envelope: unknown,
  ): Promise<SaveProjectResult> {
    return new Promise<SaveProjectResult>((resolve) => {
      const tx = db.transaction([STORE_PROJECTS], "readwrite");
      const store = tx.objectStore(STORE_PROJECTS);

      // Read current record
      const getRequest = store.get(project.id);

      getRequest.onsuccess = () => {
        const existing = getRequest.result as StoredProjectRecord | undefined;

        if (existing) {
          if (existing.revision > revision) {
            resolve({
              success: false,
              error: makePersistenceError(
                "STALE_REVISION",
                `Cannot save revision ${revision} when stored revision is ${existing.revision}.`,
                project.id,
              ),
            });
            return;
          }

          if (existing.revision === revision) {
            // Check if content is identical — idempotent success
            if (contentEquals(existing.envelope, envelope)) {
              resolve({ success: true, revision: existing.revision, savedAt: existing.savedAt });
              return;
            } else {
              resolve({
                success: false,
                error: makePersistenceError(
                  "STALE_REVISION",
                  `Cannot save revision ${revision} with different content — stored revision ${existing.revision} already has different data.`,
                  project.id,
                ),
              });
              return;
            }
          }
        }

        // Compute summary
        const assetCount = project.assets?.length ?? 0;
        const approximateAssetBytes = (project.assets ?? []).reduce(
          (sum, a) => sum + (a.size || 0),
          0,
        );
        const pageCount = project.pages?.length ?? 0;
        const now = this.clock().toISOString();

        const record: StoredProjectRecord = {
          id: project.id,
          revision,
          createdAt: existing ? existing.createdAt : (project.createdAt || now),
          savedAt: now,
          updatedAt: project.updatedAt || now,
          envelope: envelope as StoredProjectRecord["envelope"],
          name: project.name || "Untitled",
          pageCount,
          assetCount,
          approximateAssetBytes,
        };

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          resolve({ success: true, revision: record.revision, savedAt: now });
        };

        putRequest.onerror = (event) => {
          const err = (event.target as IDBRequest).error;
          resolve({
            success: false,
            error: mapDOMException(
              err,
              "TRANSACTION_FAILED",
              "Failed to save the project.",
              project.id,
            ),
          });
        };
      };

      getRequest.onerror = (event) => {
        const err = (event.target as IDBRequest).error;
        resolve({
          success: false,
          error: mapDOMException(
            err,
            "TRANSACTION_FAILED",
            "Failed to check existing project state.",
            project.id,
          ),
        });
      };

      tx.onerror = (event) => {
        const err = (event.target as IDBTransaction).error;
        resolve({
          success: false,
          error: mapDOMException(
            err,
            "TRANSACTION_FAILED",
            "Transaction failed while saving the project.",
            project.id,
          ),
        });
      };
    });
  }

  // -----------------------------------------------------------------------
  // Remove
  // -----------------------------------------------------------------------

  async removeProject(projectId: string): Promise<ProjectPersistenceResult> {
    try {
      const db = await this.ensureOpen();

      // Remove project record and possibly clear activeProjectId
      return await this.removeWithMetadataCheck(db, projectId);
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR", projectId),
      };
    }
  }

  private async removeWithMetadataCheck(
    db: IDBDatabase,
    projectId: string,
  ): Promise<ProjectPersistenceResult> {
    return new Promise<ProjectPersistenceResult>((resolve) => {
      const tx = db.transaction([STORE_PROJECTS, STORE_METADATA], "readwrite");
      const projectStore = tx.objectStore(STORE_PROJECTS);
      const metaStore = tx.objectStore(STORE_METADATA);

      // Remove the project record (idempotent — missing record is success)
      projectStore.delete(projectId);

      // Check if this is the active project and clear it atomically
      const activeRequest = metaStore.get(METADATA_KEY_ACTIVE_PROJECT);

      activeRequest.onsuccess = () => {
        const active = activeRequest.result as
          | { key: string; value: string }
          | undefined;
        if (active && active.value === projectId) {
          metaStore.put({ key: METADATA_KEY_ACTIVE_PROJECT, value: null });
        }
      };

      tx.oncomplete = () => {
        resolve({ success: true });
      };

      tx.onerror = (event) => {
        const err = (event.target as IDBTransaction).error;
        resolve({
          success: false,
          error: mapDOMException(
            err,
            "TRANSACTION_FAILED",
            "Failed to remove the project.",
            projectId,
          ),
        });
      };
    });
  }

  // -----------------------------------------------------------------------
  // List projects
  // -----------------------------------------------------------------------

  async listProjects(): Promise<ProjectSummaryResult> {
    try {
      const db = await this.ensureOpen();
      const records = await this.getAllRecords<StoredProjectRecord>(
        db,
        STORE_PROJECTS,
      );

      const summaries: ProjectSummary[] = records.map((r) => {
        // Legacy createdAt recovery: inspect the serialized envelope
        // when stored createdAt is missing
        let createdAt = r.createdAt;
        if (!createdAt) {
          // Try to recover from the serialized project envelope
          const envelope = r.envelope;
          if (envelope?.project?.createdAt && isValidDate(envelope.project.createdAt)) {
            createdAt = envelope.project.createdAt;
          } else if (envelope?.project?.updatedAt && isValidDate(envelope.project.updatedAt)) {
            createdAt = envelope.project.updatedAt;
          } else {
            createdAt = r.savedAt;
          }
        }

        return {
          id: r.id,
          name: r.name,
          createdAt,
          updatedAt: r.updatedAt,
          savedAt: r.savedAt,
          revision: r.revision,
          pageCount: r.pageCount,
          assetCount: r.assetCount,
          approximateAssetBytes: r.approximateAssetBytes,
        };
      });

      return { success: true, projects: summaries };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR"),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Active project
  // -----------------------------------------------------------------------

  async getActiveProjectId(): Promise<ActiveProjectResult> {
    try {
      const db = await this.ensureOpen();
      const record = await this.getRecord<{ key: string; value: string | null }>(
        db,
        STORE_METADATA,
        METADATA_KEY_ACTIVE_PROJECT,
      );
      return {
        success: true,
        projectId: record?.value ?? null,
      };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "ACTIVE_PROJECT_FAILED"),
      };
    }
  }

  async setActiveProjectId(
    projectId: string | null,
  ): Promise<ProjectPersistenceResult> {
    try {
      const db = await this.ensureOpen();

      if (projectId !== null) {
        // Verify the project exists first
        const record = await this.getRecord<StoredProjectRecord>(
          db,
          STORE_PROJECTS,
          projectId,
        );
        if (!record) {
          return {
            success: false,
            error: makePersistenceError(
              "PROJECT_NOT_FOUND",
              `Cannot set active project "${projectId}" — project not found.`,
              projectId,
            ),
          };
        }
      }

      await this.putRecord(db, STORE_METADATA, {
        key: METADATA_KEY_ACTIVE_PROJECT,
        value: projectId,
      });

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "ACTIVE_PROJECT_FAILED", projectId ?? undefined),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Dashboard metadata
  // -----------------------------------------------------------------------

  async getDashboardMetadata(
    projectId: string,
  ): Promise<{ success: true; metadata: Record<string, unknown> } | { success: false; error: PersistenceError }> {
    try {
      const db = await this.ensureOpen();
      const record = await this.getRecord<{ key: string; value: unknown }>(
        db,
        STORE_METADATA,
        `dashboard:${projectId}`,
      );
      return { success: true, metadata: (record?.value as Record<string, unknown>) ?? {} };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR", projectId),
      };
    }
  }

  async setDashboardMetadata(
    projectId: string,
    metadata: Record<string, unknown>,
  ): Promise<ProjectPersistenceResult> {
    try {
      const db = await this.ensureOpen();
      await this.putRecord(db, STORE_METADATA, {
        key: `dashboard:${projectId}`,
        value: metadata,
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR", projectId),
      };
    }
  }

  async removeDashboardMetadata(projectId: string): Promise<ProjectPersistenceResult> {
    try {
      const db = await this.ensureOpen();
      // Delete via a transaction on the metadata store
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_METADATA, "readwrite");
        const store = tx.objectStore(STORE_METADATA);
        store.delete(`dashboard:${projectId}`);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => {
          const err = (event.target as IDBTransaction).error;
          reject(mapDOMException(err, "TRANSACTION_FAILED", "Failed to remove dashboard metadata.", projectId));
        };
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR", projectId),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Storage estimate
  // -----------------------------------------------------------------------

  async estimateUsage(): Promise<StorageEstimateResult> {
    try {
      const estimate = await getStorageEstimate();
      return { success: true, estimate };
    } catch (err) {
      return {
        success: false,
        error: toPersistenceError(err, "UNKNOWN_PERSISTENCE_ERROR"),
      };
    }
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private getRecord<T>(
    db: IDBDatabase,
    storeName: string,
    key: string,
  ): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result as T | undefined);
      };

      request.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        reject(
          mapDOMException(error, "TRANSACTION_FAILED", "Read operation failed."),
        );
      };
    });
  }

  private getAllRecords<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result as T[]);
      };

      request.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        reject(
          mapDOMException(error, "TRANSACTION_FAILED", "List operation failed."),
        );
      };
    });
  }

  private putRecord(
    db: IDBDatabase,
    storeName: string,
    value: unknown,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value);

      request.onsuccess = () => resolve();
      request.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        reject(
          mapDOMException(error, "TRANSACTION_FAILED", "Write operation failed."),
        );
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function makePersistenceError(
  code: PersistenceError["code"],
  message: string,
  projectId?: string,
  cause?: string,
  retryable?: boolean,
): PersistenceError {
  return { code, message, projectId, cause, retryable };
}

function mapDOMException(
  error: DOMException | null | undefined,
  fallbackCode: PersistenceError["code"],
  fallbackMessage: string,
  projectId?: string,
): PersistenceError {
  if (!error) {
    return makePersistenceError(fallbackCode, fallbackMessage, projectId);
  }

  // Map known DOMException names
  if (error.name === "QuotaExceededError") {
    return makePersistenceError("QUOTA_EXCEEDED", error.message, projectId, undefined, true);
  }
  if (error.name === "TransactionInactiveError") {
    return makePersistenceError("TRANSACTION_FAILED", error.message, projectId, undefined, true);
  }
  if (error.name === "AbortError" || error.name === "InvalidStateError") {
    return makePersistenceError("TRANSACTION_FAILED", error.message, projectId, undefined, true);
  }

  return makePersistenceError(fallbackCode, error.message || fallbackMessage, projectId);
}

function toPersistenceError(
  err: unknown,
  fallbackCode: PersistenceError["code"],
  projectId?: string,
): PersistenceError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const pe = err as PersistenceError;
    return makePersistenceError(pe.code, pe.message, pe.projectId ?? projectId, pe.cause, pe.retryable);
  }
  return makePersistenceError(
    fallbackCode,
    err instanceof Error ? err.message : String(err),
    projectId,
    err instanceof Error ? err.message : String(err),
  );
}

// ---------------------------------------------------------------------------
// Content comparison for idempotent same-revision detection
// ---------------------------------------------------------------------------

/**
 * Deeply compare two serialized envelope contents for equality.
 * This is used for idempotent same-revision saves — if the content
 * hasn't changed, we don't need to write it again.
 */
/**
 * Check if a string represents a valid date.
 * Does not require exact ISO 8601 format — just that it can be parsed as a date.
 */
function isValidDate(value: string): boolean {
  if (typeof value !== "string" || !value) return false;
  const d = new Date(value);
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Deeply compare two serialized envelope contents for equality.
 * This is used for idempotent same-revision saves — if the content
 * hasn't changed, we don't need to write it again.
 */
function contentEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
