// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — SupabaseCloudLibraryProvider
//
// Real backend implementation. Security model:
//   - sync path uses direct table access; Row Level Security enforces
//     owner_id = auth.uid() on every user-owned table (server-enforced
//     ownership; owner_id cannot be forged)
//   - shared libraries / invitations use SECURITY DEFINER RPCs that check
//     ownership/membership server-side (centralized authorization)
//   - the browser only ever holds the anon key (never the service-role key)
//
// Cloud record ids are deterministic (`cloud-<localId>` for originals, the
// cloud id for downloads), making upserts idempotent and retry-safe.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/features/auth/supabase-client";
import { makeCloudSyncError } from "../errors";
import {
  encodeSyncCursor,
  maxPagePosition,
} from "../sync-cursor";
import type {
  CloudChangesPage,
  CloudLibraryInvitation,
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudSharedLibrary,
  CloudSharedLibraryBlock,
  CloudPushTombstone,
  SharedLibraryRole,
} from "../types";
import type {
  CloudLibraryProvider,
  CloudSessionUser,
  CloudSharedLibraryInput,
} from "./cloud-library-provider";

// ---------------------------------------------------------------------------
// Row mapping (cloud payload <-> snake_case columns)
// ---------------------------------------------------------------------------

interface BlockRow {
  id: string;
  schema_version: number;
  name: string;
  description: string | null;
  category: string;
  tags: string[];
  tree: unknown;
  source_metadata: unknown;
  preview_metadata: unknown;
  content_revision: number;
  created_at: string;
  updated_at: string;
  client_updated_at: string;
  device_id: string | null;
  deleted_at: string | null;
}

interface CollectionRow {
  id: string;
  schema_version: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number;
  block_ids: string[];
  deleted_at: string | null;
}

function blockToRow(payload: CloudMyBlockPayload): BlockRow {
  return {
    id: payload.id,
    schema_version: payload.schemaVersion,
    name: payload.name,
    description: payload.description ?? null,
    category: payload.category,
    tags: payload.tags,
    tree: payload.tree,
    source_metadata: payload.sourceMetadata ?? null,
    preview_metadata: payload.previewMetadata,
    content_revision: payload.contentRevision,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    client_updated_at: payload.clientUpdatedAt,
    device_id: payload.deviceId ?? null,
    deleted_at: payload.deletedAt ?? null,
  };
}

function rowToBlock(row: BlockRow): CloudMyBlockPayload {
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    category: row.category as CloudMyBlockPayload["category"],
    tags: row.tags,
    tree: row.tree as CloudMyBlockPayload["tree"],
    ...(row.source_metadata
      ? { sourceMetadata: row.source_metadata as CloudMyBlockPayload["sourceMetadata"] }
      : {}),
    previewMetadata: row.preview_metadata as CloudMyBlockPayload["previewMetadata"],
    contentRevision: row.content_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientUpdatedAt: row.client_updated_at,
    ...(row.device_id ? { deviceId: row.device_id } : {}),
    deletedAt: row.deleted_at,
  };
}

function collectionToRow(payload: CloudMyBlockCollectionPayload): CollectionRow {
  return {
    id: payload.id,
    schema_version: payload.schemaVersion,
    name: payload.name,
    description: payload.description ?? null,
    created_at: payload.createdAt,
    updated_at: payload.updatedAt,
    sort_order: payload.sortOrder,
    block_ids: payload.blockIds,
    deleted_at: payload.deletedAt ?? null,
  };
}

