// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — copySharedBlockToMyBlocks
//
// Copy a block from a shared library into the user's personal My Blocks.
// Guarantees:
//   - access is verified server-side (fetchSharedBlock enforces membership)
//   - the fetched payload is schema-validated before use
//   - the copy receives a FRESH personal My Block id
//   - duplicate-safe naming ("Hero" → "Hero 2")
//   - provenance marked source: "shared" (safe metadata only — no raw source)
//   - saved through the canonical local adapter (which enqueues the personal
//     cloud upload), so the copy becomes an INDEPENDENT record
//   - thumbnail regenerated locally (best-effort)
//   - structured errors; later owner edits never mutate this copy
// ---------------------------------------------------------------------------

import type { CloudLibraryProvider } from "@/features/cloud-sync/providers/cloud-library-provider";
import {
  parseCloudMyBlockPayload,
} from "@/features/cloud-sync/serialization/cloud-serializer";
import { makeCloudSyncError, toCloudSyncError } from "@/features/cloud-sync/errors";
import type { MyBlockRecord, MyBlocksStorageAdapter } from "@/features/my-blocks/types";
import { generateUniqueName } from "@/features/my-blocks/schemas/my-block-schema";
import { ensureThumbnailForSavedRecord } from "@/features/my-blocks/thumbnails/my-block-thumbnail-singleton";
import type { CloudSyncError } from "@/features/cloud-sync/types";

export type CopySharedBlockResult =
  | { ok: true; value: MyBlockRecord }
  | { ok: false; error: CloudSyncError };

export interface CopySharedBlockDeps {
  provider: CloudLibraryProvider;
  adapter: MyBlocksStorageAdapter;
  /** Injectable thumbnail ensurer (best-effort; default ensures locally). */
  ensureThumbnail?: (record: MyBlockRecord) => Promise<void>;
}

/**
 * Copy a shared block into the user's personal library as an independent
 * record with fresh ids.
 */
export async function copySharedBlockToMyBlocks(
  deps: CopySharedBlockDeps,
  libraryId: string,
  blockId: string,
): Promise<CopySharedBlockResult> {
  try {
    // 1. Server-verified access + validated payload.
    const payload = await deps.provider.fetchSharedBlock(libraryId, blockId);
    const parsed = parseCloudMyBlockPayload(payload);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const source = parsed.value;

    // 2. Duplicate-safe name.
    const namesResult = await deps.adapter.listMyBlocks();
    const existingNames = namesResult.ok
      ? namesResult.value.map((b) => b.name)
      : [];
    const name = generateUniqueName(source.name, existingNames);

    // 3. Fresh personal record through the canonical adapter. The adapter
    //    validates the tree, assigns a fresh id, and (via the sync change
    //    listener) enqueues the personal cloud upload.
    const createResult = await deps.adapter.createMyBlock({
      name,
      ...(source.description ? { description: source.description } : {}),
      category: source.category,
      tags: source.tags,
      tree: source.tree,
      sourceMetadata: {
        source: "shared",
        ...(source.sourceMetadata
          ? {
              language: source.sourceMetadata.language,
              converterVersion: source.sourceMetadata.converterVersion,
            }
          : {}),
      },
    });
    if (!createResult.ok) {
      return {
        ok: false,
        error: makeCloudSyncError(
          createResult.error.code === "QUOTA_EXCEEDED" ? "STORAGE_QUOTA" : "UNKNOWN",
          createResult.error.message,
        ),
      };
    }

    // 4. Regenerate the thumbnail locally (best-effort, never blocking).
    const ensureThumbnail = deps.ensureThumbnail ?? ensureThumbnailForSavedRecord;
    await ensureThumbnail(createResult.value).catch(() => undefined);

    return { ok: true, value: createResult.value };
  } catch (err) {
    return { ok: false, error: toCloudSyncError(err) };
  }
}
