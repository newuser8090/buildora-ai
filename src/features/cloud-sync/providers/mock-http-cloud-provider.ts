// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — MockHttpCloudProvider (dev/test backend)
//
// Implements CloudLibraryProvider against the in-memory mock backend exposed
// through Next.js API routes (/api/cloud/...). Only active when the cloud
// environment is "mock" (dev builds without Supabase env vars). The mock
// backend keeps state server-side so e2e can simulate two devices hitting
// the same "cloud".
// ---------------------------------------------------------------------------

import { makeCloudSyncError } from "../errors";
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
import { getMockSessionToken } from "./mock-session";
import type {
  CloudLibraryProvider,
  CloudSessionUser,
  CloudSharedLibraryInput,
} from "./cloud-library-provider";

interface MockEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function mockFetch<T>(
  path: string,
  options: { method?: string; body?: unknown },
): Promise<T> {
  const token = getMockSessionToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api/cloud/${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw makeCloudSyncError(
      "NETWORK_FAILED",
      "Couldn't reach the backup service. Your work is safe on this device.",
    );
  }

  const envelope = (await response.json().catch(() => null)) as MockEnvelope<T> | null;
  if (response.ok && envelope?.ok) return envelope.data as T;

  const code = envelope?.error?.code ?? "UNKNOWN";
  const message = envelope?.error?.message ?? "Sync couldn't complete.";
  throw makeCloudSyncError(
    mapMockErrorCode(code),
    message,
    code,
  );
}

function mapMockErrorCode(code: string): "RATE_LIMITED" | "NETWORK_FAILED" | "SESSION_EXPIRED" | "PERMISSION_DENIED" | "INVITE_EXPIRED" | "INVITE_INVALID" | "UNKNOWN" {
  switch (code) {
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "NETWORK_FAILED":
      return "NETWORK_FAILED";
    case "UNAUTHORIZED":
    case "SESSION_EXPIRED":
      return "SESSION_EXPIRED";
    case "PERMISSION_DENIED":
      return "PERMISSION_DENIED";
    case "INVITE_EXPIRED":
      return "INVITE_EXPIRED";
    case "INVITE_INVALID":
      return "INVITE_INVALID";
    default:
      return "UNKNOWN";
  }
}

export class MockHttpCloudProvider implements CloudLibraryProvider {
  readonly kind = "mock" as const;

  async getSessionUser(): Promise<CloudSessionUser | null> {
    const token = getMockSessionToken();
    if (!token) return null;
    try {
      const data = await mockFetch<{ user: CloudSessionUser }>("auth/session", {});
      return data.user ?? null;
    } catch {
      return null;
    }
  }

  // ---- Sync ----

  async pushBlockBatch(blocks: CloudMyBlockPayload[]): Promise<void> {
    await mockFetch("blocks/batch", { method: "POST", body: { blocks } });
  }

  async pushCollectionBatch(collections: CloudMyBlockCollectionPayload[]): Promise<void> {
    await mockFetch("collections/batch", { method: "POST", body: { collections } });
  }

  async pushTombstones(tombstones: CloudPushTombstone[]): Promise<void> {
    await mockFetch("tombstones", { method: "POST", body: { items: tombstones } });
  }

  async fetchChanges(after: string | null, limit: number): Promise<CloudChangesPage> {
    const query = new URLSearchParams();
    if (after) query.set("after", after);
    query.set("limit", String(limit));
    return mockFetch<CloudChangesPage>(`changes?${query.toString()}`, {});
  }

  // ---- Shared libraries ----

  async createSharedLibrary(input: CloudSharedLibraryInput): Promise<CloudSharedLibrary> {
    return mockFetch("libraries", { method: "POST", body: input });
  }

  async updateSharedLibrary(
    id: string,
    patch: { name?: string; description?: string },
  ): Promise<CloudSharedLibrary> {
    return mockFetch(`libraries/${id}`, { method: "PATCH", body: patch });
  }

  async deleteSharedLibrary(id: string): Promise<void> {
    await mockFetch(`libraries/${id}`, { method: "DELETE" });
  }

  async listSharedLibraries(): Promise<{
    owned: CloudSharedLibrary[];
    shared: CloudSharedLibrary[];
  }> {
    return mockFetch("libraries", {});
  }

  async getSharedLibrary(
    id: string,
  ): Promise<{ library: CloudSharedLibrary; blocks: CloudSharedLibraryBlock[] } | null> {
    return mockFetch(`libraries/${id}`, {});
  }

  async addBlocksToLibrary(libraryId: string, blockIds: string[]): Promise<void> {
    await mockFetch(`libraries/${libraryId}/blocks`, {
      method: "POST",
      body: { blockIds },
    });
  }

  async removeBlockFromLibrary(libraryId: string, blockId: string): Promise<void> {
    await mockFetch(`libraries/${libraryId}/blocks/${encodeURIComponent(blockId)}`, {
      method: "DELETE",
    });
  }

  async fetchSharedBlock(libraryId: string, blockId: string): Promise<CloudMyBlockPayload> {
    return mockFetch(`libraries/${libraryId}/blocks/${encodeURIComponent(blockId)}`, {});
  }

  // ---- Invitations ----

  async listLibraryMembers(
    libraryId: string,
  ): Promise<Array<{ userId: string; email: string; role: SharedLibraryRole }>> {
    return mockFetch(`libraries/${libraryId}/members`, {});
  }

  async inviteMember(
    libraryId: string,
    email: string,
    role: SharedLibraryRole,
  ): Promise<CloudLibraryInvitation> {
    return mockFetch(`libraries/${libraryId}/invitations`, {
      method: "POST",
      body: { email, role },
    });
  }

  async listInvitations(): Promise<CloudLibraryInvitation[]> {
    return mockFetch("invitations", {});
  }

  async listLibraryInvitations(libraryId: string): Promise<CloudLibraryInvitation[]> {
    return mockFetch(`libraries/${libraryId}/invitations`, {});
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    await mockFetch(`invitations/${invitationId}/accept`, { method: "POST" });
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    await mockFetch(`invitations/${invitationId}`, { method: "DELETE" });
  }

  async revokeMember(libraryId: string, memberUserId: string): Promise<void> {
    await mockFetch(`libraries/${libraryId}/members/${encodeURIComponent(memberUserId)}`, {
      method: "DELETE",
    });
  }

  async leaveSharedLibrary(libraryId: string): Promise<void> {
    await mockFetch(`libraries/${libraryId}/leave`, { method: "POST" });
  }
}

