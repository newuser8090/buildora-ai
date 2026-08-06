// ---------------------------------------------------------------------------
// My Blocks Library (Phase P5) — browser singleton thumbnail service
//
// One shared service for the whole app. Tests inject their own storage
// adapters/services instead of touching this singleton.
// ---------------------------------------------------------------------------

import { MyBlockThumbnailIndexedDbAdapter } from "./my-block-thumbnail-storage";
import { MyBlockThumbnailService } from "./my-block-thumbnail-service";
import type { MyBlockThumbnailStorageAdapter } from "./my-block-thumbnail-types";
import type { MyBlockRecord } from "../types";
import { getMyBlocksAdapter } from "../storage/my-blocks-singleton";

let storageSingleton: MyBlockThumbnailStorageAdapter | null = null;
let serviceSingleton: MyBlockThumbnailService | null = null;

export function getMyBlockThumbnailStorage(): MyBlockThumbnailStorageAdapter {
  if (!storageSingleton) {
    storageSingleton = new MyBlockThumbnailIndexedDbAdapter();
  }
  return storageSingleton;
}

export function getMyBlockThumbnailService(): MyBlockThumbnailService {
  if (!serviceSingleton) {
    serviceSingleton = new MyBlockThumbnailService(getMyBlockThumbnailStorage());
  }
  return serviceSingleton;
}

/** Test hook: replace the storage singleton (e.g. with an in-memory adapter). */
export function setMyBlockThumbnailStorageForTests(
  adapter: MyBlockThumbnailStorageAdapter | null,
): void {
  storageSingleton = adapter;
  // A replacement adapter invalidates the cached service instance.
  serviceSingleton = null;
}

/**
 * Best-effort: ensure a thumbnail exists for a freshly saved record and attach
 * the metadata reference to the library record. Fire-and-forget from the UI;
 * failures are swallowed (the card falls back to a structural preview and
 * regeneration is retried lazily). Never blocks the save itself.
 */
export async function ensureThumbnailForSavedRecord(
  record: MyBlockRecord,
): Promise<void> {
  try {
    const service = getMyBlockThumbnailService();
    const result = await service.ensureForRecord(record);
    if (!result.ok) return;
    const thumb = result.value;
    await getMyBlocksAdapter().updateMyBlock(record.id, {
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
    // Best-effort only — never throw into the save/import flow.
  }
}
