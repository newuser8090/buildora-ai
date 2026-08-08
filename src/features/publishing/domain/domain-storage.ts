// ---------------------------------------------------------------------------
// Publishing — custom domain storage — IndexedDB adapter (Phase P8)
//
// Persists DeploymentDomainRecord objects in the "deploymentDomains" store
// (database version 7). Shares the canonical ensureDatabaseStores() helper so
// every DB-opening adapter creates the store on first connection. Domains are
// local product history/cache — the provider is the remote source of truth.
// No DNS credentials or private keys are ever stored.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_DEPLOYMENT_DOMAINS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { DeploymentDomainRecord } from "./types";

export interface DomainStorageAdapter {
  createDomain(record: DeploymentDomainRecord): Promise<DeploymentDomainRecord>;
  updateDomain(
    domainId: string,
    patch: Partial<DeploymentDomainRecord>,
  ): Promise<DeploymentDomainRecord | null>;
  getDomain(domainId: string): Promise<DeploymentDomainRecord | null>;
  listDomains(projectId: string): Promise<DeploymentDomainRecord[]>;
  removeDomain(domainId: string): Promise<void>;
  removeDomainsForProject(projectId: string): Promise<void>;
  close(): void;
}

export class IndexedDbDomainAdapter implements DomainStorageAdapter {
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
        // Shared schema helper — creates EVERY store so whichever adapter
        // triggers the version bump leaves the database complete.
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
      const tx = db.transaction(STORE_DEPLOYMENT_DOMAINS, mode);
      const store = tx.objectStore(STORE_DEPLOYMENT_DOMAINS);
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

  async createDomain(record: DeploymentDomainRecord): Promise<DeploymentDomainRecord> {
    await this.run("readwrite", (store) => {
      store.put(record);
    });
    return record;
  }

  async updateDomain(
    domainId: string,
    patch: Partial<DeploymentDomainRecord>,
  ): Promise<DeploymentDomainRecord | null> {
    const db = await this.ensureOpen();
    return new Promise<DeploymentDomainRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENT_DOMAINS, "readwrite");
      const store = tx.objectStore(STORE_DEPLOYMENT_DOMAINS);
      let merged: DeploymentDomainRecord | null = null;
      const getReq = store.get(domainId);
      getReq.onsuccess = () => {
        const existing = getReq.result as DeploymentDomainRecord | undefined;
        if (!existing) {
          resolve(null);
          return;
        }
        merged = { ...existing, ...patch, id: existing.id };
        store.put(merged);
      };
      getReq.onerror = () => reject(getReq.error ?? new Error("Read failed."));
      tx.oncomplete = () => {
        if (merged) resolve(merged);
      };
      tx.onerror = () => reject(tx.error ?? new Error("Transaction failed."));
    });
  }

  async getDomain(domainId: string): Promise<DeploymentDomainRecord | null> {
    const db = await this.ensureOpen();
    return new Promise<DeploymentDomainRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENT_DOMAINS, "readonly");
      const req = tx.objectStore(STORE_DEPLOYMENT_DOMAINS).get(domainId);
      req.onsuccess = () => resolve((req.result as DeploymentDomainRecord) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Read failed."));
    });
  }

  async listDomains(projectId: string): Promise<DeploymentDomainRecord[]> {
    const db = await this.ensureOpen();
    return new Promise<DeploymentDomainRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENT_DOMAINS, "readonly");
      const req = tx.objectStore(STORE_DEPLOYMENT_DOMAINS).getAll();
      req.onsuccess = () => {
        const all = (req.result as DeploymentDomainRecord[]) ?? [];
        resolve(
          all
            .filter((r) => r.projectId === projectId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
      };
      req.onerror = () => reject(req.error ?? new Error("List failed."));
    });
  }

  async removeDomain(domainId: string): Promise<void> {
    await this.run("readwrite", (store) => {
      store.delete(domainId);
    });
  }

  async removeDomainsForProject(projectId: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENT_DOMAINS, "readwrite");
      const store = tx.objectStore(STORE_DEPLOYMENT_DOMAINS);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as DeploymentDomainRecord[]) ?? [];
        for (const record of all) {
          if (record.projectId === projectId) store.delete(record.id);
        }
      };
      req.onerror = () => reject(req.error ?? new Error("List failed."));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Transaction failed."));
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton (browser)
// ---------------------------------------------------------------------------

let singleton: IndexedDbDomainAdapter | null = null;

export function getDomainAdapter(): DomainStorageAdapter {
  if (!singleton) {
    singleton = new IndexedDbDomainAdapter();
  }
  return singleton;
}

export function setDomainAdapterForTests(adapter: DomainStorageAdapter | null): void {
  singleton = adapter as IndexedDbDomainAdapter | null;
}
