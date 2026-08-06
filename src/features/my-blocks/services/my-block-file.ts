// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — personal library transfer
//
// Export one My Block as `.buildora-block.json`; import one back.
//
// File format:
//   { "format": "buildora-block", "version": 1, "block": { name, description?,
//     category, tags, tree, sourceMetadata? } }
//
// Guarantees:
//   - no local record id preserved (import assigns a fresh library id)
//   - no timestamps carried over (import assigns fresh createdAt/updatedAt)
//   - duplicate-safe name on import
//   - schema validation + tree validation on every import
//   - unsupported version / oversized file rejected with user-safe errors
//   - never mixed with project export
// ---------------------------------------------------------------------------

import type { BlockTree } from "@/features/blocks/types";
import {
  MY_BLOCK_MAX_FILE_SIZE_BYTES,
  MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES,
  generateUniqueCollectionName,
  generateUniqueName,
  parseBuildoraBlocksFile,
  parseBuildoraBlockFile,
  BuildoraBlockFileSchema,
  BuildoraBlocksFileSchema,
  type BuildoraBlockFile,
  type BuildoraBlocksFile,
} from "../schemas/my-block-schema";
import { makeMyBlockError, toMyBlockError } from "../errors";
import type {
  CreateMyBlockInput,
  MyBlockCollection,
  MyBlockRecord,
  MyBlockResult,
  MyBlocksStorageAdapter,
} from "../types";

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build a transferable file payload from a record. Deliberately excludes the
 * local record id, timestamps, and usage metadata.
 */
export function buildBlockFile(record: MyBlockRecord): BuildoraBlockFile {
  return {
    format: "buildora-block",
    version: 1,
    block: {
      name: record.name,
      ...(record.description ? { description: record.description } : {}),
      category: record.category,
      tags: record.tags,
      tree: record.tree,
      ...(record.sourceMetadata ? { sourceMetadata: record.sourceMetadata } : {}),
    },
  };
}

/** Validate the schema of a built file (should always pass). */
export function validateBlockFile(file: BuildoraBlockFile): boolean {
  return BuildoraBlockFileSchema.safeParse(file).success;
}

// ---------------------------------------------------------------------------
// Parse (string payload)
// ---------------------------------------------------------------------------

export type ParseBlockFileResult =
  | { ok: true; file: BuildoraBlockFile }
  | { ok: false; message: string };

/** Parse a JSON string into a validated block file. Rejects oversized input. */
export function parseBlockFileJson(json: string): ParseBlockFileResult {
  if (json.length > MY_BLOCK_MAX_FILE_SIZE_BYTES * 2) {
    return {
      ok: false,
      message: "This block file is too large to import.",
    };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, message: "This file is not valid JSON." };
  }
  return parseBuildoraBlockFile(payload);
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Import a validated block file as a new library record. Fresh id +
 * timestamps, duplicate-safe name, independent deep-cloned tree.
 */
export async function importBlockFile(
  adapter: MyBlocksStorageAdapter,
  file: BuildoraBlockFile,
  existingNames: ReadonlyArray<string> = [],
): Promise<MyBlockResult<MyBlockRecord>> {
  try {
    const siblings = await adapter.listMyBlocks();
    const names =
      siblings.ok ? siblings.value.map((b) => b.name) : [...existingNames];

    const createInput: CreateMyBlockInput = {
      name: generateUniqueName(file.block.name, names),
      ...(file.block.description ? { description: file.block.description } : {}),
      category: file.block.category,
      tags: file.block.tags,
      tree: file.block.tree as BlockTree,
      sourceMetadata: {
        source: "imported" as const,
        ...(file.block.sourceMetadata ?? {}),
      },
    };
    return adapter.createMyBlock(createInput);
  } catch (err) {
    return { ok: false, error: toMyBlockError(err, "UNKNOWN_ERROR", "The block file could not be imported.") };
  }
}

/** Convenience: parse + import in one step with user-safe errors. */
export async function importBlockFileJson(
  adapter: MyBlocksStorageAdapter,
  json: string,
  existingNames: ReadonlyArray<string> = [],
): Promise<MyBlockResult<MyBlockRecord>> {
  const parsed = parseBlockFileJson(json);
  if (!parsed.ok) {
    return { ok: false, error: makeMyBlockError("INVALID_RECORD", parsed.message) };
  }
  return importBlockFile(adapter, parsed.file, existingNames);
}

