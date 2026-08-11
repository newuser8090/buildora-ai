// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) —
// /api/workspaces/[[...path]] (DEV/TEST ONLY)
//
// Exposes the in-memory mock workspace backend to the browser. Active ONLY
// when the cloud environment resolves to "mock" (development without Supabase
// env vars); in production builds the route is disabled. Never used by the
// real Supabase path. No real credentials or user data ever pass through here.
//
// Paths (path excludes the /api/workspaces prefix):
//   GET  /api/workspaces/session                        → current user
//   GET  /api/workspaces                                → list (mine)
//   POST /api/workspaces                                → create
//   PATCH/DELETE /api/workspaces/[id]                   → update/delete (owner)
//   GET  /api/workspaces/[id]/members                   → members (owner)
//   PATCH/DELETE /api/workspaces/[id]/members/[uid]     → role/remove (owner)
//   POST /api/workspaces/[id]/leave                     → leave (non-owner)
//   POST /api/workspaces/[id]/invitations               → invite (owner)
//   GET  /api/workspaces/[id]/invitations               → pending (owner)
//   GET  /api/workspaces/invitations                    → my invites
//   POST /api/workspaces/invitations/[id]/accept        → accept
//   DELETE /api/workspaces/invitations/[id]             → revoke (owner)
//   GET/POST /api/workspaces/[id]/projects              → list / create
//   GET  /api/workspaces/[id]/projects/[pid]            → fetch
//   DELETE /api/workspaces/[id]/projects/[pid]          → delete (owner)
//   POST /api/workspaces/[id]/projects/[pid]/duplicate  → duplicate
//   POST /api/workspaces/save                           → save (optimistic)
//   POST /api/workspaces/[id]/projects/[pid]/lease      → acquire
//   GET  /api/workspaces/[id]/projects/[pid]/lease      → current lease
//   POST /api/workspaces/lease/[lid]/heartbeat          → heartbeat
//   POST /api/workspaces/lease/[lid]/release            → release
//   DELETE /api/workspaces/lease/project/[pid]          → revoke for project
//   GET  /api/workspaces/[id]/activity                  → activity (paginated)
//   POST /api/workspaces/activity                       → record (bridge events)
//   GET  /api/workspaces/[id]/projects/[pid]/versions   → metadata-only list
//   POST /api/workspaces/[id]/projects/[pid]/versions   → manual checkpoint
//   GET  /api/workspaces/[id]/projects/[pid]/versions/[vid] → fetch snapshot
//   POST /api/workspaces/[id]/projects/[pid]/versions/[vid]/restore → restore
//   POST /api/workspaces/[id]/projects/[pid]/versions/[vid]/copy → copy
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import {
  MockWorkspaceError,
  getMockWorkspaceState,
  handleListWorkspaces,
  handleCreateWorkspace,
  handleUpdateWorkspace,
  handleDeleteWorkspace,
  handleListMembers,
  handleChangeMemberRole,
  handleRemoveMember,
  handleLeaveWorkspace,
  handleInviteMember,
  handleListInvitations,
  handleListWorkspaceInvitations,
  handleAcceptInvitation,
  handleRevokeInvitation,
  handleListWorkspaceProjects,
  handleFetchWorkspaceProject,
  handleCreateWorkspaceProject,
  handleSaveWorkspaceProject,
  handleDeleteWorkspaceProject,
  handleDuplicateWorkspaceProject,
  handleAcquireEditLease,
  handleHeartbeatEditLease,
  handleReleaseEditLease,
  handleGetEditLease,
  handleRevokeLeasesForProject,
  handleRecordActivityEvent,
  handleListActivity,
  handleListProjectVersions,
  handleFetchProjectVersion,
  handleCreateManualVersion,
  handleRestoreProjectVersion,
  handleCopyProjectFromVersion,
} from "@/features/workspaces/mock/mock-workspace-server";
import { getMockCloudState } from "@/features/cloud-sync/mock/mock-cloud-server";
import {
  getMockShareState,
  revokeActiveSharesForProject,
  revokeMemberSharesForWorkspace,
} from "@/features/sharing/mock/mock-share-server";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "NOT_CONFIGURED", message: "Workspaces are not enabled for this app." } },
    { status: 404 },
  );
}