function rowToCollection(row: CollectionRow): CloudMyBlockCollectionPayload {
  return {
    id: row.id,
    schemaVersion: row.schema_version,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order,
    blockIds: row.block_ids,
    deletedAt: row.deleted_at,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class SupabaseCloudLibraryProvider implements CloudLibraryProvider {
  readonly kind = "supabase" as const;

  private client(): SupabaseClient {
    const client = getSupabaseClient();
    if (!client) {
      throw makeCloudSyncError("NOT_CONFIGURED", "Cloud backup isn't set up yet.");
    }
    return client;
  }

  private requireSession(): CloudSessionUser {
    // getSessionUser is always called by the engine first; this guard maps
    // missing sessions to a structured AUTH_REQUIRED error.
    throw makeCloudSyncError("AUTH_REQUIRED", "Sign in to sync.");
  }

  async getSessionUser(): Promise<CloudSessionUser | null> {
    const client = this.client();
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return {
      id: user.id,
      email: user.email ?? "",
    };
  }

  // ---- Sync (RLS-enforced) ----

  async pushBlockBatch(blocks: CloudMyBlockPayload[]): Promise<void> {
    if (blocks.length === 0) return;
    const user = await this.getSessionUser();
    if (!user) this.requireSession();
    const client = this.client();
    const rows = blocks.map(blockToRow);
    const { error } = await client.from("cloud_my_blocks").upsert(rows);
    if (error) throw this.mapError(error.message, error.code);
  }

  async pushCollectionBatch(collections: CloudMyBlockCollectionPayload[]): Promise<void> {
    if (collections.length === 0) return;
    await this.getSessionUser();
    const client = this.client();
    const rows = collections.map(collectionToRow);
    const { error } = await client.from("cloud_my_block_collections").upsert(rows);
    if (error) throw this.mapError(error.message, error.code);
  }

  async pushTombstones(tombstones: CloudPushTombstone[]): Promise<void> {
    if (tombstones.length === 0) return;
    await this.getSessionUser();
    const client = this.client();
    for (const tombstone of tombstones) {
      const table =
        tombstone.entityType === "myBlock"
          ? "cloud_my_blocks"
          : "cloud_my_block_collections";
      const now = new Date().toISOString();
      const { error } = await client
        .from(table)
        .update({ deleted_at: now, updated_at: now })
        .eq("id", tombstone.id);
      if (error) throw this.mapError(error.message, error.code);
    }
  }

  async fetchChanges(after: string | null, limit: number): Promise<CloudChangesPage> {
    const user = await this.getSessionUser();
    if (!user) this.requireSession();
    const client = this.client();

    // Deterministic union cursor (`ts|id`, strict id tie-breaker). The RPC
    // returns p_limit + 1 rows in one (updated_at, id) ordering across BOTH
    // tables and enforces owner_id = auth.uid() server-side.
    const { data: page, error: pageError } = await client.rpc("fetch_cloud_changes", {
      p_cursor: after ?? "",
      p_limit: limit,
    });
    if (pageError) throw this.mapError(pageError.message, pageError.code);

    const rows = (page ?? []) as Array<{
      kind: string;
      id: string;
      updated_at: string;
    }>;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const blockIds = pageRows.filter((r) => r.kind === "block").map((r) => r.id);
    const collectionIds = pageRows.filter((r) => r.kind === "collection").map((r) => r.id);

    const blocks: CloudMyBlockPayload[] = [];
    const collections: CloudMyBlockCollectionPayload[] = [];
    if (blockIds.length > 0) {
      const { data: blockRows, error: blockError } = await client
        .from("cloud_my_blocks")
        .select("*")
        .in("id", blockIds);
      if (blockError) throw this.mapError(blockError.message, blockError.code);
      blocks.push(...(blockRows ?? []).map(rowToBlock));
    }
    if (collectionIds.length > 0) {
      const { data: collectionRows, error: collectionError } = await client
        .from("cloud_my_block_collections")
        .select("*")
        .in("id", collectionIds);
      if (collectionError) throw this.mapError(collectionError.message, collectionError.code);
      collections.push(...(collectionRows ?? []).map(rowToCollection));
    }

    // The cursor advances ONLY to the maximum position actually observed.
    const last = maxPagePosition(pageRows.map((r) => ({ ts: r.updated_at, id: r.id })));
    return {
      blocks,
      collections,
      cursor: last ? encodeSyncCursor(last.ts, last.id) : (after ?? ""),
      hasMore,
    };
  }

  // ---- Shared libraries (RPC-enforced server-side authorization) ----

  async createSharedLibrary(input: CloudSharedLibraryInput): Promise<CloudSharedLibrary> {
    const client = this.client();
    const { data, error } = await client.rpc("create_shared_library", {
      p_name: input.name,
      p_description: input.description ?? null,
    });
    if (error) throw this.mapError(error.message, error.code);
    return data as CloudSharedLibrary;
  }

  async updateSharedLibrary(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<CloudSharedLibrary> {
    const client = this.client();
    const { data, error } = await client.rpc("update_shared_library", {
      p_library_id: id,
      p_name: patch.name ?? null,
      p_description: patch.description ?? null,
    });
    if (error) throw this.mapError(error.message, error.code);
    return data as CloudSharedLibrary;
  }

  async deleteSharedLibrary(id: string): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("delete_shared_library", {
      p_library_id: id,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  async listSharedLibraries(): Promise<{
    owned: CloudSharedLibrary[];
    shared: CloudSharedLibrary[];
  }> {
    const client = this.client();
    const { data, error } = await client.rpc("list_shared_libraries");
    if (error) throw this.mapError(error.message, error.code);
    const result = data as { owned: CloudSharedLibrary[]; shared: CloudSharedLibrary[] };
    return { owned: result?.owned ?? [], shared: result?.shared ?? [] };
  }

  async getSharedLibrary(
    id: string,
  ): Promise<{ library: CloudSharedLibrary; blocks: CloudSharedLibraryBlock[] } | null> {
    const client = this.client();
    const { data, error } = await client.rpc("get_shared_library", {
      p_library_id: id,
    });
    if (error) throw this.mapError(error.message, error.code);
    if (!data) return null;
    return data as { library: CloudSharedLibrary; blocks: CloudSharedLibraryBlock[] };
  }

  async addBlocksToLibrary(libraryId: string, blockIds: string[]): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("add_blocks_to_library", {
      p_library_id: libraryId,
      p_block_ids: blockIds,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  async removeBlockFromLibrary(libraryId: string, blockId: string): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("remove_block_from_library", {
      p_library_id: libraryId,
      p_block_id: blockId,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  async fetchSharedBlock(libraryId: string, blockId: string): Promise<CloudMyBlockPayload> {
    const client = this.client();
    const { data, error } = await client.rpc("fetch_shared_block", {
      p_library_id: libraryId,
      p_block_id: blockId,
    });
    if (error) throw this.mapError(error.message, error.code);
    if (!data) {
      throw makeCloudSyncError("PERMISSION_DENIED", "That shared piece isn't available.");
    }
    return data as CloudMyBlockPayload;
  }

  // ---- Invitations (RPC-enforced) ----

  async listLibraryMembers(
    libraryId: string,
  ): Promise<Array<{ userId: string; email: string; role: SharedLibraryRole }>> {
    const client = this.client();
    const { data, error } = await client.rpc("list_library_members", {
      p_library_id: libraryId,
    });
    if (error) throw this.mapError(error.message, error.code);
    return (data as Array<{ userId: string; email: string; role: SharedLibraryRole }>) ?? [];
  }

  async inviteMember(
    libraryId: string,
    email: string,
    role: SharedLibraryRole,
  ): Promise<CloudLibraryInvitation> {
    const client = this.client();
    const { data, error } = await client.rpc("create_invitation", {
      p_library_id: libraryId,
      p_email: email,
      p_role: role,
    });
    if (error) throw this.mapError(error.message, error.code);
    return data as CloudLibraryInvitation;
  }

  async listInvitations(): Promise<CloudLibraryInvitation[]> {
    const client = this.client();
    const { data, error } = await client.rpc("list_my_invitations");
    if (error) throw this.mapError(error.message, error.code);
    return (data as CloudLibraryInvitation[]) ?? [];
  }

  async listLibraryInvitations(libraryId: string): Promise<CloudLibraryInvitation[]> {
    const client = this.client();
    const { data, error } = await client.rpc("list_library_invitations", {
      p_library_id: libraryId,
    });
    if (error) throw this.mapError(error.message, error.code);
    return (data as CloudLibraryInvitation[]) ?? [];
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("accept_invitation", {
      p_invitation_id: invitationId,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("revoke_invitation", {
      p_invitation_id: invitationId,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  async revokeMember(libraryId: string, memberUserId: string): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("revoke_member", {
      p_library_id: libraryId,
      p_member_user_id: memberUserId,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  async leaveSharedLibrary(libraryId: string): Promise<void> {
    const client = this.client();
    const { error } = await client.rpc("leave_shared_library", {
      p_library_id: libraryId,
    });
    if (error) throw this.mapError(error.message, error.code);
  }

  // -------------------------------------------------------------------------
  // Error mapping — never leak raw provider messages to users
  // -------------------------------------------------------------------------

  private mapError(message: string, code?: string): ReturnType<typeof makeCloudSyncError> {
    if (code === "PGRST116") {
      return makeCloudSyncError("PERMISSION_DENIED", "You don't have access to that.", code);
    }
    const normalized = message.toLowerCase();
    if (normalized.includes("row-level security") || normalized.includes("new row violates row-level security policy")) {
      return makeCloudSyncError("PERMISSION_DENIED", "You don't have access to that.", code);
    }
    if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
      return makeCloudSyncError("RATE_LIMITED", "Too many syncs in a row. Try again shortly.", code);
    }
    if (normalized.includes("jwt") || normalized.includes("token")) {
      return makeCloudSyncError("SESSION_EXPIRED", "Your session ended. Sign in again to keep syncing.", code);
    }
    if (code === "23505") {
      return makeCloudSyncError("CONFLICT", "That record already exists. Syncing again will resolve it.", code);
    }
    return makeCloudSyncError(
      "NETWORK_FAILED",
      "The backup service had a problem. Your work is safe on this device.",
      code,
    );
  }
}
