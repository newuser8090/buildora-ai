// ---------------------------------------------------------------------------
// Collection structure helpers (Phase P22-J) — pure, immutable list mutations
//
// The editor store folds these into the Project document through withHistory
// (one atomic history entry per action; undo/redo + collab come free). No
// store or provider imports — deterministic and testable in isolation.
// ---------------------------------------------------------------------------

import type { Collection, CollectionField, CollectionFieldType } from "@/features/elements/collections/types";
import {
  COLLECTION_MAX_COLLECTIONS,
  COLLECTION_MAX_FIELDS,
  COLLECTION_MAX_FIELD_NAME_LENGTH,
  COLLECTION_MAX_NAME_LENGTH,
  CollectionFieldSchema,
  CollectionsSchema,
} from "@/features/elements/schemas/collection-schema";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type CollectionStructureErrorCode =
  | "COLLECTION_NOT_FOUND"
  | "COLLECTION_NAME_INVALID"
  | "COLLECTION_LIMIT"
  | "COLLECTION_FIELD_NOT_FOUND"
  | "COLLECTION_FIELD_NAME_INVALID"
  | "COLLECTION_FIELD_LIMIT"
  | "COLLECTION_FIELD_TYPE_INVALID";

export interface CollectionStructureError {
  code: CollectionStructureErrorCode;
  message: string;
}

export type CollectionStructureResult<T> =
  | { ok: true; value: T; changed: boolean }
  | { ok: false; error: CollectionStructureError };

// ---------------------------------------------------------------------------
// Id factories (deterministic per-session; runtime-created, never durable ids
// from a new system — D-J3)
// ---------------------------------------------------------------------------

let collectionCounter = 0;
let fieldCounter = 0;

export function createCollectionId(name: string): string {
  collectionCounter += 1;
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `col-${slug || "collection"}-${Date.now().toString(36)}-${collectionCounter}`;
}

export function createCollectionFieldId(collectionId: string): string {
  fieldCounter += 1;
  return `${collectionId}-f-${Date.now().toString(36)}-${fieldCounter}`;
}

// ---------------------------------------------------------------------------
// Name helpers
// ---------------------------------------------------------------------------

function sanitizeCollectionName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > COLLECTION_MAX_NAME_LENGTH) return null;
  return trimmed;
}

function sanitizeFieldName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > COLLECTION_MAX_FIELD_NAME_LENGTH) return null;
  return trimmed;
}

function validateCollections(collections: Collection[]): boolean {
  return CollectionsSchema.safeParse(collections).success;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function addCollectionToList(
  collections: Collection[] | undefined,
  name: unknown,
  fields: CollectionField[] = [],
): CollectionStructureResult<Collection[]> {
  const trimmed = sanitizeCollectionName(name);
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "COLLECTION_NAME_INVALID", message: "Collection names must be 1–80 characters." },
    };
  }
  const current = Array.isArray(collections) ? collections : [];
  if (current.length >= COLLECTION_MAX_COLLECTIONS) {
    return {
      ok: false,
      error: { code: "COLLECTION_LIMIT", message: `Projects can hold at most ${COLLECTION_MAX_COLLECTIONS} collections.` },
    };
  }
  const id = createCollectionId(trimmed);
  const candidate: Collection = { id, name: trimmed, fields: [] };
  for (const field of fields) {
    const parsed = CollectionFieldSchema.safeParse(field);
    if (!parsed.success) continue;
    candidate.fields.push(parsed.data);
  }
  if (candidate.fields.length > COLLECTION_MAX_FIELDS) candidate.fields = candidate.fields.slice(0, COLLECTION_MAX_FIELDS);
  const next = [...current, candidate];
  if (!validateCollections(next)) {
    return { ok: false, error: { code: "COLLECTION_FIELD_TYPE_INVALID", message: "The collection failed validation." } };
  }
  return { ok: true, value: next, changed: true };
}

export function renameCollectionInList(
  collections: Collection[] | undefined,
  collectionId: string,
  name: unknown,
): CollectionStructureResult<Collection[]> {
  const current = Array.isArray(collections) ? collections : [];
  const index = current.findIndex((c) => c.id === collectionId);
  if (index === -1) {
    return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
  }
  const trimmed = sanitizeCollectionName(name);
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "COLLECTION_NAME_INVALID", message: "Collection names must be 1–80 characters." },
    };
  }
  if (current[index].name === trimmed) return { ok: true, value: current, changed: false };
  const next = [...current];
  next[index] = { ...next[index], name: trimmed };
  return { ok: true, value: next, changed: true };
}