function ok(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

function errorResponse(err: unknown) {
  if (err instanceof MockWorkspaceError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  // Phase P19 (F2) — never log the raw error object; keep only the error CLASS
  // for diagnosability.
  const errorName =
    err instanceof Error ? err.constructor.name : typeof err;
  logger.error("api", "mock workspaces route unhandled error (UNKNOWN)", {
    code: "UNKNOWN",
    errorName,
  });
  return NextResponse.json(
    { ok: false, error: { code: "UNKNOWN", message: "Something went wrong on the demo workspace service." } },
    { status: 500 },
  );
}

async function readBody(request: Request, maxBytes = 8 * 1024 * 1024): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    if (text.length > maxBytes) return {};
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

async function resolveSessionUser(
  token: string | null,
): Promise<{ id: string; email: string } | null> {
  if (!token) return null;
  const state = getMockCloudState();
  const userId = state.sessions.get(token);
  if (!userId) return null;
  const user = [...state.users.values()].find((u) => u.id === userId);
  return user ? { id: user.id, email: user.email } : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [];
  const state = getMockWorkspaceState();
  const token = bearerToken(request);
  try {
    if (segments[0] === "session") {
      return ok({ user: await resolveSessionUser(token) });
    }
    if (segments[0] === "invitations") {
      return ok(handleListInvitations(state, token));
    }
    if (segments.length === 0) {
      return ok(handleListWorkspaces(state, token));
    }
    if (segments[1] === "members") {
      return ok(handleListMembers(state, token, segments[0]));
    }
    if (segments[1] === "invitations") {
      return ok(handleListWorkspaceInvitations(state, token, segments[0]));
    }
    if (segments[1] === "projects") {
      if (segments.length === 2) {
        return ok(handleListWorkspaceProjects(state, token, segments[0]));
      }
      if (segments.length === 3) {
        return ok(
          handleFetchWorkspaceProject(state, token, segments[0], decodeURIComponent(segments[2])),
        );
      }
    }
    if (segments[1] === "projects" && segments[3] === "lease") {
      return ok(handleGetEditLease(state, token, segments[0], decodeURIComponent(segments[2])));
    }
    if (segments[1] === "activity") {
      const url = new URL(request.url);
      const beforeTs = url.searchParams.get("beforeTs");
      const beforeId = url.searchParams.get("beforeId");
      const limitRaw = url.searchParams.get("limit");
      const filter = url.searchParams.get("filter") ?? undefined;
      const before =
        beforeTs && beforeId ? { ts: beforeTs, id: beforeId } : undefined;
      return ok(
        handleListActivity(state, token, segments[0], {
          before,
          limit: limitRaw ? Number(limitRaw) : undefined,
          filter,
        }),
      );
    }
    if (segments[1] === "projects" && segments[3] === "versions") {
      const workspaceId = segments[0];
      const projectId = decodeURIComponent(segments[2]);
      if (segments.length === 4) {
        return ok(handleListProjectVersions(state, token, workspaceId, projectId));
      }
      if (segments.length === 5) {
        return ok(
          handleFetchProjectVersion(state, token, workspaceId, projectId, segments[4]),
        );
      }
    }
    return NextResponse.json(
      { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
      { status: 404 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [];
  const state = getMockWorkspaceState();
  const token = bearerToken(request);
  const body = await readBody(request);
  try {
    if (segments.length === 0) {
      return ok(handleCreateWorkspace(state, token, body));
    }
    if (segments[0] === "save") {
      return ok(handleSaveWorkspaceProject(state, token, body));
    }
    if (segments[0] === "activity") {
      return ok(handleRecordActivityEvent(state, token, body));
    }
    if (segments[0] === "invitations" && segments[2] === "accept") {
      handleAcceptInvitation(state, token, segments[1]);
      return ok(null);
    }
    if (segments[0] === "lease" && segments[2] === "heartbeat") {
      return ok(handleHeartbeatEditLease(state, token, segments[1]));
    }
    if (segments[0] === "lease" && segments[2] === "release") {
      handleReleaseEditLease(state, token, segments[1]);
      return ok(null);
    }
    if (segments[1] === "leave") {
      handleLeaveWorkspace(state, token, segments[0]);
      return ok(null);
    }
    if (segments[1] === "invitations") {
      return ok(handleInviteMember(state, token, segments[0], body));
    }
    if (segments[1] === "projects") {
      if (segments.length === 2) {
        return ok(handleCreateWorkspaceProject(state, token, segments[0], body));
      }
      if (segments[3] === "duplicate") {
        return ok(
          handleDuplicateWorkspaceProject(
            state,
            token,
            segments[0],
            decodeURIComponent(segments[2]),
            body,
          ),
        );
      }
      if (segments[3] === "lease") {
        return ok(handleAcquireEditLease(state, token, segments[0], decodeURIComponent(segments[2])));
      }
      if (segments[3] === "versions" && segments.length === 4) {
        return ok(
          handleCreateManualVersion(state, token, segments[0], decodeURIComponent(segments[2]), body.label),
        );
      }
      if (segments[3] === "versions" && segments[5] === "restore") {
        return ok(
          handleRestoreProjectVersion(
            state,
            token,
            segments[0],
            decodeURIComponent(segments[2]),
            segments[4],
            body.expectedRevision,
          ),
        );
      }
      if (segments[3] === "versions" && segments[5] === "copy") {
        return ok(
          handleCopyProjectFromVersion(
            state,
            token,
            segments[0],
            decodeURIComponent(segments[2]),
            segments[4],
            body,
          ),
        );
      }
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
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [];
  const state = getMockWorkspaceState();
  const token = bearerToken(request);
  const body = await readBody(request);
  try {
    if (segments.length === 1) {
      return ok(handleUpdateWorkspace(state, token, segments[0], body));
    }
    if (segments[1] === "members" && segments.length === 3) {
      const workspaceId = segments[0];
      const memberUserId = decodeURIComponent(segments[2]);
      handleChangeMemberRole(state, token, workspaceId, memberUserId, body.role);
      // Downgrade to viewer revokes the member's review links immediately
      // (mirror of the Supabase change_member_role patch).
      if (body.role === "viewer") {
        revokeMemberSharesForWorkspace(getMockShareState(), workspaceId, memberUserId);
      }
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [];
  const state = getMockWorkspaceState();
  const token = bearerToken(request);
  try {
    if (segments[0] === "lease" && segments[1] === "project") {
      handleRevokeLeasesForProject(state, token, decodeURIComponent(segments[2]));
      return ok(null);
    }
    if (segments[0] === "invitations") {
      handleRevokeInvitation(state, token, segments[1]);
      return ok(null);
    }
    if (segments.length === 1) {
      // Deleting a workspace also revokes review links to all of its projects
      // (deleted content must not remain shareable).
      const workspaceId = segments[0];
      const projects = handleListWorkspaceProjects(state, token, workspaceId);
      handleDeleteWorkspace(state, token, workspaceId);
      for (const project of projects) {
        revokeActiveSharesForProject(getMockShareState(), project.projectId);
      }
      return ok(null);
    }
    if (segments[1] === "members" && segments.length === 3) {
      const workspaceId = segments[0];
      const memberUserId = decodeURIComponent(segments[2]);
      handleRemoveMember(state, token, workspaceId, memberUserId);
      // Removed members lose their review links to this workspace's projects
      // immediately (mirror of the Supabase remove_workspace_member patch).
      revokeMemberSharesForWorkspace(getMockShareState(), workspaceId, memberUserId);
      return ok(null);
    }
    if (segments[1] === "projects" && segments.length === 3) {
      const workspaceId = segments[0];
      const projectId = decodeURIComponent(segments[2]);
      handleDeleteWorkspaceProject(state, token, workspaceId, projectId);
      // Workspace project deletion revokes its review links immediately.
      revokeActiveSharesForProject(getMockShareState(), projectId);
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
