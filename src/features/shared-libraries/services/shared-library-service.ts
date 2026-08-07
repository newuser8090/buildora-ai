// ---------------------------------------------------------------------------
// Private Shared Libraries (Phase P6) — service
//
// Thin, provider-independent service used by the UI. All authorization is
// enforced server-side (RLS + RPCs / mock enforcement). Local data is never
// required to browse libraries, and every action returns structured errors.
// ---------------------------------------------------------------------------

import type { CloudLibraryProvider } from "@/features/cloud-sync/providers/cloud-library-provider";
import { toCloudSyncError } from "@/features/cloud-sync/errors";
import type { SharedLibraryRole } from "../types";
import type {
  SharedLibrariesListing,
  SharedLibraryResult,
} from "../types";
import type {
  CloudLibraryInvitation,
  CloudSharedLibrary,
  CloudSharedLibraryBlock,
} from "@/features/cloud-sync/types";

export class SharedLibraryService {
  private provider: CloudLibraryProvider;

  constructor(provider: CloudLibraryProvider) {
    this.provider = provider;
  }

  async list(): Promise<SharedLibraryResult<SharedLibrariesListing>> {
    try {
      const listing = await this.provider.listSharedLibraries();
      return { ok: true, value: listing };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async create(
    name: string,
    description?: string,
  ): Promise<SharedLibraryResult<CloudSharedLibrary>> {
    try {
      const library = await this.provider.createSharedLibrary({ name, description });
      return { ok: true, value: library };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async update(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<SharedLibraryResult<CloudSharedLibrary>> {
    try {
      const library = await this.provider.updateSharedLibrary(id, patch);
      return { ok: true, value: library };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async delete(id: string): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.deleteSharedLibrary(id);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async details(
    id: string,
  ): Promise<
    SharedLibraryResult<{
      library: CloudSharedLibrary;
      blocks: CloudSharedLibraryBlock[];
    } | null>
  > {
    try {
      const result = await this.provider.getSharedLibrary(id);
      return { ok: true, value: result };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async addBlocks(libraryId: string, blockIds: string[]): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.addBlocksToLibrary(libraryId, blockIds);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async removeBlock(libraryId: string, blockId: string): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.removeBlockFromLibrary(libraryId, blockId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async invite(
    libraryId: string,
    email: string,
    role: SharedLibraryRole,
  ): Promise<SharedLibraryResult<CloudLibraryInvitation>> {
    try {
      const invitation = await this.provider.inviteMember(libraryId, email, role);
      return { ok: true, value: invitation };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async listInvitations(): Promise<SharedLibraryResult<CloudLibraryInvitation[]>> {
    try {
      const invitations = await this.provider.listInvitations();
      return { ok: true, value: invitations };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  /** Owner: pending invitations for one library (server-enforced). */
  async listLibraryInvitations(
    libraryId: string,
  ): Promise<SharedLibraryResult<CloudLibraryInvitation[]>> {
    try {
      const invitations = await this.provider.listLibraryInvitations(libraryId);
      return { ok: true, value: invitations };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async acceptInvitation(invitationId: string): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.acceptInvitation(invitationId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async revokeInvitation(invitationId: string): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.revokeInvitation(invitationId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async revokeMember(libraryId: string, memberUserId: string): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.revokeMember(libraryId, memberUserId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }

  async leave(libraryId: string): Promise<SharedLibraryResult<void>> {
    try {
      await this.provider.leaveSharedLibrary(libraryId);
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: toCloudSyncError(err) };
    }
  }
}
