// ---------------------------------------------------------------------------
// Persistence — shared IndexedDB schema
//
// ONE source of truth for the object-store list. EVERY adapter that can open
// the buildora database (project, project-thumbnails, my-blocks, my-block
// thumbnails) must call ensureDatabaseStores() inside its onupgradeneeded
// handler.
//
// Why a shared helper (Phase P4 lesson): when a fresh profile opens the
// database, whichever adapter happens to run the version-bump upgrade must
// create EVERY store, not just its own. If the thumbnail adapter upgraded
// the DB to version N without the myBlocks store, no later adapter's
// upgrade handler would ever run again (the version is already N) and the
// personal block library would silently break. Centralizing the list makes
// that class of bug impossible.
// ---------------------------------------------------------------------------

import {
  STORE_PROJECTS,
  STORE_METADATA,
  STORE_PROJECT_THUMBNAILS,
  STORE_MY_BLOCKS,
  STORE_MY_BLOCK_THUMBNAILS,
  STORE_MY_BLOCK_COLLECTIONS,
  STORE_CLOUD_SYNC_QUEUE,
  STORE_CLOUD_SYNC_MARKERS,
  STORE_CLOUD_SYNC_CONFLICTS,
  STORE_DEPLOYMENTS,
  STORE_DEPLOYMENT_DOMAINS,
  STORE_PERSONAL_TEMPLATES,
  STORE_RECOVERY_SNAPSHOTS,
} from "../constants";

/**
 * Create every object store that is missing. Non-destructive — existing
 * stores and their data are never touched.
 */
export function ensureDatabaseStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
    db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(STORE_METADATA)) {
    db.createObjectStore(STORE_METADATA, { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains(STORE_PROJECT_THUMBNAILS)) {
    db.createObjectStore(STORE_PROJECT_THUMBNAILS, { keyPath: "projectId" });
  }
  if (!db.objectStoreNames.contains(STORE_MY_BLOCKS)) {
    db.createObjectStore(STORE_MY_BLOCKS, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(STORE_MY_BLOCK_THUMBNAILS)) {
    db.createObjectStore(STORE_MY_BLOCK_THUMBNAILS, { keyPath: "blockId" });
  }
  if (!db.objectStoreNames.contains(STORE_MY_BLOCK_COLLECTIONS)) {
    db.createObjectStore(STORE_MY_BLOCK_COLLECTIONS, { keyPath: "id" });
  }
  // Phase P6 (database version 5): durable cloud-sync stores.
  if (!db.objectStoreNames.contains(STORE_CLOUD_SYNC_QUEUE)) {
    // Keyed by queue entry id; entries are queried by userId via index.
    db.createObjectStore(STORE_CLOUD_SYNC_QUEUE, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(STORE_CLOUD_SYNC_MARKERS)) {
    // Keyed by `${userId}:${entityType}:${localEntityId}` for isolated lookups.
    db.createObjectStore(STORE_CLOUD_SYNC_MARKERS, { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains(STORE_CLOUD_SYNC_CONFLICTS)) {
    db.createObjectStore(STORE_CLOUD_SYNC_CONFLICTS, { keyPath: "id" });
  }
  // Phase P7 (database version 6): deployment history.
  if (!db.objectStoreNames.contains(STORE_DEPLOYMENTS)) {
    db.createObjectStore(STORE_DEPLOYMENTS, { keyPath: "id" });
  }
  // Phase P8 (database version 7): custom domain records (local history/cache
  // of the provider-backed domain infrastructure).
  if (!db.objectStoreNames.contains(STORE_DEPLOYMENT_DOMAINS)) {
    db.createObjectStore(STORE_DEPLOYMENT_DOMAINS, { keyPath: "id" });
  }
  // Phase P9 (database version 8): saved personal templates (local-only).
  if (!db.objectStoreNames.contains(STORE_PERSONAL_TEMPLATES)) {
    db.createObjectStore(STORE_PERSONAL_TEMPLATES, { keyPath: "id" });
  }
  // Phase P9 (database version 8): bounded draft-recovery snapshots.
  if (!db.objectStoreNames.contains(STORE_RECOVERY_SNAPSHOTS)) {
    db.createObjectStore(STORE_RECOVERY_SNAPSHOTS, { keyPath: "id" });
  }
}