// ---------------------------------------------------------------------------
// Bulk transfer (Phase P5) — .buildora-blocks.json
//
// One file, many blocks. Deterministic output ordering (name A–Z then
// category), no local record ids, no timestamps, no thumbnail blobs.
// ---------------------------------------------------------------------------

/**
 * Build a bulk file from records. Records are sorted deterministically
 * (name A–Z, then category, then id) so the same library always exports the
 * same file. Optional collection metadata references blocks by INDEX into
 * the sorted block list.
 */
export function buildBlocksFile(
  records: ReadonlyArray<MyBlockRecord>,
  collections: ReadonlyArray<MyBlockCollection> = [],
): BuildoraBlocksFile {
  const sorted = [...records].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.category.localeCompare(b.category) ||
      a.id.localeCompare(b.id),
  );
  const indexById = new Map(sorted.map((r, i) => [r.id, i]));

  const fileCollections =
    collections.length > 0
      ? collections
          .map((c) => {
            const blockIndexes: number[] = [];
            for (const record of records) {
              if (record.collectionIds?.includes(c.id)) {
                const index = indexById.get(record.id);
                if (index !== undefined) blockIndexes.push(index);
              }
            }
            return { name: c.name, blockIndexes };
          })
          .filter((c) => c.blockIndexes.length > 0)
      : [];

  return {
    format: "buildora-blocks",
    version: 1,
    exportedAt: new Date().toISOString(),
    blocks: sorted.map((record) => ({
      name: record.name,
      ...(record.description ? { description: record.description } : {}),
      category: record.category,
      tags: record.tags,
      tree: record.tree,
      ...(record.sourceMetadata ? { sourceMetadata: record.sourceMetadata } : {}),
    })),
    ...(fileCollections.length > 0 ? { collections: fileCollections } : {}),
  };
}

/** Validate the schema of a built bulk file (should always pass). */
export function validateBlocksFile(file: BuildoraBlocksFile): boolean {
  return BuildoraBlocksFileSchema.safeParse(file).success;
}

/** Parse a JSON string into a validated bulk file. Rejects oversized input. */
export function parseBlocksFileJson(
  json: string,
): { ok: true; file: BuildoraBlocksFile } | { ok: false; message: string } {
  if (json.length > MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES * 2) {
    return { ok: false, message: "This blocks file is too large to import." };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, message: "This file is not valid JSON." };
  }
  if (
    payload &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>).format === "buildora-blocks"
  ) {
    return parseBuildoraBlocksFile(payload);
  }
  // A single-block file also imports through the bulk flow as one item.
  const single = parseBuildoraBlockFile(payload);
  if (single.ok) {
    return {
      ok: true,
      file: {
        format: "buildora-blocks",
        version: 1,
        exportedAt: new Date().toISOString(),
        blocks: [single.file.block],
      },
    };
  }
  return { ok: false, message: single.message };
}

// ---------------------------------------------------------------------------
// Bulk import
// ---------------------------------------------------------------------------

export interface BulkImportItemResult {
  /** Index into the file's blocks array. */
  index: number;
  originalName: string;
  outcome: "imported" | "renamed" | "failed";
  recordId?: string;
  finalName?: string;
  error?: string;
}

export interface BulkImportSummary {
  imported: number;
  renamed: number;
  failed: number;
  /** Block file entries the user chose to skip (not attempted). */
  skipped: number;
  records: MyBlockRecord[];
  results: BulkImportItemResult[];
  /** Collections recreated from the file's collection metadata. */
  collectionsCreated: number;
  /** Collections (or membership patches) that failed — blocks still imported. */
  collectionsFailed: number;
}

export interface ImportBlocksFileOptions {
  /** Import only these block indexes (default: all). */
  selectedIndexes?: ReadonlyArray<number>;
  /** Create collections from the file's collection metadata. */
  includeCollections?: boolean;
}

/**
 * Import a bulk file. Every block is validated independently; valid records
 * are imported even when others fail (no silent failures — per-item results).
 * Fresh record ids + timestamps, duplicate-safe names (marked "renamed"),
 * independent deep-cloned trees.
 */
