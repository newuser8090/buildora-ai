// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — InMemoryCloudLibraryProvider (unit tests)
//
// Mirrors server-side enforcement (ownership, membership, invitation rules)
// so engine/conflict/shared-library tests are realistic without a backend.
// State lives in plain Maps keyed per test instance.
// ---------------------------------------------------------------------------

import { makeCloudSyncError } from "../errors";
import {
  encodeSyncCursor,
  isRecordAfterCursor,
  maxPagePosition,
  parseSyncCursor,
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

interface InMemoryLibrary {
  record: CloudSharedLibrary;
  blockIds: string[];
  members: Map<string, SharedLibraryRole>;
  memberEmails: Map<string, string>;
}

export class InMemoryCloudLibraryProvider implements CloudLibraryProvider {
  readonly kind = "mock" as const;

  currentUser: CloudSessionUser | null = null;
  blocks = new Map<string, CloudMyBlockPayload>();
  collections = new Map<string, CloudMyBlockCollectionPayload>();
  libraries = new Map<string, InMemoryLibrary>();
  invitations = new Map<string, CloudLibraryInvitation>();
  private idCounter = 0;

  // ---- Test helpers ------------------------------------------------------

  setCurrentUser(user: CloudSessionUser | null): void {
    this.currentUser = user;
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.idCounter}`;
  }

  private requireUser(): CloudSessionUser {
    if (!this.currentUser) {
      throw makeCloudSyncError("AUTH_REQUIRED", "Sign in to sync.");
    }
    return this.currentUser;
  }

  private requireLibrary(id: string): InMemoryLibrary {
    const library = this.libraries.get(id);
    if (!library || library.record.deletedAt) {
      throw makeCloudSyncError("PERMISSION_DENIED", "That shared library is unavailable.");
    }
    return library;
  }

  private requireAccess(library: InMemoryLibrary): void {
    const user = this.requireUser();
    const isOwner = library.record.ownerId === user.id;
    const role = library.members.get(user.id);
    if (!isOwner && !role) {
      throw makeCloudSyncError("PERMISSION_DENIED", "You don't have access to that shared library.");
    }
  }

  // ---- Session -----------------------------------------------------------

  async getSessionUser(): Promise<CloudSessionUser | null> {
    return this.currentUser;
  }

  // ---- Sync ---------------------------------------------------------------
  //
  // Cloud record ids are deterministic (`cloud-<localId>` for originals, the
  // cloud id for records downloaded on another device), so providers upsert
  // by the id already present on the payload — idempotent and retry-safe.

  async pushBlockBatch(blocks: CloudMyBlockPayload[]): Promise<void> {
    this.requireUser();
    for (const block of blocks) {
      this.blocks.set(block.id, { ...block });
    }
  }

  async pushCollectionBatch(collections: CloudMyBlockCollectionPayload[]): Promise<void> {
    this.requireUser();
    for (const collection of collections) {
      this.collections.set(collection.id, { ...collection });
    }
  }

  async pushTombstones(tombstones: CloudPushTombstone[]): Promise<void> {
    this.requireUser();
    for (const tombstone of tombstones) {
      if (tombstone.entityType === "myBlock") {
        const record = this.blocks.get(tombstone.id);
        if (record) {
          this.blocks.set(tombstone.id, {
            ...record,
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      } else {
        const record = this.collections.get(tombstone.id);
        if (record) {
          this.collections.set(tombstone.id, {
            ...record,
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
  }

  async fetchChanges(after: string | null, limit: number): Promise<CloudChangesPage> {
    this.requireUser();
    // Deterministic union pagination: blocks + collections are merged into ONE
    // (updatedAt, id) ordering and the page limit applies to the union, so a
    // page boundary can never skip an entity in the other store. The cursor is
    // `<updatedAt>|<id>` with a strict id tie-breaker for equal timestamps.
    const position = parseSyncCursor(after);
    const changed = [
      ...this.blocks.values().map((block) => ({ kind: "block" as const, record: block })),
      ...this.collections.values().map((collection) => ({ kind: "collection" as const, record: collection })),
    ]
      .filter((item) =>
        isRecordAfterCursor(item.record.updatedAt, item.record.id, position),
      )
      .sort(
        (a, b) =>
          a.record.updatedAt.localeCompare(b.record.updatedAt) ||
          a.record.id.localeCompare(b.record.id),
      );

    const page = changed.slice(0, limit);
    const pageBlocks = page.filter((i) => i.kind === "block").map((i) => i.record);
    const pageCollections = page.filter((i) => i.kind === "collection").map((i) => i.record);
    // The cursor advances ONLY to the maximum position actually observed in
    // this page — never past records that were not returned.
    const last = maxPagePosition(
      page.map((i) => ({ ts: i.record.updatedAt, id: i.record.id })),
    );

    return {
      blocks: pageBlocks,
      collections: pageCollections,
      cursor: last ? encodeSyncCursor(last.ts, last.id) : (after ?? ""),
      hasMore: page.length < changed.length,
    };
  }

  // ---- Shared libraries ---------------------------------------------------

  async createSharedLibrary(input: CloudSharedLibraryInput): Promise<CloudSharedLibrary> {
    const user = this.requireUser();
    const now = new Date().toISOString();
    const record: CloudSharedLibrary = {
      id: this.nextId("lib"),
      ownerId: user.id,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      createdAt: now,
      updatedAt: now,
      memberRole: "owner",
      memberCount: 1,
      blockCount: 0,
    };
    this.libraries.set(record.id, {
      record,
      blockIds: [],
      members: new Map([[user.id, "viewer"]]),
      memberEmails: new Map([[user.id, user.email]]),
    });
    return record;
  }

  async updateSharedLibrary(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<CloudSharedLibrary> {
    const user = this.requireUser();
    const library = this.requireLibrary(id);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can edit this shared library.");
    }
    const record: CloudSharedLibrary = {
      ...library.record,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: new Date().toISOString(),
    };
    library.record = record;
    return record;
  }

  async deleteSharedLibrary(id: string): Promise<void> {
    const user = this.requireUser();
    const library = this.requireLibrary(id);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can delete this shared library.");
    }
    library.record = { ...library.record, deletedAt: new Date().toISOString() };
  }

  async listSharedLibraries(): Promise<{
    owned: CloudSharedLibrary[];
    shared: CloudSharedLibrary[];
  }> {
    const user = this.requireUser();
    const owned: CloudSharedLibrary[] = [];
    const shared: CloudSharedLibrary[] = [];
    for (const library of this.libraries.values()) {
      if (library.record.deletedAt) continue;
      if (library.record.ownerId === user.id) {
        owned.push({
          ...library.record,
          memberRole: "owner",
          memberCount: library.members.size,
          blockCount: library.blockIds.length,
        });
      } else if (library.members.has(user.id)) {
        shared.push({
          ...library.record,
          memberRole: library.members.get(user.id) as SharedLibraryRole,
          memberCount: library.members.size,
          blockCount: library.blockIds.length,
        });
      }
    }
    return { owned, shared };
  }

  async getSharedLibrary(
    id: string,
  ): Promise<{ library: CloudSharedLibrary; blocks: CloudSharedLibraryBlock[] } | null> {
    const library = this.requireLibrary(id);
    this.requireAccess(library);
    const blocks: CloudSharedLibraryBlock[] = [];
    for (const blockId of library.blockIds) {
      const block = this.blocks.get(blockId);
      if (block && !block.deletedAt) {
        blocks.push({ id: this.nextId("sblk"), libraryId: id, block });
      }
    }
    return {
      library: {
        ...library.record,
        memberRole: library.record.ownerId === this.currentUser?.id ? "owner" : (library.members.get(this.currentUser?.id ?? "") ?? "viewer"),
        memberCount: library.members.size,
        blockCount: library.blockIds.length,
      },
      blocks,
    };
  }

  async addBlocksToLibrary(libraryId: string, blockIds: string[]): Promise<void> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can add pieces to this shared library.");
    }
    for (const blockId of blockIds) {
      if (this.blocks.has(blockId) && !library.blockIds.includes(blockId)) {
        library.blockIds.push(blockId);
      }
    }
    library.record = { ...library.record, updatedAt: new Date().toISOString() };
  }

  async removeBlockFromLibrary(libraryId: string, blockId: string): Promise<void> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can remove pieces from this shared library.");
    }
    library.blockIds = library.blockIds.filter((id) => id !== blockId);
    library.record = { ...library.record, updatedAt: new Date().toISOString() };
  }

  async fetchSharedBlock(libraryId: string, blockId: string): Promise<CloudMyBlockPayload> {
    const library = this.requireLibrary(libraryId);
    this.requireAccess(library);
    if (!library.blockIds.includes(blockId)) {
      throw makeCloudSyncError("PERMISSION_DENIED", "That piece isn't in this shared library.");
    }
    const block = this.blocks.get(blockId);
    if (!block || block.deletedAt) {
      throw makeCloudSyncError("REMOTE_VALIDATION_FAILED", "That shared piece is no longer available.");
    }
    return { ...block };
  }

  // ---- Invitations --------------------------------------------------------

  async listLibraryMembers(
    libraryId: string,
  ): Promise<Array<{ userId: string; email: string; role: SharedLibraryRole }>> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can see members.");
    }
    return [...library.members.entries()].map(([userId, role]) => ({
      userId,
      email: library.memberEmails.get(userId) ?? "",
      role,
    }));
  }

  async inviteMember(
    libraryId: string,
    email: string,
    role: SharedLibraryRole,
  ): Promise<CloudLibraryInvitation> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can invite people.");
    }
    const normalized = email.trim().toLowerCase();
    const now = new Date();
    const invitation: CloudLibraryInvitation = {
      id: this.nextId("inv"),
      libraryId,
      libraryName: library.record.name,
      recipientEmail: normalized,
      role,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    };
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  async listInvitations(): Promise<CloudLibraryInvitation[]> {
    const user = this.requireUser();
    return [...this.invitations.values()].filter(
      (i) =>
        i.recipientEmail === user.email.toLowerCase() &&
        i.status === "pending" &&
        i.expiresAt > new Date().toISOString(),
    );
  }

  async listLibraryInvitations(libraryId: string): Promise<CloudLibraryInvitation[]> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can see pending invitations.");
    }
    return [...this.invitations.values()].filter(
      (i) => i.libraryId === libraryId && i.status === "pending" && i.expiresAt > new Date().toISOString(),
    );
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const user = this.requireUser();
    const invitation = this.invitations.get(invitationId);
    if (!invitation || invitation.status !== "pending") {
      throw makeCloudSyncError("INVITE_INVALID", "That invitation is no longer valid.");
    }
    if (invitation.expiresAt <= new Date().toISOString()) {
      throw makeCloudSyncError("INVITE_EXPIRED", "That invitation has expired.");
    }
    if (invitation.recipientEmail !== user.email.toLowerCase()) {
      throw makeCloudSyncError("INVITE_INVALID", "That invitation isn't for this account.");
    }
    const library = this.libraries.get(invitation.libraryId);
    if (!library || library.record.deletedAt) {
      throw makeCloudSyncError("INVITE_INVALID", "That shared library no longer exists.");
    }
    library.members.set(user.id, invitation.role);
    library.memberEmails.set(user.id, user.email);
    invitation.status = "accepted";
    invitation.acceptedAt = new Date().toISOString();
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    const user = this.requireUser();
    const invitation = this.invitations.get(invitationId);
    if (!invitation) return;
    const library = this.libraries.get(invitation.libraryId);
    if (!library || library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can revoke invitations.");
    }
    invitation.status = "revoked";
  }

  async revokeMember(libraryId: string, memberUserId: string): Promise<void> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId !== user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Only the owner can remove members.");
    }
    library.members.delete(memberUserId);
  }

  async leaveSharedLibrary(libraryId: string): Promise<void> {
    const user = this.requireUser();
    const library = this.requireLibrary(libraryId);
    if (library.record.ownerId === user.id) {
      throw makeCloudSyncError("PERMISSION_DENIED", "Owners can't leave — delete the library instead.");
    }
    library.members.delete(user.id);
  }
}
