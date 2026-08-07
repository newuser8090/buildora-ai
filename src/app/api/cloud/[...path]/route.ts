// ---------------------------------------------------------------------------
// Mock cloud backend — /api/cloud/[...path] (DEV/TEST ONLY)
//
// Exposes the in-memory mock backend to the browser. Active ONLY when the
// cloud environment resolves to "mock" (development without Supabase env
// vars); in production builds the route is disabled. Never used by the real
// Supabase path. No real credentials or user data ever pass through here.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import type {
  CloudMyBlockCollectionPayload,
  CloudMyBlockPayload,
  CloudPushTombstone,
} from "@/features/cloud-sync/types";
import {
  MockCloudError,
  getMockCloudState,
  handleSignup,
  handleSignin,
  handleSignout,
  handleResetPassword,
  handlePushBlockBatch,
  handlePushCollectionBatch,
  handlePushTombstones,
  handleFetchChanges,
  handleCreateLibrary,
  handleListLibraries,
  handleGetLibrary,
  handleUpdateLibrary,
  handleDeleteLibrary,
  handleAddBlocksToLibrary,
  handleRemoveBlockFromLibrary,
  handleFetchSharedBlock,
  handleListLibraryMembers,
  handleInviteMember,
  handleListInvitations,
  handleListLibraryInvitations,
  handleAcceptInvitation,
  handleRevokeInvitation,
  handleRevokeMember,
  handleLeaveLibrary,
} from "@/features/cloud-sync/mock/mock-cloud-server";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "NOT_CONFIGURED", message: "Cloud backup is not enabled for this app." } },
    { status: 404 },
  );
}

