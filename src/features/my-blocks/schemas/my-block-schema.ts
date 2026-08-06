// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — Zod schema + validation
//
// Reuses the Phase P3 custom-block schema for the BlockTree (node/depth/text/
// style caps, dangerous-key rejection, structural tree validation). Adds
// record-level limits: name/description length, tag count, category enum,
// timestamps, version.
//
// Malformed records are rejected with deterministic, user-safe messages —
// never silently accepted with executable content.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { CustomBlockTreeSchema } from "@/features/code-import/schemas/custom-block-schema";
import {
  isMyBlockCategory,
  type MyBlockCategory,
} from "../types";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Maximum record schema version we can read. */
export const MY_BLOCK_CURRENT_VERSION = 1;

/** Maximum saved block name length. */
export const MY_BLOCK_MAX_NAME_LENGTH = 80;

/** Maximum saved block description length. */
export const MY_BLOCK_MAX_DESCRIPTION_LENGTH = 280;

/** Maximum number of tags on a saved block. */
export const MY_BLOCK_MAX_TAGS = 8;

/** Maximum length of a single tag. */
export const MY_BLOCK_MAX_TAG_LENGTH = 24;

/** Maximum individual record size (bytes, JSON serialized). */
export const MY_BLOCK_MAX_RECORD_SIZE_BYTES = 512 * 1024;

/** Sensible total recommended library size (bytes). */
export const MY_BLOCK_RECOMMENDED_LIBRARY_SIZE_BYTES = 8 * 1024 * 1024;

/** .buildora-block.json file size limit (bytes). */
export const MY_BLOCK_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

/** Supported block-file format version. */
export const MY_BLOCK_FILE_FORMAT_VERSION = 1;

/** Id / timestamp string length caps (defensive). */
const ID_MAX = 120;
const DATE_MAX = 64;

// ---------------------------------------------------------------------------
// Category + source enums
// ---------------------------------------------------------------------------

const categorySchema = z.custom<MyBlockCategory>((value) => isMyBlockCategory(value), {
  message: "Unknown block category.",
});

const sourceSchema = z.enum(["imported", "created", "duplicated"]);

// ---------------------------------------------------------------------------
// Metadata schemas
// ---------------------------------------------------------------------------

const sourceMetadataSchema = z
  .object({
    source: sourceSchema,
    language: z
      .enum(["html", "jsx", "tsx", "react", "css", "unknown"])
      .optional(),
    originalWarningCount: z.number().int().nonnegative().optional(),
    converterVersion: z.number().int().positive().optional(),
  })
  .strict();

