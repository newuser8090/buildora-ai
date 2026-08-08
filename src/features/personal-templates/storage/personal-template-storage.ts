// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — IndexedDB storage adapter
//
// Persists PersonalTemplateRecord objects in the "personalTemplates" store
// (database version 8). Shares the canonical ensureDatabaseStores() helper so
// every DB-opening adapter creates the store on first connection.
//
// Local-only in P9. No deployment/domain/sync/auth state is ever stored.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_PERSONAL_TEMPLATES,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import {
  MAX_PERSONAL_TEMPLATES,
  type PersonalTemplateError,
  type PersonalTemplateRecord,
} from "../types";

export type PersonalTemplateResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PersonalTemplateError };

export interface PersonalTemplateStorageAdapter {
  listTemplates(): Promise<PersonalTemplateResult<PersonalTemplateRecord[]>>;
  getTemplate(
    templateId: string,
  ): Promise<PersonalTemplateResult<PersonalTemplateRecord | null>>;
  saveTemplate(
    record: PersonalTemplateRecord,
  ): Promise<PersonalTemplateResult<PersonalTemplateRecord>>;
  deleteTemplate(templateId: string): Promise<PersonalTemplateResult<void>>;
  countTemplates(): Promise<PersonalTemplateResult<number>>;
  close(): void;
}

export class IndexedDbPersonalTemplateAdapter
  implements PersonalTemplateStorageAdapter
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
      const tx = db.transaction(STORE_PERSONAL_TEMPLATES, mode);
      const store = tx.objectStore(STORE_PERSONAL_TEMPLATES);
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

  async listTemplates(): Promise<
    PersonalTemplateResult<PersonalTemplateRecord[]>
  > {
    try {
      const db = await this.ensureOpen();
      const all = await new Promise<PersonalTemplateRecord[]>((resolve, reject) => {
        const tx = db.transaction(STORE_PERSONAL_TEMPLATES, "readonly");
        const req = tx.objectStore(STORE_PERSONAL_TEMPLATES).getAll();
        req.onsuccess = () => resolve((req.result as PersonalTemplateRecord[]) ?? []);
        req.onerror = () => reject(req.error ?? new Error("List failed."));
      });
      // Newest first (deterministic tie-breaker by id).
      const sorted = [...all].sort(
        (a, b) =>
          b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
      return { ok: true, value: sorted };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_UNKNOWN_ERROR",
          message: "Your templates could not be loaded.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async getTemplate(
    templateId: string,
  ): Promise<PersonalTemplateResult<PersonalTemplateRecord | null>> {
    try {
      const db = await this.ensureOpen();
      const record = await new Promise<PersonalTemplateRecord | null>(
        (resolve, reject) => {
          const tx = db.transaction(STORE_PERSONAL_TEMPLATES, "readonly");
          const req = tx.objectStore(STORE_PERSONAL_TEMPLATES).get(templateId);
          req.onsuccess = () =>
            resolve((req.result as PersonalTemplateRecord) ?? null);
          req.onerror = () => reject(req.error ?? new Error("Read failed."));
        },
      );
      return { ok: true, value: record };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_UNKNOWN_ERROR",
          message: "The template could not be loaded.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async saveTemplate(
    record: PersonalTemplateRecord,
  ): Promise<PersonalTemplateResult<PersonalTemplateRecord>> {
    try {
      // Bounded storage: refuse to exceed the cap — never a silent overwrite
      // of another template, and never unbounded growth.
      const existing = await this.getTemplate(record.id);
      if (existing.ok && existing.value) {
        // Updating an existing template does not consume a new slot.
        await this.run("readwrite", (store) => {
          store.put(record);
        });
        return { ok: true, value: record };
      }

      const count = await this.countTemplates();
      if (!count.ok) return count;
      if (count.value >= MAX_PERSONAL_TEMPLATES) {
        return {
          ok: false,
          error: {
            code: "PERSONAL_TEMPLATE_QUOTA_EXCEEDED",
            message:
              "You've saved a lot of templates. Delete one before adding another.",
          },
        };
      }

      await this.run("readwrite", (store) => {
        store.put(record);
      });
      return { ok: true, value: record };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_UNKNOWN_ERROR",
          message: "The template could not be saved.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async deleteTemplate(
    templateId: string,
  ): Promise<PersonalTemplateResult<void>> {
    try {
      await this.run("readwrite", (store) => {
        store.delete(templateId);
      });
      return { ok: true, value: undefined };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_UNKNOWN_ERROR",
          message: "The template could not be deleted.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  async countTemplates(): Promise<PersonalTemplateResult<number>> {
    try {
      const db = await this.ensureOpen();
      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE_PERSONAL_TEMPLATES, "readonly");
        const req = tx.objectStore(STORE_PERSONAL_TEMPLATES).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("Count failed."));
      });
      return { ok: true, value: count };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "PERSONAL_TEMPLATE_UNKNOWN_ERROR",
          message: "Your templates could not be counted.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton (browser)
// ---------------------------------------------------------------------------

let singleton: IndexedDbPersonalTemplateAdapter | null = null;

export function getPersonalTemplateStorage(): PersonalTemplateStorageAdapter {
  if (!singleton) {
    singleton = new IndexedDbPersonalTemplateAdapter();
  }
  return singleton;
}

export function setPersonalTemplateStorageForTests(
  adapter: PersonalTemplateStorageAdapter | null,
): void {
  singleton = adapter as IndexedDbPersonalTemplateAdapter | null;
}