export function deleteCollectionFromList(
  collections: Collection[] | undefined,
  collectionId: string,
): CollectionStructureResult<Collection[]> {
  const current = Array.isArray(collections) ? collections : [];
  const next = current.filter((c) => c.id !== collectionId);
  if (next.length === current.length) {
    return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
  }
  return { ok: true, value: next, changed: true };
}

export function addFieldToList(
  collections: Collection[] | undefined,
  collectionId: string,
  fieldName: unknown,
  fieldType: CollectionFieldType,
): CollectionStructureResult<Collection[]> {
  const current = Array.isArray(collections) ? collections : [];
  const index = current.findIndex((c) => c.id === collectionId);
  if (index === -1) {
    return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
  }
  const trimmed = sanitizeFieldName(fieldName);
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "COLLECTION_FIELD_NAME_INVALID", message: "Field names must be 1–64 characters." },
    };
  }
  if (!CollectionFieldSchema.shape.type.safeParse(fieldType).success) {
    return {
      ok: false,
      error: { code: "COLLECTION_FIELD_TYPE_INVALID", message: `Unsupported field type "${String(fieldType)}".` },
    };
  }
  const collection = current[index];
  if (collection.fields.length >= COLLECTION_MAX_FIELDS) {
    return {
      ok: false,
      error: { code: "COLLECTION_FIELD_LIMIT", message: `Collections can hold at most ${COLLECTION_MAX_FIELDS} fields.` },
    };
  }
  const field: CollectionField = {
    id: createCollectionFieldId(collection.id),
    name: trimmed,
    type: fieldType,
  };
  const next = [...current];
  next[index] = { ...collection, fields: [...collection.fields, field] };
  return { ok: true, value: next, changed: true };
}

export function removeFieldFromList(
  collections: Collection[] | undefined,
  collectionId: string,
  fieldId: string,
): CollectionStructureResult<Collection[]> {
  const current = Array.isArray(collections) ? collections : [];
  const index = current.findIndex((c) => c.id === collectionId);
  if (index === -1) {
    return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
  }
  const collection = current[index];
  if (!collection.fields.some((f) => f.id === fieldId)) {
    return { ok: false, error: { code: "COLLECTION_FIELD_NOT_FOUND", message: "That field no longer exists." } };
  }
  const next = [...current];
  next[index] = { ...collection, fields: collection.fields.filter((f) => f.id !== fieldId) };
  return { ok: true, value: next, changed: true };
}

export function renameFieldInList(
  collections: Collection[] | undefined,
  collectionId: string,
  fieldId: string,
  name: unknown,
): CollectionStructureResult<Collection[]> {
  const current = Array.isArray(collections) ? collections : [];
  const index = current.findIndex((c) => c.id === collectionId);
  if (index === -1) {
    return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
  }
  const trimmed = sanitizeFieldName(name);
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "COLLECTION_FIELD_NAME_INVALID", message: "Field names must be 1–64 characters." },
    };
  }
  const collection = current[index];
  const fieldIndex = collection.fields.findIndex((f) => f.id === fieldId);
  if (fieldIndex === -1) {
    return { ok: false, error: { code: "COLLECTION_FIELD_NOT_FOUND", message: "That field no longer exists." } };
  }
  if (collection.fields[fieldIndex].name === trimmed) return { ok: true, value: current, changed: false };
  const fields = [...collection.fields];
  fields[fieldIndex] = { ...fields[fieldIndex], name: trimmed };
  const next = [...current];
  next[index] = { ...collection, fields };
  return { ok: true, value: next, changed: true };
}

export function setFieldTypeInList(
  collections: Collection[] | undefined,
  collectionId: string,
  fieldId: string,
  fieldType: CollectionFieldType,
): CollectionStructureResult<Collection[]> {
  const current = Array.isArray(collections) ? collections : [];
  const index = current.findIndex((c) => c.id === collectionId);
  if (index === -1) {
    return { ok: false, error: { code: "COLLECTION_NOT_FOUND", message: "That collection no longer exists." } };
  }
  if (!CollectionFieldSchema.shape.type.safeParse(fieldType).success) {
    return {
      ok: false,
      error: { code: "COLLECTION_FIELD_TYPE_INVALID", message: `Unsupported field type "${String(fieldType)}".` },
    };
  }
  const collection = current[index];
  const fieldIndex = collection.fields.findIndex((f) => f.id === fieldId);
  if (fieldIndex === -1) {
    return { ok: false, error: { code: "COLLECTION_FIELD_NOT_FOUND", message: "That field no longer exists." } };
  }
  if (collection.fields[fieldIndex].type === fieldType) return { ok: true, value: current, changed: false };
  const fields = [...collection.fields];
  fields[fieldIndex] = { ...fields[fieldIndex], type: fieldType };
  const next = [...current];
  next[index] = { ...collection, fields };
  return { ok: true, value: next, changed: true };
}
