// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — /api/collab/[[...path]] (DEV/TEST ONLY)
//
// Exposes the in-memory mock collaboration room backend to the browser. Active
// ONLY when the cloud environment resolves to "mock"; in production builds the
// route is disabled. Never used by the real Supabase path. The room state
// lives in the dev-server process (globalThis), so two browser contexts share
// ONE room — deterministic multi-user E2E.
//
// Paths (path excludes the /api/collab prefix):
//   POST /api/collab/rooms/[ws]/[pid]/join        → durable base + room frontier
//   POST /api/collab/rooms/[ws]/[pid]/seed        → seed canonical state (1st wins)
//   POST /api/collab/rooms/[ws]/[pid]/send        → relay a Yjs update (editor)
//   GET  /api/collab/rooms/[ws]/[pid]?afterSeq=N  → poll for updates (member)
//   POST /api/collab/rooms/[ws]/[pid]/checkpoint  → prune retained log (editor)
//   POST /api/collab/rooms/[ws]/[pid]/lock        → maintenance lock (owner)
//   POST /api/collab/rooms/[ws]/[pid]/unlock      → release lock (holder)
//
// Security mirrors production: membership is required to join/poll; editor-or-
// owner is required to send/checkpoint; the maintenance lock is owner-only;
// the actor is always derived from the session (never trusted from the body);
// oversized updates are rejected. RLS on the Supabase path provides the same
// guarantees durably.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import {
  MockWorkspaceError,
  getMockWorkspaceState,
  handleCollabJoin,
  handleCollabSeed,
  handleCollabSend,
  handleCollabPoll,
  handleCollabCheckpoint,
  handleCollabLock,
  handleCollabUnlock,
} from "@/features/workspaces/mock/mock-workspace-server";

function disabledResponse() {
  return NextResponse.json(
    { ok: false, error: { code: "NOT_CONFIGURED", message: "Collaboration is not enabled for this app." } },
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
  // Phase P19 (F2) — never log the raw error object (may embed stack traces /
  // internals); record a bounded diagnostic through the structured logger,
  // keeping only the error CLASS (constructor name) for diagnosability.
  const errorName =
    err instanceof Error ? err.constructor.name : typeof err;
  logger.error("api", "mock collab route unhandled error (UNKNOWN)", {
    code: "UNKNOWN",
    errorName,
  });
  return NextResponse.json(
    { ok: false, error: { code: "UNKNOWN", message: "Something went wrong on the collaboration service." } },
    { status: 500 },
  );
}

async function readBody(request: Request, maxBytes = 512 * 1024): Promise<Record<string, unknown>> {
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

/** /rooms/[ws]/[pid]/(join|seed|send|checkpoint|lock|unlock) or poll ?afterSeq=N */
function parseRoomSegments(segments: string[]): {
  action: "poll" | "join" | "seed" | "send" | "checkpoint" | "lock" | "unlock";
  workspaceId: string;
  projectId: string;
} | null {
  if (segments[0] !== "rooms" || segments.length < 3) return null;
  const workspaceId = segments[1];
  const projectId = decodeURIComponent(segments[2]);
  if (segments.length === 3) return { action: "poll", workspaceId, projectId };
  switch (segments[3]) {
    case "join":
    case "seed":
    case "send":
    case "checkpoint":
    case "lock":
    case "unlock":
      return { action: segments[3], workspaceId, projectId };
    default:
      return null;
  }
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
    const parsed = parseRoomSegments(segments);
    if (parsed?.action === "poll") {
      const url = new URL(request.url);
      const afterSeqRaw = url.searchParams.get("afterSeq");
      const afterSeq = afterSeqRaw !== null ? Number(afterSeqRaw) : -1;
      return ok(
        handleCollabPoll(state, token, parsed.workspaceId, parsed.projectId, afterSeq),
      );
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
  try {
    const parsed = parseRoomSegments(segments);
    if (!parsed) {
      return NextResponse.json(
        { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
        { status: 404 },
      );
    }
    const body = await readBody(request);
    switch (parsed.action) {
      case "join":
        return ok(handleCollabJoin(state, token, parsed.workspaceId, parsed.projectId));
      case "seed":
        return ok(
          handleCollabSeed(state, token, parsed.workspaceId, parsed.projectId, {
            state: body.state,
          }),
        );
      case "send":
        return ok(
          handleCollabSend(state, token, parsed.workspaceId, parsed.projectId, {
            update: body.update,
            actorClientId: body.actorClientId,
          }),
        );
      case "checkpoint":
        handleCollabCheckpoint(state, token, parsed.workspaceId, parsed.projectId, {
          seq: body.seq,
          // The canonical Yjs state MUST accompany the prune so late joiners
          // converge to identical structs (architecture §26/§38) — dropping
          // it leaves the room with a stale pre-edit seed and reloaded
          // clients revert to blank content.
          state: body.state,
        });
        return ok(null);
      case "lock":
        handleCollabLock(state, token, parsed.workspaceId, parsed.projectId);
        return ok(null);
      case "unlock":
        handleCollabUnlock(state, token, parsed.workspaceId, parsed.projectId);
        return ok(null);
      default:
        return NextResponse.json(
          { ok: false, error: { code: "NOT_FOUND", message: "Unknown endpoint." } },
          { status: 404 },
        );
    }
  } catch (err) {
    return errorResponse(err);
  }
}
