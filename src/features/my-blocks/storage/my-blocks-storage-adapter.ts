// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — IndexedDB storage adapter
//
// Dedicated adapter sharing the buildora database (version 3 with the
// myBlocks store). The library is separate from projects:
//   - cross-project availability
//   - never stored inside ProjectSchema
//   - never part of project history / autosave
//
// Guarantees:
//   - schema validation on every read and write (corrupt records are skipped
//     and reported, never fatal to a full list)
//   - deterministic ordering (list is stable; the service layer sorts)
//   - no mutation of inputs
//   - structured errors with quota mapping
//   - fresh id + timestamps on create; fresh id + duplicate-safe name on
//     duplicate; the original record is never mutated
// ---------------------------------------------------------------------------

import { STORE_MY_BLOCKS } from "@/features/persistence/constants";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_MY_BLOCK_COLLECTIONS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import {
  generateUniqueCollectionName,
  generateUniqueName,
  parseMyBlockCollection,
  parseMyBlockRecord,
  sanitizeMyBlockCollectionDescription,
  sanitizeMyBlockCollectionIds,
  sanitizeMyBlockCollectionName,
  sanitizeMyBlockDescription,
  sanitizeMyBlockName,
  sanitizeMyBlockTags,
  MY_BLOCK_MAX_COLLECTIONS,
} from "../schemas/my-block-schema";
import {
  MY_BLOCK_CURRENT_VERSION,
  MY_BLOCK_MAX_RECORD_SIZE_BYTES,
  MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES,
} from "../schemas/my-block-schema";
import {
  libraryQuotaError,
  makeMyBlockError,
  mapMyBlockDomException,
  quotaErrorFor,
  toMyBlockError,
} from "../errors";
import type {
  CreateMyBlockCollectionInput,
  CreateMyBlockInput,
  MyBlockCollection,
  MyBlockRecord,
  MyBlockResult,
  MyBlocksStorageAdapter,
  UpdateMyBlockCollectionPatch,
  UpdateMyBlockPatch,
} from "../types";

// ---------------------------------------------------------------------------
// Default identity
// ---------------------------------------------------------------------------

let myBlockIdCounter = 0;

/**
 * Per-session salt so ids never collide across tabs. Two tabs share one
 * IndexedDB library; timestamp + counter alone would produce IDENTICAL ids
 * when both tabs create their first block in the same millisecond (silently
 * overwriting a library record). randomUUID is the codebase convention;
 * a Math.random fallback covers non-secure contexts.
 */
const myBlockSessionSalt = (() => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    }
  } catch {
    // Fall through to the fallback below.
  }
  return Math.random().toString(36).slice(2, 14);
})();

