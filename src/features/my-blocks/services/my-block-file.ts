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
import { MY_BLOCK_MAX_FILE_SIZE_BYTES } from "../schemas/my-block-schema";
import {
  BuildoraBlockFileSchema,
  generateUniqueName,
  parseBuildoraBlockFile,
  type BuildoraBlockFile,
} from "../schemas/my-block-schema";
import { makeMyBlockError, toMyBlockError } from "../errors";
import type {
  CreateMyBlockInput,
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
