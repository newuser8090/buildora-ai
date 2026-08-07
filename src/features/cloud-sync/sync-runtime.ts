// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — browser runtime
//
// Owns the singleton sync engine and the actions the UI calls:
//   - syncNow() — explicit "Sync now"
//   - runInitialMergeFlow(choice) — initial sign-in merge
//   - resolveConflict(userId, conflictId, resolution)
//   - scheduleSyncSoon() — debounced sync after local changes
//   - removeCloudDataFromDevice(userId) — explicit, confirmed cleanup
//
// The lifecycle provider wires auth/online events into these actions.
// Local-first: with no cloud provider, every action is a safe no-op.
// ---------------------------------------------------------------------------

import { CloudSyncQueue } from "./queue/cloud-sync-queue";
import { CloudSyncMarkers } from "./markers/cloud-sync-markers";
import { CloudConflictStore } from "./conflicts/cloud-conflict-store";
import { RawLibraryWriter, CloudRemoteApplier } from "./services/remote-apply";
import { CloudSyncEngine } from "./services/cloud-sync-engine";
import { InitialMergeService } from "./services/initial-merge";
import { ConflictResolverService } from "./services/conflict-resolution";
import { SyncEnqueuer, UNSIGNED_USER_ID } from "./services/sync-enqueuer";
import { getCloudProvider } from "./providers/provider-factory";
import { SyncMetadataStore } from "./sync-metadata-store";
import { useCloudSyncStore } from "./store/cloud-sync-store";
import { METADATA_KEY_SYNC_CURSOR_PREFIX, METADATA_KEY_INITIAL_MERGE_PREFIX } from "@/features/persistence/constants";
import { useAuthStore } from "@/features/auth/auth-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { getMyBlocksAdapter } from "@/features/my-blocks/storage/my-blocks-singleton";
import { MyBlocksIndexedDbAdapter } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import { getMyBlockThumbnailService } from "@/features/my-blocks/thumbnails/my-block-thumbnail-singleton";
import { SYNC_CHANGE_DEBOUNCE_MS, SYNC_PERIODIC_INTERVAL_MS } from "./constants";
import type { InitialMergeChoice } from "./types";
import type { ConflictResolution } from "./services/conflict-resolution";
import type { MyBlockLocalMutationEvent } from "@/features/my-blocks/storage/my-blocks-storage-adapter";
import type { MyBlockRecord } from "@/features/my-blocks/types";

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let engineSingleton: CloudSyncEngine | null | undefined;
let enqueuerSingleton: SyncEnqueuer | null | undefined;
let mergeServiceSingleton: InitialMergeService | null | undefined;
let conflictServiceSingleton: ConflictResolverService | null | undefined;

let queue: CloudSyncQueue | null = null;
let markers: CloudSyncMarkers | null = null;
let conflicts: CloudConflictStore | null = null;
let writer: RawLibraryWriter | null = null;
let applier: CloudRemoteApplier | null = null;

