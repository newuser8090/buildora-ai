// ---------------------------------------------------------------------------
// Collections schema (Phase P22-J) — validation boundary for the durable
// collection model stored on the Project document.
//
// Security posture mirrors the rest of the P22 element schemas:
//   - names are length-capped
//   - field count and collection count are bounded
//   - field types are allow-listed (text | number | boolean | image | url)
//   - the schema is DATA ONLY — runtime records never enter the document
//
// Old projects without `collections` stay valid (the field is optional).
// Pure, deterministic, framework-independent.
// ---------------------------------------------------------------------------

import { z } from "zod";
import type { Collection } from "@/features/elements/collections/types";

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

export const COLLECTION_MAX_COLLECTIONS = 50;
export const COLLECTION_MAX_NAME_LENGTH = 80;
export const COLLECTION_MAX_FIELDS = 24;
export const COLLECTION_MAX_FIELD_NAME_LENGTH = 64;
export const COLLECTION_ID_MAX_LENGTH = 120;

export const COLLECTION_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "image",
  "url",
] as const;

export const CollectionFieldSchema = z.object({
  id: z.string().min(1).max(COLLECTION_ID_MAX_LENGTH),
  name: z.string().min(1).max(COLLECTION_MAX_FIELD_NAME_LENGTH),
  type: z.enum(COLLECTION_FIELD_TYPES),
});

export const CollectionSchema = z.object({
  id: z.string().min(1).max(COLLECTION_ID_MAX_LENGTH),
  name: z.string().min(1).max(COLLECTION_MAX_NAME_LENGTH),
  fields: z.array(CollectionFieldSchema).max(COLLECTION_MAX_FIELDS),
});

export const CollectionsSchema = z
  .array(CollectionSchema)
  .max(COLLECTION_MAX_COLLECTIONS);

export type ValidatedCollectionField = z.infer<typeof CollectionFieldSchema>;
export type ValidatedCollection = z.infer<typeof CollectionSchema>;

// ---------------------------------------------------------------------------
// Normalization / repair (persistence boundary)
// ---------------------------------------------------------------------------

/**
 * Repair an unknown value into a bounded array of VALID collections. Invalid
 * or malformed entries are dropped (never coerced) — the schema allow-list is
 * the only vocabulary the document accepts. Undefined/null stay undefined so
 * old projects without collections normalize unchanged.
 */
export function normalizeCollections(input: unknown): Collection[] | undefined {
  if (input === undefined || input === null) return undefined;
  if (!Array.isArray(input)) return undefined;
  const out: Collection[] = [];
  for (const item of input) {
    const parsed = CollectionSchema.safeParse(item);
    if (parsed.success) {
      out.push(parsed.data);
      if (out.length >= COLLECTION_MAX_COLLECTIONS) break;
    }
  }
  return out.length > 0 ? out : undefined;
}
