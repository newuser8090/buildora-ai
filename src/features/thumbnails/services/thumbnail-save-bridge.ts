// ---------------------------------------------------------------------------
// ThumbnailInfrastructure — bridge between ProjectController and thumbnails
//
// ProjectController calls scheduleThumbnailForSave() ONLY after a successful
// persisted save (autosave success, manual save, creation, template creation,
// import commit, rename save). This keeps the controller free of thumbnail
// logic while ensuring thumbnails are never generated on every keystroke.
//
// The scheduler + storage adapter are created lazily (but synchronously on
// first use in a DOM environment). Tests inject fakes via the setters. All
// functions are safe no-ops when no infrastructure is available — a thumbnail
// failure can NEVER block a save, autosave, transition, or dashboard load.
// ---------------------------------------------------------------------------

import { ThumbnailScheduler, type ThumbnailScheduleRequest } from "./thumbnail-scheduler";
import { IndexedDbThumbnailAdapter } from "../storage/thumbnail-storage-adapter";
import { ThumbnailGenerationService } from "./thumbnail-generation-service";
import type { ProjectThumbnailStorageAdapter } from "../types";

// ---------------------------------------------------------------------------
// Lazy (synchronous) browser infrastructure
// ---------------------------------------------------------------------------

let bridgeScheduler: ThumbnailScheduler | null | undefined;
let bridgeStorage: ProjectThumbnailStorageAdapter | null | undefined;
let bridgeGeneration: ThumbnailGenerationService | null | undefined;

/**
 * Synchronously build the real infrastructure on first use. The imported
 * modules only touch the DOM/IndexedDB inside functions (never at import
 * time), so these static imports are safe in any environment.
 */
function buildBrowserInfrastructure(): ThumbnailScheduler | null {
  if (bridgeScheduler) return bridgeScheduler;
  if (typeof document === "undefined" || typeof window === "undefined") {
    // SSR / non-DOM environment — scheduling stays a no-op.
    bridgeScheduler = null;
    return null;
  }
  // No IndexedDB (e.g. jsdom without fake-indexeddb, private modes) — build
  // nothing real so unit tests never mount capture infrastructure or schedule
  // timers, and the null result is cached to avoid repeated construction.
  if (typeof globalThis.indexedDB === "undefined") {
    bridgeScheduler = null;
    return null;
  }
  try {
    const storage = new IndexedDbThumbnailAdapter();
    const service = new ThumbnailGenerationService();
    const scheduler = new ThumbnailScheduler({
      storage,
      generate: (request) => service.generate(request),
    });
    bridgeStorage = storage;
    bridgeGeneration = service;
    bridgeScheduler = scheduler;
    return scheduler;
  } catch {
    // Infrastructure unavailable — scheduling stays a no-op.
    bridgeScheduler = null;
    return null;
  }
}

/** Resolve the scheduler, building browser infrastructure if needed. */
function resolveScheduler(): ThumbnailScheduler | null {
  if (bridgeScheduler !== undefined) return bridgeScheduler;
  return buildBrowserInfrastructure();
}

// ---------------------------------------------------------------------------
// Test + bootstrap injection
// ---------------------------------------------------------------------------

export function setThumbnailSchedulerForBridge(
  scheduler: ThumbnailScheduler | null,
): void {
  bridgeScheduler = scheduler;
}

export function setThumbnailStorageForBridge(
  storage: import("../types").ProjectThumbnailStorageAdapter | null,
): void {
  bridgeStorage = storage;
}

export function setThumbnailGenerationServiceForBridge(
  service: ThumbnailGenerationService | null,
): void {
  bridgeGeneration = service;
}

export function resetThumbnailBridge(): void {
  bridgeScheduler = undefined;
  bridgeStorage = undefined;
  bridgeGeneration = undefined;
}

export function getBridgeStorage(): ProjectThumbnailStorageAdapter | null {
  return bridgeStorage ?? null;
}

/**
 * Resolve the thumbnail storage adapter (building browser infrastructure when
 * available). Returns null when no storage is available — callers treat that
 * as "no thumbnails" and degrade to placeholders. Never throws.
 */
export function getThumbnailStorage(): ProjectThumbnailStorageAdapter | null {
  try {
    resolveScheduler();
  } catch {
    // Storage unavailable — return null below.
  }
  return bridgeStorage ?? null;
}

export function getThumbnailScheduler(): ThumbnailScheduler | null {
  return resolveScheduler();
}

/**
 * Subscribe to thumbnail-completion notifications from the application
 * scheduler. The listener fires with { projectId, revision } ONLY after the
 * storage write transaction has fully committed, so the record is guaranteed
 * readable from a separate connection when the listener reacts.
 *
 * Safe no-op when no scheduler is installed (returns a no-op unsubscribe).
 * The returned function unsubscribes. Never throws.
 */
export function subscribeThumbnailReady(
  listener: (info: { projectId: string; revision: number }) => void,
): () => void {
  try {
    const scheduler = resolveScheduler();
    if (!scheduler) return () => {};
    return scheduler.subscribeReady(listener);
  } catch {
    // No scheduler — return a no-op unsubscribe.
    return () => {};
  }
}

/**
 * Resolve the thumbnail generation service (building browser infrastructure
 * when available). Returns null when unavailable. Never throws.
 */
export function getThumbnailGenerationService(): ThumbnailGenerationService | null {
  try {
    resolveScheduler();
  } catch {
    // Service unavailable — return null below.
  }
  return bridgeGeneration ?? null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule thumbnail generation after a successful persisted save.
 * Safe no-op when no scheduler is installed. Never throws.
 */
export function scheduleThumbnailForSave(
  request: ThumbnailScheduleRequest,
): void {
  try {
    const scheduler = resolveScheduler();
    if (!scheduler) return;
    scheduler.schedule(request);
  } catch {
    // Thumbnail scheduling must never break the save flow.
  }
}

/**
 * Remove a project's thumbnail + cancel pending work (non-blocking).
 * Called on project delete. A cleanup failure is deliberately swallowed:
 * a stale thumbnail record must never make a deleted project reappear, and
 * it must never block the delete.
 */
export function removeThumbnailForProject(projectId: string): void {
  try {
    const scheduler = resolveScheduler();
    if (scheduler) scheduler.cancel(projectId);
    const storage = bridgeStorage ?? null;
    if (storage) {
      void storage.removeThumbnail(projectId).catch(() => {
        // Non-blocking cleanup.
      });
    }
  } catch {
    // Non-blocking cleanup.
  }
}
