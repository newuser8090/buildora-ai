// ---------------------------------------------------------------------------
// Collections (Phase P22-J) — durable collection definitions
//
// A Collection is a durable, schema-validated DEFINITION living in the
// Project document: { id, name, fields }. Runtime records are NOT durable
// project data — they belong to the integration/provider layer (mock for
// local/tests, Supabase for cloud) and are injected at render/export time
// through the binding resolver.
//
// Pure model: no React, no DOM, no store, no provider imports.
// ---------------------------------------------------------------------------

export type CollectionFieldType = "text" | "number" | "boolean" | "image" | "url";

export interface CollectionField {
  id: string;
  name: string;
  type: CollectionFieldType;
}

export interface Collection {
  id: string;
  name: string;
  fields: CollectionField[];
}

/** A single runtime record for a collection (inert data, JSON-safe). */
export type CollectionRecord = Record<string, unknown>;

/** Runtime records keyed by collectionId (provider-layer data). */
export type CollectionRecords = Record<string, CollectionRecord[]>;