/** Collision-resistant library record id factory (unique across tabs + sessions). */
export function createMyBlockId(): string {
  myBlockIdCounter += 1;
  return `myblock-${Date.now().toString(36)}-${myBlockSessionSalt}-${myBlockIdCounter}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class MyBlocksIndexedDbAdapter implements MyBlocksStorageAdapter {
  private dbName: string;
  private dbVersion: number;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private clock: () => Date;
  private idbFactory: IDBFactory;

  constructor(options?: {
    dbName?: string;
    dbVersion?: number;
    /** Clock function for deterministic timestamps. Defaults to Date. */
    clock?: () => Date;
    /** IDBFactory implementation. Defaults to global indexedDB. */
    indexedDb?: IDBFactory;
  }) {
    this.dbName = options?.dbName ?? DATABASE_NAME;
    this.dbVersion = options?.dbVersion ?? DATABASE_VERSION;
    this.clock = options?.clock ?? (() => new Date());
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

  // -------------------------------------------------------------------------
  // Database lifecycle
  // -------------------------------------------------------------------------

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
        reject(mapMyBlockDomException(error, "DATABASE_OPEN_FAILED", "Failed to open the saved-blocks database."));
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
  // List
  // -------------------------------------------------------------------------

  /**
   * List all records, validating each one. Corrupt records are skipped (not
   * fatal) — the caller can surface a warning via `skippedCount`.
   */
  async listMyBlocks(): Promise<MyBlockResult<MyBlockRecord[]>> {
    try {
      const db = await this.ensureOpen();
      const raw = await this.getAllRecords<unknown>(db, STORE_MY_BLOCKS);
      const blocks: MyBlockRecord[] = [];
      for (const entry of raw) {
        const parsed = parseMyBlockRecord(entry);
        if (!parsed) continue;
        if (parsed.tree.rootIds.length === 0) continue;
        blocks.push(parsed as MyBlockRecord);
      }
      // Deterministic ordering: most recently updated first (stable tiebreak).
      blocks.sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
      return { ok: true, value: blocks };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Get
  // -------------------------------------------------------------------------

  async getMyBlock(id: string): Promise<MyBlockResult<MyBlockRecord>> {
    try {
      const db = await this.ensureOpen();
      const raw = await this.getRecord<unknown>(db, STORE_MY_BLOCKS, id);
      if (raw === undefined) {
        return {
          ok: false,
          error: makeMyBlockError("BLOCK_NOT_FOUND", "That saved block no longer exists."),
        };
      }
      const parsed = parseMyBlockRecord(raw);
      if (!parsed || parsed.tree.rootIds.length === 0) {
        return {
          ok: false,
          error: makeMyBlockError(
            "INVALID_RECORD",
            "That saved block is damaged and cannot be used.",
          ),
        };
      }
      return { ok: true, value: parsed as MyBlockRecord };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async createMyBlock(input: CreateMyBlockInput): Promise<MyBlockResult<MyBlockRecord>> {
    try {
      const now = (this.clock() ?? new Date()).toISOString();
      const record: MyBlockRecord = {
        id: input.idFactory ? input.idFactory() : createMyBlockId(),
        version: MY_BLOCK_CURRENT_VERSION,
        // Phase P5: tree content epoch — starts at 1 and only ever changes
        // when the TREE changes (create/duplicate/import). Metadata-only
        // updates (rename, favorite, collections, usage) keep it identical so
        // cached thumbnails stay valid.
        contentRevision: 1,
        name: sanitizeMyBlockName(input.name) ?? "Saved block",
        ...(sanitizeMyBlockDescription(input.description) !== undefined
          ? { description: sanitizeMyBlockDescription(input.description) }
          : {}),
        category: input.category,
        tags: sanitizeMyBlockTags(input.tags),
        tree: input.tree,
        createdAt: now,
        updatedAt: now,
        ...(input.sourceMetadata ? { sourceMetadata: input.sourceMetadata } : {}),
        previewMetadata: input.tree.rootIds[0]
          ? {
              blockCount: Object.keys(input.tree.nodes).length,
              rootType: input.tree.nodes[input.tree.rootIds[0]].type,
              containsMedia: Object.values(input.tree.nodes).some(
                (n) => n.type === "image" || n.type === "video",
              ),
              containsInteractive: Object.values(input.tree.nodes).some(
                (n) =>
                  n.type === "form" ||
                  n.type === "input" ||
                  n.type === "textarea" ||
                  n.type === "checkbox" ||
                  n.type === "tabs" ||
                  n.type === "accordion",
              ),
            }
          : {
              blockCount: 0,
              rootType: "container",
              containsMedia: false,
              containsInteractive: false,
            },
        useCount: 0,
      };

      // Size guard before any write.
      const sizeError = checkRecordSize(record);
      if (sizeError) return { ok: false, error: sizeError };

      // Total library quota guard — never silently drop data.
      const quotaError = await this.checkLibraryQuota(record);
      if (quotaError) return { ok: false, error: quotaError };

      const db = await this.ensureOpen();
      await this.putRecord(db, STORE_MY_BLOCKS, record);
      return { ok: true, value: record };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Update (library metadata only — never project history)
  // -------------------------------------------------------------------------

  async updateMyBlock(
    id: string,
    patch: UpdateMyBlockPatch,
  ): Promise<MyBlockResult<MyBlockRecord>> {
    try {
      const current = await this.getMyBlock(id);
      if (!current.ok) return current;

      const existing = current.value;
      const next: MyBlockRecord = {
        ...existing,
        name: patch.name !== undefined ? (sanitizeMyBlockName(patch.name) ?? existing.name) : existing.name,
        description:
          patch.description !== undefined
            ? (sanitizeMyBlockDescription(patch.description) ?? undefined)
            : existing.description,
        category: patch.category ?? existing.category,
        tags: patch.tags !== undefined ? sanitizeMyBlockTags(patch.tags) : existing.tags,
        updatedAt: (this.clock() ?? new Date()).toISOString(),
      };
      if (patch.lastUsedAt !== undefined) next.lastUsedAt = patch.lastUsedAt;
      if (patch.useCount !== undefined) next.useCount = patch.useCount;
      // Phase P5: star / collections / thumbnail metadata / content revision.
      // None of these touch the tree or project history.
      if (patch.favorite !== undefined) next.favorite = patch.favorite;
      if (patch.collectionIds !== undefined) {
        next.collectionIds = sanitizeMyBlockCollectionIds(patch.collectionIds);
      }
      if (patch.thumbnail !== undefined) {
        next.thumbnail = patch.thumbnail ?? undefined;
      }
      if (patch.contentRevision !== undefined) next.contentRevision = patch.contentRevision;

      const parsed = parseMyBlockRecord(next);
      if (!parsed) {
        return {
          ok: false,
          error: makeMyBlockError("INVALID_RECORD", "The updated saved block failed validation."),
        };
      }

      const sizeError = checkRecordSize(parsed as MyBlockRecord);
      if (sizeError) return { ok: false, error: sizeError };

      // Total library quota guard (the record being updated replaces itself,
      // so its current bytes are subtracted from the used total).
      const quotaError = await this.checkLibraryQuota(parsed as MyBlockRecord, id);
      if (quotaError) return { ok: false, error: quotaError };

      const db = await this.ensureOpen();
      await this.putRecord(db, STORE_MY_BLOCKS, parsed as MyBlockRecord);
      return { ok: true, value: parsed as MyBlockRecord };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Delete (library record only — project copies are untouched)
  // -------------------------------------------------------------------------

  async deleteMyBlock(id: string): Promise<MyBlockResult<{ id: string }>> {
    try {
      const db = await this.ensureOpen();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_MY_BLOCKS, "readwrite");
        const store = tx.objectStore(STORE_MY_BLOCKS);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject((event.target as IDBTransaction).error);
      });
      return { ok: true, value: { id } };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Duplicate — independent library id, deep-cloned tree, safe name
  // -------------------------------------------------------------------------

  async duplicateMyBlock(id: string): Promise<MyBlockResult<MyBlockRecord>> {
    try {
      const current = await this.getMyBlock(id);
      if (!current.ok) return current;
      const existing = current.value;

      const siblings = await this.listMyBlocks();
      const names = siblings.ok
        ? siblings.value.map((b) => b.name)
        : [existing.name];

      const now = (this.clock() ?? new Date()).toISOString();
      const record: MyBlockRecord = {
        ...structuredCloneSafe(existing),
        id: createMyBlockId(),
        name: generateUniqueName(existing.name, names),
        createdAt: now,
        updatedAt: now,
        sourceMetadata: {
          source: "duplicated",
          language: existing.sourceMetadata?.language,
          originalWarningCount: existing.sourceMetadata?.originalWarningCount,
          converterVersion: existing.sourceMetadata?.converterVersion,
        },
        lastUsedAt: undefined,
        useCount: 0,
        // Phase P5: a duplicate is a NEW tree — fresh content epoch, and the
        // old thumbnail (keyed by the old blockId) does not apply.
        contentRevision: 1,
        thumbnail: undefined,
        // Star + collection membership are NOT copied (kept intentionally
        // simple and predictable for beginners).
        favorite: undefined,
        collectionIds: undefined,
      };

      const parsed = parseMyBlockRecord(record);
      if (!parsed) {
        return {
          ok: false,
          error: makeMyBlockError("INVALID_RECORD", "The duplicated saved block failed validation."),
        };
      }

      const sizeError = checkRecordSize(parsed as MyBlockRecord);
      if (sizeError) return { ok: false, error: sizeError };

      // Total library quota guard for the new duplicate.
      const quotaError = await this.checkLibraryQuota(parsed as MyBlockRecord);
      if (quotaError) return { ok: false, error: quotaError };

      const db = await this.ensureOpen();
      await this.putRecord(db, STORE_MY_BLOCKS, parsed as MyBlockRecord);
      return { ok: true, value: parsed as MyBlockRecord };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Test helper — wipe the store (never called in production paths)
  // -------------------------------------------------------------------------

  async clearMyBlocksForTests(): Promise<void> {
    try {
      const db = await this.ensureOpen();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_MY_BLOCKS, "readwrite");
        const store = tx.objectStore(STORE_MY_BLOCKS);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject((event.target as IDBTransaction).error);
      });
    } catch (err) {
      throw toMyBlockError(err);
    }
  }

  // -------------------------------------------------------------------------
  // Collections (Phase P5)
  //
  // Personal folders stored in their own store. Policy:
  //   - deleting a collection NEVER deletes blocks — each block's
  //     collectionIds is cleaned of the removed id
  //   - duplicate-safe names (case-insensitive)
  //   - corrupt collection records are skipped in lists (isolated, never
  //     fatal), like corrupt block records
  //   - collection metadata is library-only — never project history
  // -------------------------------------------------------------------------

  async listMyBlockCollections(): Promise<MyBlockResult<MyBlockCollection[]>> {
    try {
      const db = await this.ensureOpen();
      const raw = await this.getAllRecords<unknown>(db, STORE_MY_BLOCK_COLLECTIONS);
      const collections: MyBlockCollection[] = [];
      for (const entry of raw) {
        const parsed = parseMyBlockCollection(entry);
        if (!parsed) continue;
        collections.push(parsed as MyBlockCollection);
      }
      // Deterministic ordering: sortOrder first, then name (stable tiebreak).
      collections.sort(
        (a, b) =>
          a.sortOrder - b.sortOrder ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
      return { ok: true, value: collections };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  async getMyBlockCollection(id: string): Promise<MyBlockResult<MyBlockCollection>> {
    try {
      const db = await this.ensureOpen();
      const raw = await this.getRecord<unknown>(db, STORE_MY_BLOCK_COLLECTIONS, id);
      if (raw === undefined) {
        return {
          ok: false,
          error: makeMyBlockError("COLLECTION_NOT_FOUND", "That collection no longer exists."),
        };
      }
      const parsed = parseMyBlockCollection(raw);
      if (!parsed) {
        return {
          ok: false,
          error: makeMyBlockError("INVALID_RECORD", "That collection is damaged and cannot be used."),
        };
      }
      return { ok: true, value: parsed as MyBlockCollection };
    } catch (err) {
      return { ok: false, error: toMyBlockError(err) };
    }
  }

  async createMyBlockCollection(
    input: CreateMyBlockCollectionInput,
  ): Promise<MyBlockResult<MyBlockCollection>> {
    try {
      const siblings = await this.listMyBlockCollections();
      if (!siblings.ok) return siblings;
      if (siblings.value.length >= MY_BLOCK_MAX_COLLECTIONS) {
        return {
          ok: false,
          error: makeMyBlockError(
            "QUOTA_EXCEEDED",
            `You can have at most ${MY_BLOCK_MAX_COLLECTIONS} collections. Delete one to create another.`,
          ),
        };
      }

      const now = (this.clock() ?? new Date()).toISOString();
      const maxOrder = siblings.value.reduce((max, c) => Math.max(max, c.sortOrder), -1);
      const collection: MyBlockCollection = {
        id: input.idFactory ? input.idFactory() : `collection-${createMyBlockId()}`,
        version: 1,
        name: generateUniqueCollectionName(
          input.name,
          siblings.value.map((c) => c.name),
        ),
        ...(sanitizeMyBlockCollectionDescription(input.description) !== undefined
          ? { description: sanitizeMyBlockCollectionDescription(input.description) }
          : {}),
        createdAt: now,
        updatedAt: now,
        sortOrder: maxOrder + 1,
      };

      const parsed = parseMyBlockCollection(collection);
      if (!parsed) {
        return {
          ok: false,
          error: makeMyBlockError("INVALID_RECORD", "The collection failed validation."),
        };
      }
      const db = await this.ensureOpen();
      await this.putRecord(db, STORE_MY_BLOCK_COLLECTIONS, parsed as MyBlockCollection);
      return { ok: true, value: parsed as MyBlockCollection };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  async updateMyBlockCollection(
    id: string,
    patch: UpdateMyBlockCollectionPatch,
  ): Promise<MyBlockResult<MyBlockCollection>> {
    try {
      const current = await this.getMyBlockCollection(id);
      if (!current.ok) return current;

      const existing = current.value;
      let name = existing.name;
      if (patch.name !== undefined) {
        const sanitized = sanitizeMyBlockCollectionName(patch.name);
        if (!sanitized) {
          return {
            ok: false,
            error: makeMyBlockError("INVALID_NAME", "Collection names cannot be empty."),
          };
        }
        // Duplicate-safe rename (case-insensitive; itself excluded).
        const siblings = await this.listMyBlockCollections();
        const others = siblings.ok
          ? siblings.value.filter((c) => c.id !== id).map((c) => c.name)
          : [];
        name = generateUniqueCollectionName(sanitized, others);
      }

      const next: MyBlockCollection = {
        ...existing,
        name,
        description:
          patch.description !== undefined
            ? (sanitizeMyBlockCollectionDescription(patch.description) ?? undefined)
            : existing.description,
        sortOrder:
          patch.sortOrder !== undefined
            ? Math.max(0, Math.floor(patch.sortOrder))
            : existing.sortOrder,
        updatedAt: (this.clock() ?? new Date()).toISOString(),
      };

      const parsed = parseMyBlockCollection(next);
      if (!parsed) {
        return {
          ok: false,
          error: makeMyBlockError("INVALID_RECORD", "The updated collection failed validation."),
        };
      }
      const db = await this.ensureOpen();
      await this.putRecord(db, STORE_MY_BLOCK_COLLECTIONS, parsed as MyBlockCollection);
      return { ok: true, value: parsed as MyBlockCollection };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  async deleteMyBlockCollection(id: string): Promise<MyBlockResult<{ id: string }>> {
    try {
      const db = await this.ensureOpen();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([STORE_MY_BLOCK_COLLECTIONS, STORE_MY_BLOCKS], "readwrite");
        const collectionStore = tx.objectStore(STORE_MY_BLOCK_COLLECTIONS);
        const blockStore = tx.objectStore(STORE_MY_BLOCKS);

        // Delete the collection record (idempotent).
        collectionStore.delete(id);

        // Clean the removed id from every block's collectionIds. Blocks are
        // NEVER deleted — only their membership is updated.
        const getAll = blockStore.getAll();
        getAll.onsuccess = () => {
          const blocks = getAll.result as MyBlockRecord[];
          for (const block of blocks) {
            if (block.collectionIds && block.collectionIds.includes(id)) {
              const cleaned: MyBlockRecord = {
                ...block,
                collectionIds: block.collectionIds.filter((cid) => cid !== id),
              };
              blockStore.put(cleaned);
            }
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = (event) => reject((event.target as IDBTransaction).error);
      });
      return { ok: true, value: { id } };
    } catch (err) {
      return { ok: false, error: mapMyBlockError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Quota / size
  // -------------------------------------------------------------------------

  /** Approximate JSON byte size of a record (for quota decisions). */
  static estimateRecordBytes(record: MyBlockRecord): number {
    try {
      return new Blob([JSON.stringify(record)]).size;
    } catch {
      // Node / non-DOM environments: fall back to string length.
      return JSON.stringify(record).length * 2;
    }
  }

  /**
   * Enforce the total recommended library size before any write. Never
   * silently drops data — writes are rejected with a user-safe quota error.
   */
  private async checkLibraryQuota(
    incoming: MyBlockRecord,
    existingId?: string,
  ): Promise<ReturnType<typeof makeMyBlockError> | null> {
    const siblings = await this.listMyBlocks();
    if (!siblings.ok) return null;
    let used = 0;
    for (const block of siblings.value) {
      if (block.id === existingId) continue; // replaced by `incoming`
      used += MyBlocksIndexedDbAdapter.estimateRecordBytes(block);
    }
    const incomingBytes = MyBlocksIndexedDbAdapter.estimateRecordBytes(incoming);
    if (used + incomingBytes > MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES) {
      return libraryQuotaError(used, incomingBytes, MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES);
    }
    return null;
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

  private putRecord(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = (event) => reject((event.target as IDBRequest).error);
      tx.onerror = (event) => reject((event.target as IDBTransaction).error);
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkRecordSize(record: MyBlockRecord): ReturnType<typeof makeMyBlockError> | null {
  const bytes = MyBlocksIndexedDbAdapter.estimateRecordBytes(record);
  if (bytes > MY_BLOCK_MAX_RECORD_SIZE_BYTES) {
    return quotaErrorFor(bytes, MY_BLOCK_MAX_RECORD_SIZE_BYTES);
  }
  return null;
}

/** Approximate total JSON byte size of a set of records (quota + UI usage). */
export function estimateLibraryBytes(
  records: ReadonlyArray<MyBlockRecord>,
): number {
  let total = 0;
  for (const record of records) {
    total += MyBlocksIndexedDbAdapter.estimateRecordBytes(record);
  }
  return total;
}

function mapMyBlockError(err: unknown): ReturnType<typeof makeMyBlockError> {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as { code: string; message: string };
    return makeMyBlockError(candidate.code as never, candidate.message);
  }
  if (err instanceof DOMException && err.name === "QuotaExceededError") {
    return makeMyBlockError(
      "QUOTA_EXCEEDED",
      "Your browser's storage is full. Delete a saved block or free up space, then try again.",
      err.message,
    );
  }
  return makeMyBlockError("UNKNOWN_ERROR", "The saved block could not be written to storage.");
}

/** Deep clone without structuredClone (Node 16-safe, JSON-safe values only). */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