function buildServices(): boolean {
  const provider = getCloudProvider();
  if (!provider) return false;
  queue = new CloudSyncQueue();
  markers = new CloudSyncMarkers();
  conflicts = new CloudConflictStore();
  writer = new RawLibraryWriter();
  const adapter = getMyBlocksAdapter();
  applier = new CloudRemoteApplier({
    markers: {
      put: (marker) => markers!.putMarker(marker),
      remove: (userId, entityType, localId) =>
        markers!.removeMarker(userId, entityType, localId),
    },
    // Regenerate thumbnails locally after remote downloads (never blocking).
    ensureThumbnail: async (record: MyBlockRecord) => {
      try {
        const service = getMyBlockThumbnailService();
        const result = await service.ensureForRecord(record);
        if (!result.ok) return;
        const thumb = result.value;
        await writer!.putBlock({
          ...record,
          thumbnail: {
            revision: thumb.revision,
            generatedAt: thumb.generatedAt,
            mimeType: thumb.mimeType,
            width: thumb.width,
            height: thumb.height,
            byteSize: thumb.byteSize,
            hash: thumb.hash,
          },
        });
      } catch {
        // Best-effort only — thumbnails never block core sync.
      }
    },
  });
  engineSingleton = new CloudSyncEngine({
    provider,
    queue,
    markers,
    conflicts,
    applier,
    writer,
    adapter,
    isOnline: () => (typeof navigator !== "undefined" ? navigator.onLine : true),
    onRefresh: () => useMyBlocksUiStore.getState().bumpRefresh(),
    deleteThumbnail: async (blockId) => {
      await getMyBlockThumbnailService().deleteForBlock(blockId);
    },
  });
  enqueuerSingleton = new SyncEnqueuer({
    queue,
    adapter,
    onQueued: () => scheduleSyncSoon(),
  });
  mergeServiceSingleton = new InitialMergeService({
    provider,
    markers,
    applier,
    writer,
    adapter,
    deleteThumbnail: async (blockId) => {
      await getMyBlockThumbnailService().deleteForBlock(blockId);
    },
  });
  conflictServiceSingleton = new ConflictResolverService({
    conflicts,
    markers,
    queue,
    applier,
    writer,
    adapter,
    deleteThumbnail: async (blockId) => {
      await getMyBlockThumbnailService().deleteForBlock(blockId);
    },
    onRefresh: () => useMyBlocksUiStore.getState().bumpRefresh(),
  });
  return true;
}

export function getSyncEngine(): CloudSyncEngine | null {
  if (engineSingleton !== undefined) return engineSingleton;
  if (!buildServices()) {
    engineSingleton = null;
    return null;
  }
  return engineSingleton ?? null;
}

export function getInitialMergeService(): InitialMergeService | null {
  getSyncEngine();
  return mergeServiceSingleton ?? null;
}

export function getConflictResolverService(): ConflictResolverService | null {
  getSyncEngine();
  return conflictServiceSingleton ?? null;
}

export function getSyncConflictStore(): CloudConflictStore | null {
  getSyncEngine();
  return conflicts;
}

export function getSyncQueue(): CloudSyncQueue | null {
  getSyncEngine();
  return queue;
}

export function getSyncMarkers(): CloudSyncMarkers | null {
  getSyncEngine();
  return markers;
}

/** Test hook — tear down the runtime singletons. */
export function resetSyncRuntimeForTests(): void {
  engineSingleton = undefined;
  enqueuerSingleton = null;
  mergeServiceSingleton = null;
  conflictServiceSingleton = null;
  queue = null;
  markers = null;
  conflicts = null;
  writer = null;
  applier = null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced sync after local changes (never on every keystroke). */
export function scheduleSyncSoon(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncNow();
  }, SYNC_CHANGE_DEBOUNCE_MS);
}

function currentUserId(): string | null {
  const auth = useAuthStore.getState();
  return auth.status === "signed-in" && auth.session ? auth.session.user.id : null;
}

/** Run a full sync for the current signed-in user (safe no-op when not). */
export async function syncNow(): Promise<void> {
  const store = useCloudSyncStore.getState();
  if (store.status === "syncing") return; // one sync at a time
  await performSync();
}

/**
 * The actual sync run (status-guard free). `syncNow` gates on the syncing
 * status; callers that already hold the "syncing" state (e.g. the initial
 * merge flow) must use this directly or the run would be skipped and the
 * status would stay "Syncing…" forever.
 */
