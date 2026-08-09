// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — /api/share/[...path]
// (DEV/TEST ONLY)
//
// Exposes the in-memory mock share backend to the browser. Active ONLY when
// the cloud environment resolves to "mock" (development without Supabase env
// vars); in production builds the route is disabled. Never used by the real
// Supabase path (that provider talks to Supabase directly / via RPCs). No
// real credentials or user data ever pass through here.
//
// Paths (path excludes the /api/share prefix):
//   POST /api/share                      → create (owner)
//   GET  /api/share?projectId=           → list (owner)
//   GET  /api/share?projectIds=a,b,c     → status batch (owner, dashboard)
//   GET  /api/share/view/[token]         → public resolve (anonymous)
//   PATCH /api/share/[id]                → update settings (owner)
//   POST /api/share/[id]/snapshot        → push projection (owner)
//   POST /api/share/[id]/regenerate      → new token (owner)
//   POST /api/share/[id]/revoke          → revoke (owner)
//   GET  /api/share/[id]/feedback        → list comments (owner)
//   POST /api/share/[id]/feedback        → submit (anonymous, token in body)
//   PATCH /api/share/[id]/feedback/[cid] → resolve/reopen (owner)
//   DELETE /api/share/[id]/feedback/[cid]→ delete comment (owner)
//   POST /api/share/delete-project-data  → lifecycle cleanup (owner)
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import {
  MockShareError,
  getMockShareState,
  handleCreateShare,
  handleListShares,
  handleShareStatusBatch,
  handleUpdateShare,
  handlePushSnapshot,
  handleRegenerateShare,
  handleRevokeShare,
  handleListComments,
  handleSubmitComment,
  handleSetCommentResolved,
  handleDeleteComment,
  handleResolveShare,
  handleDeleteProjectShareData,
} from "@/features/sharing/mock/mock-share-server";
import { parseProjection } from "@/features/sharing/projection/sanitize-share-projection";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "NOT_CONFIGURED", message: "Review links are not enabled for this app." } },
    { status: 404 },
  );
}

function ok(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

function errorResponse(err: unknown) {
  if (err instanceof MockShareError) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  // Dev/test only: log unexpected non-MockShareError failures for diagnosis.
  console.error("[share-mock] unhandled error", err);
  return NextResponse.json(
    { ok: false, error: { code: "UNKNOWN", message: "Something went wrong on the demo review service." } },
    { status: 500 },
  );
}

async function readBody(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
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

function originOf(request: Request): string {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  // Optional catch-all yields undefined for the empty path — normalize.
  const segments = Array.isArray(path) ? path : [];
  const state = getMockShareState();
  const token = bearerToken(request);
  const url = new URL(request.url);
  try {
    // Public resolve: /api/share/view/[token] (anonymous)
    if (segments[0] === "view") {
      const rawToken = decodeURIComponent(segments[1] ?? "");
      const result = handleResolveShare(state, rawToken);
      const parsed = result.projection ? parseProjection(result.projection) : null;
      return ok({
        state: result.state,
        share: {
          ...result.share,
          projectName: parsed?.name?.slice(0, 120) ?? "Website",
        },
        projection: parsed,
      });
    }
    if (segments.length === 0) {
      const projectIds = (url.searchParams.get("projectIds") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (projectIds.length > 0) {
        return ok(handleShareStatusBatch(state, token, projectIds));
      }
      const projectId = url.searchParams.get("projectId") ?? "";
      if (!projectId) {
        return NextResponse.json(
          { ok: false, error: { code: "INVALID_INPUT", message: "Missing project." } },
          { status: 400 },
        );
      }
      return ok(handleListShares(state, token, projectId));
    }
    if (segments[1] === "feedback" && segments.length === 2) {
      return ok(handleListComments(state, token, segments[0]));
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
  // Optional catch-all yields undefined for the empty path — normalize.
  const segments = Array.isArray(path) ? path : [];
  const state = getMockShareState();
  const token = bearerToken(request);
  try {
    if (segments.length === 0) {
      const body = await readBody(request);
      const result = handleCreateShare(state, token, body, originOf(request));
      return ok(result);
    }
    if (segments.length === 1 && segments[0] === "delete-project-data") {
      const body = await readBody(request);
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      if (!projectId) {
        return NextResponse.json(
          { ok: false, error: { code: "INVALID_INPUT", message: "Missing project." } },
          { status: 400 },
        );
      }
      return ok(handleDeleteProjectShareData(state, token, projectId));
    }
    if (segments[1] === "snapshot") {
      const body = await readBody(request, 8 * 1024 * 1024);
      handlePushSnapshot(state, token, segments[0], body);
      return ok(null);
    }
    if (segments[1] === "regenerate") {
      const result = handleRegenerateShare(state, token, segments[0], originOf(request));
      return ok(result);
    }
    if (segments[1] === "revoke") {
      handleRevokeShare(state, token, segments[0]);
      return ok(null);
    }
    if (segments[1] === "feedback") {
      const body = await readBody(request);
      const comment = handleSubmitComment(state, segments[0], body);
      return ok(comment);
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
  // Optional catch-all yields undefined for the empty path — normalize.
  const segments = Array.isArray(path) ? path : [];
  const state = getMockShareState();
  const token = bearerToken(request);
  try {
    if (segments[1] === "feedback" && segments.length === 3) {
      const body = await readBody(request);
      handleSetCommentResolved(state, token, segments[0], decodeURIComponent(segments[2]), body.resolved === true);
      return ok(null);
    }
    if (segments.length === 1) {
      const body = await readBody(request);
      return ok(handleUpdateShare(state, token, segments[0], body));
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
  // Optional catch-all yields undefined for the empty path — normalize.
  const segments = Array.isArray(path) ? path : [];
  const state = getMockShareState();
  const token = bearerToken(request);
  try {
    if (segments[1] === "feedback" && segments.length === 3) {
      handleDeleteComment(state, token, segments[0], decodeURIComponent(segments[2]));
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
