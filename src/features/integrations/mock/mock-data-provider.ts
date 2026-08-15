// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J) — mock provider
//
// Local/dev/test parity for the Supabase provider. Records are in-memory
// only (never durable project data). When no record exists for a collection,
// a deterministic demo record is derived from the collection's field
// definitions so bindings resolve in previews/exports without any setup.
//
// Never throws; every method returns safe fallbacks.
// ---------------------------------------------------------------------------

import type { Collection, CollectionFieldType, CollectionRecord } from "@/features/elements/collections/types";
import type {
  DataIntegrationProvider,
  DataIntegrationScope,
  DataIntegrationStatus,
} from "../types";

// ---------------------------------------------------------------------------
// Deterministic demo record generation (pure)
// ---------------------------------------------------------------------------

function demoValueFor(fieldName: string, type: CollectionFieldType): unknown {
  switch (type) {
    case "number":
      return 42;
    case "boolean":
      return true;
    case "image":
      return `https://images.buildora.local/${slug(fieldName)}.jpg`;
    case "url":
      return `https://example.com/${slug(fieldName)}`;
    case "text":
    default:
      return `Sample ${fieldName}`;
  }
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "value";
}

/** Deterministic demo record derived from a collection's field definitions. */
export function buildDemoRecord(collection: Collection): CollectionRecord {
  const record: CollectionRecord = { id: `demo-${collection.id}` };
  for (const field of collection.fields) {
    record[field.name] = demoValueFor(field.name, field.type);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Field-name+type signature — demo records must re-derive when it changes. */
function fieldSignature(collection: Collection | undefined): string {
  if (!collection) return "";
  return collection.fields.map((f) => `${f.name}:${f.type}`).join("|");
}

export class MockDataProvider implements DataIntegrationProvider {
  readonly kind = "mock" as const;

  private records = new Map<string, CollectionRecord[]>();

  /** Field signature at the time each collection's demo record was derived. */
  private signatures = new Map<string, string>();

  /** Deterministic collections context used to seed demo records. */
  private collections: Collection[] = [];

  getStatus(): Promise<DataIntegrationStatus> {
    return Promise.resolve({
      kind: "mock",
      connected: true,
      label: "Demo data (mock)",
      detail: "Local demo backend — no external service required.",
    });
  }

  async listRecords(collectionId: string, _scope?: DataIntegrationScope): Promise<CollectionRecord[]> {
    const existing = this.records.get(collectionId);
    const collection = this.collections.find((c) => c.id === collectionId);
    const signature = fieldSignature(collection);

    if (existing && existing.length > 0) {
      // Demo records are a pure function of the field definitions, so a
      // signature change (field added/removed/renamed/re-typed) must refresh
      // them — otherwise a stale demo shadows the edit. User-created records
      // (non-demo ids) are always kept as-is.
      const demoOnly = existing.every((r) => String(r.id).startsWith("demo-"));
      if (demoOnly && collection && this.signatures.get(collectionId) !== signature) {
        const fresh = buildDemoRecord(collection);
        this.records.set(collectionId, [fresh]);
        this.signatures.set(collectionId, signature);
        return [cloneRecord(fresh)];
      }
      return cloneRecords(existing);
    }
    // Seed a deterministic demo record when the collection is known.
    if (!collection) return [];
    const demo = buildDemoRecord(collection);
    this.records.set(collectionId, [demo]);
    this.signatures.set(collectionId, signature);
    return [cloneRecord(demo)];
  }

  async saveRecord(
    collectionId: string,
    record: CollectionRecord,
    _scope?: DataIntegrationScope,
  ): Promise<CollectionRecord | null> {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const saved = cloneRecord({ ...record });
    const current = this.records.get(collectionId) ?? [];
    const index = current.findIndex((r) => r.id === saved.id);
    const next = [...current];
    if (index === -1) next.push(saved);
    else next[index] = saved;
    this.records.set(collectionId, next);
    return cloneRecord(saved);
  }

  async deleteRecord(collectionId: string, recordId: string, _scope?: DataIntegrationScope): Promise<boolean> {
    const current = this.records.get(collectionId);
    if (!current) return false;
    const next = current.filter((r) => r.id !== recordId);
    if (next.length === current.length) return false;
    this.records.set(collectionId, next);
    return true;
  }

  /** Test/dev hook: set the collections used to seed demo records. */
  setCollections(collections: Collection[]): void {
    this.collections = Array.isArray(collections) ? collections : [];
  }

  /** Test/dev hook: seed a demo record for every known collection. */
  seedDemoRecords(): void {
    for (const collection of this.collections) {
      const signature = fieldSignature(collection);
      const existing = this.records.get(collection.id);
      const demoOnly =
        !existing || existing.every((r) => String(r.id).startsWith("demo-"));
      if (!existing || this.signatures.get(collection.id) !== signature) {
        if (demoOnly || !existing) {
          this.records.set(collection.id, [buildDemoRecord(collection)]);
          this.signatures.set(collection.id, signature);
        }
      }
    }
  }

  /** Test hook: overwrite the in-memory records for one collection. */
  putRecordsForTests(collectionId: string, records: CollectionRecord[]): void {
    this.records.set(collectionId, cloneRecords(records));
  }

  clearForTests(): void {
    this.records.clear();
    this.signatures.clear();
    this.collections = [];
  }
}

function cloneRecord(record: CollectionRecord): CollectionRecord {
  return JSON.parse(JSON.stringify(record)) as CollectionRecord;
}

function cloneRecords(records: CollectionRecord[]): CollectionRecord[] {
  return records.map(cloneRecord);
}