async function performSync(): Promise<void> {
  const userId = currentUserId();
  const engine = getSyncEngine();
  if (!userId || !engine) return;
  const store = useCloudSyncStore.getState();
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    store.setStatus("offline");
    return;
  }
  store.setStatus("syncing");
  try {
    const report = await engine.run(userId);
    const conflictCount = await conflicts?.countOpen(userId) ?? 0;
    const pending = await queue?.countPending(userId) ?? 0;
    const now = new Date().toISOString();
    if (report.status === "offline") {
      store.setStatus("offline");
    } else if (report.status === "error") {
      store.setStatus("error");
      store.setError(report.error ?? null);
    } else if (conflictCount > 0) {
      store.setStatus("conflict");
      store.setConflictCount(conflictCount);
    } else {
      store.setStatus("synced");
      store.setLastSuccessfulSync(now);
      store.setError(null);
    }
    store.setPending(pending, 0);
    store.setConflictCount(conflictCount);
    store.bumpGeneration();
  } catch {
    store.setStatus("error");
  }
}

/** Resolve a conflict through the durable resolution service. */
export async function resolveConflict(
  conflictId: string,
  resolution: ConflictResolution,
): Promise<boolean> {
  const userId = currentUserId();
  const service = getConflictResolverService();
  if (!userId || !service) return false;
  try {
    await service.resolve(userId, conflictId, resolution);
    const openCount = await conflicts?.countOpen(userId) ?? 0;
    useCloudSyncStore.getState().setConflictCount(openCount);
    if (openCount === 0) useCloudSyncStore.getState().setStatus("synced");
    void syncNow();
    return true;
  } catch {
    return false;
  }
}

/** Execute the initial merge decision, then record it and sync. */
export async function runInitialMergeFlow(choice: InitialMergeChoice): Promise<void> {
  const userId = currentUserId();
  const mergeService = getInitialMergeService();
  if (!userId || !mergeService) return;
  const store = useCloudSyncStore.getState();
  store.setStatus("syncing");
  try {
    await mergeService.execute(userId, choice);
    await mergeService.recordDecision(userId, choice);
    store.closeInitialMerge();
    // Run the engine directly: syncNow() would early-return because the
    // status is already "syncing" (set above), leaving the UI stuck on
    // "Syncing…" forever.
    await performSync();
  } catch {
    store.setStatus("error");
  }
}

/**
 * Explicit, CONFIRMED action: remove this account's cloud copies from this
 * device (queue entries, markers, conflicts, cursors, cached shared data).
 * Local My Blocks are NEVER deleted by this action.
 */
export async function removeCloudDataFromDevice(userId: string): Promise<void> {
  const engine = getSyncEngine();
  engine?.cancel();
  await queue?.clearForUser(userId);
  await markers?.clearForUser(userId);
  await conflicts?.clearForUser(userId);
  // Clear per-user sync cursors + the initial-merge decision so a future
  // sign-in on this device re-runs the safe merge flow from scratch.
  const metadata = new SyncMetadataStore();
  await metadata.remove(`${METADATA_KEY_SYNC_CURSOR_PREFIX}${userId}`);
  await metadata.remove(`${METADATA_KEY_INITIAL_MERGE_PREFIX}${userId}`);
  const { clearCachedSharedDataForUser } = await import("@/features/shared-libraries/services/shared-library-cache");
  await clearCachedSharedDataForUser(userId);
}

// ---------------------------------------------------------------------------
// Provider wiring helpers (used by CloudSyncProvider)
// ---------------------------------------------------------------------------

export function wireMutationListener(): () => void {
  const engine = getSyncEngine();
  if (!engine || !enqueuerSingleton) return () => undefined;
  const adapter = getMyBlocksAdapter() as MyBlocksIndexedDbAdapter;
  const handleMutation = (event: MyBlockLocalMutationEvent) => {
    if (!event) return;
    const userId = currentUserId() ?? UNSIGNED_USER_ID;
    void enqueuerSingleton!.handleLocalMutation(event, userId);
  };
  adapter.setLocalMutationListener(handleMutation);
  return () => adapter.setLocalMutationListener(null);
}

export const SYNC_PERIODIC_INTERVAL = SYNC_PERIODIC_INTERVAL_MS;