export async function importBlocksFile(
  adapter: MyBlocksStorageAdapter,
  file: BuildoraBlocksFile,
  options: ImportBlocksFileOptions = {},
): Promise<MyBlockResult<BulkImportSummary>> {
  try {
    const siblings = await adapter.listMyBlocks();
    if (!siblings.ok) return siblings;
    const taken = new Set(siblings.value.map((b) => b.name.toLowerCase()));

    const selected =
      options.selectedIndexes && options.selectedIndexes.length > 0
        ? new Set(options.selectedIndexes)
        : null;

    const results: BulkImportItemResult[] = [];
    const records: MyBlockRecord[] = [];
    const idByIndex = new Map<number, string>();

    for (let index = 0; index < file.blocks.length; index += 1) {
      // Skipped entries are not attempted and not reported per-item — they
      // are counted at the end as `skipped`.
      if (selected && !selected.has(index)) {
        continue;
      }
      const block = file.blocks[index];
      const uniqueName = generateUniqueName(block.name, [...taken]);
      taken.add(uniqueName.toLowerCase());

      const createInput: CreateMyBlockInput = {
        name: uniqueName,
        ...(block.description ? { description: block.description } : {}),
        category: block.category,
        tags: block.tags,
        tree: block.tree as BlockTree,
        sourceMetadata: {
          source: "imported" as const,
          ...(block.sourceMetadata ?? {}),
        },
      };
      const created = await adapter.createMyBlock(createInput);
      if (created.ok) {
        records.push(created.value);
        idByIndex.set(index, created.value.id);
        results.push({
          index,
          originalName: block.name,
          outcome: uniqueName.toLowerCase() === block.name.toLowerCase() ? "imported" : "renamed",
          recordId: created.value.id,
          finalName: created.value.name,
        });
      } else {
        results.push({
          index,
          originalName: block.name,
          outcome: "failed",
          error: created.error.message,
        });
      }
    }

    // Optional collection reconstruction (fresh ids + duplicate-safe names).
    // Failures here are reported (never silent) — the imported blocks are
    // safe either way.
    let collectionsCreated = 0;
    let collectionsFailed = 0;
    if (options.includeCollections !== false && file.collections?.length) {
      const restored = await reconstructCollections(adapter, file, idByIndex, records);
      collectionsCreated = restored.created;
      collectionsFailed = restored.failed;
    }

    const summary: BulkImportSummary = {
      imported: results.filter((r) => r.outcome === "imported").length,
      renamed: results.filter((r) => r.outcome === "renamed").length,
      failed: results.filter((r) => r.outcome === "failed").length,
      skipped: file.blocks.length - results.length,
      records,
      results,
      collectionsCreated,
      collectionsFailed,
    };
    return { ok: true, value: summary };
  } catch (err) {
    return {
      ok: false,
      error: toMyBlockError(err, "UNKNOWN_ERROR", "The blocks file could not be imported."),
    };
  }
}

/**
 * Create the file's collections and attach imported block ids to them.
 * Returns how many collections were restored vs. failed so the import
 * summary can report partial collection outcomes (blocks are safe either
 * way — collections are best-effort metadata).
 */
async function reconstructCollections(
  adapter: MyBlocksStorageAdapter,
  file: BuildoraBlocksFile,
  idByIndex: Map<number, string>,
  importedRecords: MyBlockRecord[],
): Promise<{ created: number; failed: number }> {
  const existing = await adapter.listMyBlockCollections();
  const takenNames = existing.ok
    ? existing.value.map((c) => c.name)
    : [];
  const taken = new Set(takenNames.map((n) => n.toLowerCase()));
  let created = 0;
  let failed = 0;

  for (const fileCollection of file.collections ?? []) {
    const ids: string[] = [];
    for (const index of fileCollection.blockIndexes) {
      const recordId = idByIndex.get(index);
      if (recordId) ids.push(recordId);
    }
    if (ids.length === 0) continue;

    const collectionName = generateUniqueCollectionName(fileCollection.name, [...taken]);
    taken.add(collectionName.toLowerCase());

    const createdCollection = await adapter.createMyBlockCollection({
      name: collectionName,
    });
    if (!createdCollection.ok) {
      failed += 1;
      continue;
    }
    created += 1;

    // Attach membership to the imported records (fresh patches).
    for (const record of importedRecords) {
      if (ids.includes(record.id)) {
        const merged = [
          ...new Set([...(record.collectionIds ?? []), createdCollection.value.id]),
        ];
        const updated = await adapter.updateMyBlock(record.id, { collectionIds: merged });
        if (!updated.ok) failed += 1;
      }
    }
  }
  return { created, failed };
}

/** Approximate total JSON bytes of the blocks in a bulk file (preflight). */
export function estimateBulkFileBytes(file: BuildoraBlocksFile): number {
  try {
    return new Blob([JSON.stringify(file)]).size;
  } catch {
    return JSON.stringify(file).length * 2;
  }
}
