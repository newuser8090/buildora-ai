// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J) — Supabase provider
//
// Cloud implementation of the DataIntegrationProvider contract. Runtime
// records live in the additive `data_records` table (see
// supabase/migrations/<next>_data_records.sql) behind RLS + SECURITY
// DEFINER RPCs:
//   - workspace projects → records scoped by workspace membership
//     (ws_is_member / ws_role, the P14/P16 authorization helpers)
//   - personal projects → records scoped by owner (auth.uid())
//
// The browser only ever holds the anon key (getSupabaseClient convention);
// service-role keys stay server-side. Every method is safe-fallback and
// never throws.
//
// NOTE: the minimal P22-J scope uses the provider for runtime records only —
// collection DEFINITIONS remain durable Project data (D-J1).
// ---------------------------------------------------------------------------

import type { CollectionRecord } from "@/features/elements/collections/types";
import { getSupabaseClient } from "@/features/auth/supabase-client";
import type {
  DataIntegrationProvider,
  DataIntegrationScope,
  DataIntegrationStatus,
} from "../types";

interface RecordRow {
  id: string;
  record: unknown;
}

export class SupabaseDataProvider implements DataIntegrationProvider {
  readonly kind = "supabase" as const;

  async getStatus(): Promise<DataIntegrationStatus> {
    const client = getSupabaseClient();
    if (!client) {
      return {
        kind: "supabase",
        connected: false,
        label: "Supabase",
        detail: "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to connect.",
      };
    }
    return {
      kind: "supabase",
      connected: true,
      label: "Supabase",
      detail: "Runtime records are stored in your Supabase project.",
    };
  }

  async listRecords(
    collectionId: string,
    scope?: DataIntegrationScope,
  ): Promise<CollectionRecord[]> {
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client.rpc("data_list_records", {
      p_workspace_id: scope?.workspaceId ?? null,
      p_project_id: scope?.projectId ?? "",
      p_collection_id: collectionId,
    });
    if (error || !Array.isArray(data)) return [];
    return (data as RecordRow[])
      .map((row) => row.record)
      .filter((r): r is CollectionRecord => !!r && typeof r === "object" && !Array.isArray(r));
  }

  async saveRecord(
    collectionId: string,
    record: CollectionRecord,
    scope?: DataIntegrationScope,
  ): Promise<CollectionRecord | null> {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.rpc("data_save_record", {
      p_workspace_id: scope?.workspaceId ?? null,
      p_project_id: scope?.projectId ?? "",
      p_collection_id: collectionId,
      p_record: JSON.parse(JSON.stringify(record)) as Record<string, unknown>,
    });
    if (error || !data) return null;
    const row = data as RecordRow | null;
    return row && row.record && typeof row.record === "object" && !Array.isArray(row.record)
      ? (row.record as CollectionRecord)
      : null;
  }

  async deleteRecord(
    collectionId: string,
    recordId: string,
    scope?: DataIntegrationScope,
  ): Promise<boolean> {
    const client = getSupabaseClient();
    if (!client) return false;
    const { error } = await client.rpc("data_delete_record", {
      p_workspace_id: scope?.workspaceId ?? null,
      p_project_id: scope?.projectId ?? "",
      p_collection_id: collectionId,
      p_record_id: recordId,
    });
    return !error;
  }
}
