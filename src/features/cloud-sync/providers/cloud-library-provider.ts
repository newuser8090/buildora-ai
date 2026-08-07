// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — CloudLibraryProvider abstraction
//
// The sync engine and conflict logic depend ONLY on this interface, so core
// tests run against the in-memory provider without a live Supabase project.
//
// Implementations:
//   - SupabaseCloudLibraryProvider (real backend; RLS enforces ownership)
//   - MockHttpCloudLibraryProvider (dev/test backend via Next API routes)
//   - InMemoryCloudLibraryProvider (unit tests)
// ---------------------------------------------------------------------------

import type {
  CloudChangesPage,
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudSharedLibrary,
  CloudSharedLibraryBlock,
  CloudLibraryInvitation,
  SharedLibraryRole,
} from "../types";

export interface CloudSessionUser {
  id: string;
  email: string;
}

export interface CloudPushTombstone {
  entityType: "myBlock" | "collection";
  id: string;
}

export interface CloudSharedLibraryInput {
  name: string;
  description?: string;
}

export interface CloudLibraryProvider {
  readonly kind: "supabase" | "mock";
  /** The currently signed-in user (null when signed out / session invalid). */
  getSessionUser(): Promise<CloudSessionUser | null>;

  // ---- Block + collection sync ----
  /** Upsert a batch of validated cloud block payloads (server assigns ids). */
  pushBlockBatch(blocks: CloudMyBlockPayload[]): Promise<void>;
  pushCollectionBatch(collections: CloudMyBlockCollectionPayload[]): Promise<void>;
  /** Soft-delete (tombstone) entities on the server. */
  pushTombstones(tombstones: CloudPushTombstone[]): Promise<void>;
  /** Fetch remote deltas newer than the cursor (paginated). */
  fetchChanges(after: string | null, limit: number): Promise<CloudChangesPage>;

  // ---- Private shared libraries ----
  createSharedLibrary(input: CloudSharedLibraryInput): Promise<CloudSharedLibrary>;
  updateSharedLibrary(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<CloudSharedLibrary>;
  deleteSharedLibrary(id: string): Promise<void>;
  listSharedLibraries(): Promise<{
    owned: CloudSharedLibrary[];
    shared: CloudSharedLibrary[];
  }>;
  getSharedLibrary(
    id: string,
  ): Promise<{ library: CloudSharedLibrary; blocks: CloudSharedLibraryBlock[] } | null>;
  /** Add validated cloud block ids owned by the user to a library they manage. */
  addBlocksToLibrary(libraryId: string, blockIds: string[]): Promise<void>;
  removeBlockFromLibrary(libraryId: string, blockId: string): Promise<void>;
  /** Fetch a shared block with server-side access verification. */
  fetchSharedBlock(libraryId: string, blockId: string): Promise<CloudMyBlockPayload>;

  // ---- Invitations + members ----
  /** List the members of a library the current user manages (owner only). */
  listLibraryMembers(
    libraryId: string,
  ): Promise<Array<{ userId: string; email: string; role: SharedLibraryRole }>>;
  inviteMember(
    libraryId: string,
    email: string,
    role: SharedLibraryRole,
  ): Promise<CloudLibraryInvitation>;
  listInvitations(): Promise<CloudLibraryInvitation[]>;
  /** Owner lists the pending invitations they created for one library. */
  listLibraryInvitations(libraryId: string): Promise<CloudLibraryInvitation[]>;
  acceptInvitation(invitationId: string): Promise<void>;
  /** Owner revokes a pending invitation. */
  revokeInvitation(invitationId: string): Promise<void>;
  /** Owner removes an existing member. */
  revokeMember(libraryId: string, memberUserId: string): Promise<void>;
  /** A member leaves a library they do not own. */
  leaveSharedLibrary(libraryId: string): Promise<void>;
}