const previewMetadataSchema = z
  .object({
    blockCount: z.number().int().positive(),
    rootType: z.string().min(1).max(120),
    containsMedia: z.boolean(),
    containsInteractive: z.boolean(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Record schema
// ---------------------------------------------------------------------------

export const MyBlockRecordSchema = z
  .object({
    id: z.string().min(1).max(ID_MAX),
    // Records from a future schema version are rejected on read — they cannot
    // be trusted to parse with this version's invariants.
    version: z.number().int().positive().max(MY_BLOCK_CURRENT_VERSION),
    name: z.string().trim().min(1).max(MY_BLOCK_MAX_NAME_LENGTH),
    description: z.string().max(MY_BLOCK_MAX_DESCRIPTION_LENGTH).optional(),
    category: categorySchema,
    tags: z
      .array(z.string().trim().min(1).max(MY_BLOCK_MAX_TAG_LENGTH))
      .max(MY_BLOCK_MAX_TAGS)
      .default([]),
    tree: CustomBlockTreeSchema,
    createdAt: z.string().min(1).max(DATE_MAX),
    updatedAt: z.string().min(1).max(DATE_MAX),
    sourceMetadata: sourceMetadataSchema.optional(),
    previewMetadata: previewMetadataSchema,
    lastUsedAt: z.string().min(1).max(DATE_MAX).optional(),
    useCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ValidatedMyBlockRecord = z.infer<typeof MyBlockRecordSchema>;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Parse + validate a record. Rejects malformed records deterministically. */
export function parseMyBlockRecord(value: unknown): ValidatedMyBlockRecord | null {
  if (value === null || typeof value !== "object") return null;
  const result = MyBlockRecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** True when a record is structurally valid (id + tree usable). */
export function isUsableMyBlockRecord(value: unknown): value is ValidatedMyBlockRecord {
  const parsed = parseMyBlockRecord(value);
  if (!parsed) return false;
  return parsed.tree.rootIds.length > 0;
}

// ---------------------------------------------------------------------------
// File format (export/import)
// ---------------------------------------------------------------------------

export const BuildoraBlockFileSchema = z
  .object({
    format: z.literal("buildora-block"),
    version: z.literal(MY_BLOCK_FILE_FORMAT_VERSION),
    block: z.object({
      name: z.string().trim().min(1).max(MY_BLOCK_MAX_NAME_LENGTH),
      description: z.string().max(MY_BLOCK_MAX_DESCRIPTION_LENGTH).optional(),
      category: categorySchema,
      tags: z
        .array(z.string().trim().min(1).max(MY_BLOCK_MAX_TAG_LENGTH))
        .max(MY_BLOCK_MAX_TAGS)
        .default([]),
      tree: CustomBlockTreeSchema,
      sourceMetadata: sourceMetadataSchema.optional(),
    }),
  })
  .strict();

export type BuildoraBlockFile = z.infer<typeof BuildoraBlockFileSchema>;

/** Parse a block file payload. Returns a human message on failure. */
export function parseBuildoraBlockFile(
  value: unknown,
): { ok: true; file: BuildoraBlockFile } | { ok: false; message: string } {
  if (value === null || typeof value !== "object") {
    return { ok: false, message: "This file does not contain a saved block." };
  }
  const raw = value as Record<string, unknown>;
  if (raw.format !== "buildora-block") {
    return { ok: false, message: "This is not a Buildora block file." };
  }
  if (raw.version !== MY_BLOCK_FILE_FORMAT_VERSION) {
    return {
      ok: false,
      message: `This block file uses an unsupported version (${String(raw.version)}). Please export it again from a newer Buildora.`,
    };
  }
  const result = BuildoraBlockFileSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue ? issue.path.join(".") : "";
    const detail = issue ? issue.message : "The file is not a valid saved block.";
    return {
      ok: false,
      message: path ? `Invalid block file (${path}): ${detail}` : `Invalid block file: ${detail}`,
    };
  }
  return { ok: true, file: result.data };
}

// ---------------------------------------------------------------------------
// Normalization (deterministic, never throws, never mutates input)
// ---------------------------------------------------------------------------

/** Sanitize a name for storage: trim + cap. Empty → null. */
export function sanitizeMyBlockName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MY_BLOCK_MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

/** Sanitize a description for storage: trim + cap. Empty → undefined. */
export function sanitizeMyBlockDescription(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, MY_BLOCK_MAX_DESCRIPTION_LENGTH);
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Sanitize a tag list: trim, dedupe (case-insensitive), cap count/length. */
export function sanitizeMyBlockTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().slice(0, MY_BLOCK_MAX_TAG_LENGTH);
    if (tag.length === 0) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MY_BLOCK_MAX_TAGS) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Duplicate-safe names
// ---------------------------------------------------------------------------

/**
 * Generate a unique name given existing names. "Hero" → "Hero 2", "Hero 3", …
 * Deterministic. Existing names are compared case-insensitively.
 */
export function generateUniqueName(
  base: string,
  existingNames: ReadonlyArray<string>,
): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const clean = sanitizeMyBlockName(base) ?? "Saved block";
  if (!taken.has(clean.toLowerCase())) return clean;
  let n = 2;
  let candidate = `${clean} ${n}`;
  while (taken.has(candidate.toLowerCase())) {
    n += 1;
    candidate = `${clean} ${n}`;
  }
  return candidate;
}
