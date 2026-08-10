// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: /api/presence/[[...path]] (DEV/TEST ONLY)
//
// Exposes the in-memory mock presence transport to the browser. Active ONLY
// when the cloud environment resolves to "mock"; in production builds the
// route is disabled. Presence is EPHEMERAL: sessions expire via server
// TTL/heartbeat and are never persisted. Membership is enforced on every
// join/read, and the presence payload is a fixed display-safe shape.
//
// Paths:
//   POST /api/presence/join            { workspaceId, projectId?, sessionId }
//   POST /api/presence/heartbeat       { sessionId }
//   POST /api/presence/leave           { sessionId }
//   GET  /api/presence/workspace/[id]  ?projectId=... → active sessions
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import {
  MockWorkspaceError,
  getMockWorkspaceState,
  handleJoinPresence,
  handleHeartbeatPresence,
  handleLeavePresence,
  handleListWorkspacePresence,
} from "@/features/workspaces/mock/mock-workspace-server";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "NOT_CONFIGURED", message: "Presence is not enabled for this app." } },
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
  console.error("[presence-mock] unhandled error", err);
  return NextResponse.json(
    { ok: false, error: { code: "UNKNOWN", message: "Something went wrong on the demo presence service." } },
    { status: 500 },
  );
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    if (text.length > 512 * 1024) return {};
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
  { params }: { params: Promise<{ path?: string[] }> },
) {
  if (getCloudEnvironment().kind !== "mock") return disabledResponse();
  const { path } = await params;
  const segments = Array.isArray(path) ? path : [];
  const state = getMockWorkspaceState();
  const token = bearerToken(request);
  try {
    if (segments[0] === "workspace" && segments.length === 2) {
      const url = new URL(request.url);
      const projectId = url.searchParams.get("projectId") || undefined;
      return ok(handleListWorkspacePresence(state, token, segments[1], projectId));
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
    if (segments[0] === "join" && segments.length === 1) {
      handleJoinPresence(state, token, body);
      return ok(null);
    }
    if (segments[0] === "heartbeat" && segments.length === 1) {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      handleHeartbeatPresence(state, token, sessionId);
      return ok(null);
    }
    if (segments[0] === "leave" && segments.length === 1) {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      handleLeavePresence(state, token, sessionId);
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
