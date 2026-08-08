// ---------------------------------------------------------------------------
// GET /api/publish/vercel/status — provider availability (Phase P8)
//
// Cheap (no credential validation on every call), cacheable by the client.
// Distinguishes configured / mock-dev / unavailable.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { vercelProviderStatus } from "@/features/publishing/server/vercel-mode";
import { ok } from "../../_lib";

export async function GET() {
  return ok(vercelProviderStatus());
}

export async function POST() {
  return NextResponse.json(
    { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } },
    { status: 405 },
  );
}
