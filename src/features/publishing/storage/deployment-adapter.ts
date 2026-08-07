// ---------------------------------------------------------------------------
// Deployment storage — IndexedDB adapter (Phase P7)
//
// Persists DeploymentRecord objects in the "deployments" store (database
// version 6). Shares the canonical ensureDatabaseStores() schema helper so
// every DB-opening adapter creates the store on first connection.
//
// No tokens, no provider secrets, and no generated ZIP blobs are stored.
// ---------------------------------------------------------------------------

import {
  DATABASE_NAME,
  DATABASE_VERSION,
  STORE_DEPLOYMENTS,
} from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { DeploymentRecord } from "../types";

export interface DeploymentStorageAdapter {
  createDeployment(record: DeploymentRecord): Promise<DeploymentRecord>;
  updateDeployment(
    deploymentId: string,
    patch: Partial<DeploymentRecord>,
  ): Promise<DeploymentRecord | null>;
  getDeployment(deploymentId: string): Promise<DeploymentRecord | null>;
  listDeployments(projectId: string): Promise<DeploymentRecord[]>;
  removeDeployment(deploymentId: string): Promise<void>;
  removeDeploymentsForProject(projectId: string): Promise<void>;
  close(): void;
}

export class IndexedDbDeploymentAdapter implements DeploymentStorageAdapter {
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
        const db = (event.target as IDBOpenDBRequest).result;
        // Shared schema helper — creates EVERY store, so whichever adapter
        // triggers the version bump leaves the database complete.
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
      const tx = db.transaction(STORE_DEPLOYMENTS, mode);
      const store = tx.objectStore(STORE_DEPLOYMENTS);
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

  async createDeployment(record: DeploymentRecord): Promise<DeploymentRecord> {
    await this.run("readwrite", (store) => {
      store.put(record);
    });
    return record;
  }

  async updateDeployment(
    deploymentId: string,
    patch: Partial<DeploymentRecord>,
  ): Promise<DeploymentRecord | null> {
    const db = await this.ensureOpen();
    return new Promise<DeploymentRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENTS, "readwrite");
      const store = tx.objectStore(STORE_DEPLOYMENTS);
      let merged: DeploymentRecord | null = null;
      const getReq = store.get(deploymentId);
      getReq.onsuccess = () => {
        const existing = getReq.result as DeploymentRecord | undefined;
        if (!existing) {
          resolve(null);
          return;
        }
        // Merge + write in the SAME transaction; the completion handler
        // resolves with the merged record (no nested transaction — opening
        // a transaction inside oncomplete is rejected by some engines).
        merged = { ...existing, ...patch, id: existing.id };
        store.put(merged);
      };
      getReq.onerror = () =>
        reject(getReq.error ?? new Error("Read failed."));
      tx.oncomplete = () => {
        if (merged) resolve(merged);
      };
      tx.onerror = () =>
        reject(tx.error ?? new Error("Transaction failed."));
    });
  }

  async getDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    const db = await this.ensureOpen();
    return new Promise<DeploymentRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENTS, "readonly");
      const req = tx.objectStore(STORE_DEPLOYMENTS).get(deploymentId);
      req.onsuccess = () => resolve((req.result as DeploymentRecord) ?? null);
      req.onerror = () => reject(req.error ?? new Error("Read failed."));
    });
  }

  async listDeployments(projectId: string): Promise<DeploymentRecord[]> {
    const db = await this.ensureOpen();
    return new Promise<DeploymentRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENTS, "readonly");
      const req = tx.objectStore(STORE_DEPLOYMENTS).getAll();
      req.onsuccess = () => {
        const all = (req.result as DeploymentRecord[]) ?? [];
        const filtered = all
          .filter((r) => r.projectId === projectId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        resolve(filtered);
      };
      req.onerror = () => reject(req.error ?? new Error("List failed."));
    });
  }

  async removeDeployment(deploymentId: string): Promise<void> {
    await this.run("readwrite", (store) => {
      store.delete(deploymentId);
    });
  }

  async removeDeploymentsForProject(projectId: string): Promise<void> {
    const db = await this.ensureOpen();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_DEPLOYMENTS, "readwrite");
      const store = tx.objectStore(STORE_DEPLOYMENTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as DeploymentRecord[]) ?? [];
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

let singleton: IndexedDbDeploymentAdapter | null = null;

export function getDeploymentAdapter(): DeploymentStorageAdapter {
  if (!singleton) {
    singleton = new IndexedDbDeploymentAdapter();
  }
  return singleton;
}

export function setDeploymentAdapterForTests(
  adapter: DeploymentStorageAdapter | null,
): void {
  singleton = adapter as IndexedDbDeploymentAdapter | null;
}
