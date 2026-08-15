// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J) — provider abstraction
//
// Mirrors the cloud-sync provider split: a single interface, two real
// implementations (mock for local dev/tests, Supabase for cloud), and a
// factory resolved from the environment. Secrets stay server-side; the
// browser client only ever uses the anon key (RLS gates access).
//
// Runtime RECORDS are provider-layer data (D-J1): the durable Project only
// stores collection DEFINITIONS. The provider supplies the runtime records
// the binding resolver + static export snapshot consume.
//
// Framework-independent: no React, no DOM, no store.
// ---------------------------------------------------------------------------

import type { CollectionRecord } from "@/features/elements/collections/types";

export type DataIntegrationKind = "none" | "mock" | "supabase";

export interface DataIntegrationStatus {
  kind: DataIntegrationKind;
  /** True when the provider is connected and usable. */
  connected: boolean;
  /** Short user-facing label ("Demo data", "Supabase"). */
  label: string;
  /** Guidance when not connected (e.g. missing env vars). */
  detail?: string;
}

/** Project context for provider calls (workspace-scoped cloud records). */
export interface DataIntegrationScope {
  projectId?: string;
  /** Null = personal project (owner-scoped); a uuid = workspace project. */
  workspaceId?: string | null;
}

export interface DataIntegrationProvider {
  readonly kind: "mock" | "supabase";
  /** Connection/status check — never throws. */
  getStatus(): Promise<DataIntegrationStatus>;
  /** Runtime records for one collection — never throws (empty on failure). */
  listRecords(collectionId: string, scope?: DataIntegrationScope): Promise<CollectionRecord[]>;
  /** Upsert one runtime record — returns null on failure (never throws). */
  saveRecord(collectionId: string, record: CollectionRecord, scope?: DataIntegrationScope): Promise<CollectionRecord | null>;
  /** Delete one runtime record — false on failure (never throws). */
  deleteRecord(collectionId: string, recordId: string, scope?: DataIntegrationScope): Promise<boolean>;
}
