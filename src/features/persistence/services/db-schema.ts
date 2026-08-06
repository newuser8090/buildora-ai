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
}