function ok(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

function errorResponse(err: unknown) {
  if (err instanceof MockCloudError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  return NextResponse.json(
    { ok: false, error: { code: "UNKNOWN", message: "Something went wrong on the demo cloud." } },
    { status: 500 },
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const state = getMockCloudState();
  const token = bearerToken(request);
  try {
    if (path[0] === "auth" && path[1] === "session") {
      // Session check: resolve the token (invalid tokens return 401).
      const user = await resolveSessionUser(state, token);
      return ok({ user });
    }
    if (path[0] === "changes") {
      const url = new URL(request.url);
      const after = url.searchParams.get("after");
      const limit = Math.min(Number(url.searchParams.get("limit")) || 200, 200);
      return ok(handleFetchChanges(state, token, after, limit));
    }
    if (path[0] === "libraries") {
      if (path.length === 1) {
        return ok(handleListLibraries(state, token));
      }
      const libraryId = path[1];
      if (path.length === 2) {
        const result = handleGetLibrary(state, token, libraryId);
        return ok(result);
      }
      if (path[2] === "blocks" && path.length === 3) {
        const { blockIds } = await readBody(request);
        handleAddBlocksToLibrary(
          state,
          token,
          libraryId,
          Array.isArray(blockIds) ? blockIds.filter((x): x is string => typeof x === "string") : [],
        );
        return ok(null);
      }
      if (path[2] === "blocks" && path.length === 4) {
        return ok(handleFetchSharedBlock(state, token, libraryId, decodeURIComponent(path[3])));
      }
      if (path[2] === "invitations" && path.length === 3) {
        return ok(handleListLibraryInvitations(state, token, libraryId));
      }
      if (path[2] === "leave") {
        handleLeaveLibrary(state, token, libraryId);
        return ok(null);
      }
      if (path[2] === "members" && path.length === 3) {
        return ok(handleListLibraryMembers(state, token, libraryId));
      }
      if (path[2] === "members" && path.length === 4) {
        handleRevokeMember(state, token, libraryId, decodeURIComponent(path[3]));
        return ok(null);
      }
    }
    if (path[0] === "invitations") {
      return ok(handleListInvitations(state, token));
    }
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
      { status: 404 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

async function resolveSessionUser(
  state: ReturnType<typeof getMockCloudState>,
  token: string | null,
): Promise<{ id: string; email: string } | null> {
  // Mirrors requireSession but returns null for signed-out (not an error).
  if (!token) return null;
  const userId = state.sessions.get(token);
  if (!userId) return null;
  const user = [...state.users.values()].find((u) => u.id === userId);
  return user ? { id: user.id, email: user.email } : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const state = getMockCloudState();
  const body = await readBody(request);
  const token = bearerToken(request);
  try {
    if (path[0] === "auth") {
      if (path[1] === "signup") return ok(handleSignup(state, body));
      if (path[1] === "signin") return ok(handleSignin(state, body));
      if (path[1] === "signout") {
        handleSignout(state, token);
        return ok(null);
      }
      if (path[1] === "reset") {
        handleResetPassword(state, body);
        return ok(null);
      }
      if (path[1] === "session") {
        // Session restore (MockAuthService.getSession posts the stored token).
        const sessionToken =
          typeof body.token === "string" && body.token.length > 0 ? body.token : token;
        const user = await resolveSessionUser(state, sessionToken);
        return ok({ user });
      }
    }
    if (path[0] === "blocks" && path[1] === "batch") {
      const blocks: CloudMyBlockPayload[] = Array.isArray(body.blocks) ? (body.blocks as CloudMyBlockPayload[]) : [];
      handlePushBlockBatch(state, token, blocks);
      return ok(null);
    }
    if (path[0] === "collections" && path[1] === "batch") {
      const collections: CloudMyBlockCollectionPayload[] = Array.isArray(body.collections)
        ? (body.collections as CloudMyBlockCollectionPayload[])
        : [];
      handlePushCollectionBatch(state, token, collections);
      return ok(null);
    }
    if (path[0] === "tombstones") {
      const items: CloudPushTombstone[] = Array.isArray(body.items) ? (body.items as CloudPushTombstone[]) : [];
      handlePushTombstones(state, token, items);
      return ok(null);
    }
    if (path[0] === "libraries" && path.length === 1) {
      return ok(handleCreateLibrary(state, token, body));
    }
    if (path[0] === "libraries" && path.length === 2) {
      return ok(null); // PATCH handled below
    }
    if (path[0] === "libraries" && path[2] === "invitations" && path.length === 3) {
      return ok(handleInviteMember(state, token, path[1], body));
    }
    if (path[0] === "libraries" && path[2] === "blocks" && path.length === 3) {
      const blockIds: string[] = Array.isArray(body.blockIds)
        ? (body.blockIds as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      handleAddBlocksToLibrary(state, token, path[1], blockIds);
      return ok(null);
    }
    if (path[0] === "libraries" && path[2] === "leave") {
      handleLeaveLibrary(state, token, path[1]);
      return ok(null);
    }
    if (path[0] === "invitations" && path[2] === "accept") {
      handleAcceptInvitation(state, token, path[1]);
      return ok(null);
    }
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
      { status: 404 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const state = getMockCloudState();
  const token = bearerToken(request);
  const body = await readBody(request);
  try {
    if (path[0] === "libraries" && path.length === 2) {
      return ok(handleUpdateLibrary(state, token, path[1], body));
    }
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
      { status: 404 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const state = getMockCloudState();
  const token = bearerToken(request);
  try {
    if (path[0] === "libraries" && path.length === 2) {
      handleDeleteLibrary(state, token, path[1]);
      return ok(null);
    }
    if (path[0] === "libraries" && path[2] === "blocks" && path.length === 4) {
      handleRemoveBlockFromLibrary(state, token, path[1], decodeURIComponent(path[3]));
      return ok(null);
    }
    if (path[0] === "libraries" && path[2] === "members" && path.length === 4) {
      handleRevokeMember(state, token, path[1], decodeURIComponent(path[3]));
      return ok(null);
    }
    if (path[0] === "invitations" && path.length === 2) {
      handleRevokeInvitation(state, token, path[1]);
      return ok(null);
    }
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
      { status: 404 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
