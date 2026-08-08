// ---------------------------------------------------------------------------
// Publish API — shared route helpers (Phase P8)
//
// Envelope convention matches the mock-cloud API: `{ ok, data }` on success,
// `{ ok: false, error: { code, message } }` on failure. Errors are always
// beginner-safe and structured — raw provider errors never reach the browser.
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";
import type { ApiError } from "@/features/publishing/server/publish-api-types";
import { publishErrorMessage, type PublishErrorCode } from "@/features/publishing/errors";

const MAX_BODY_BYTES = 30 * 1024 * 1024; // deploy payloads carry site files

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(
  code: PublishErrorCode | "INVALID_INPUT" | "NOT_CONFIGURED" | "RATE_LIMITED",
  message?: string,
  status = 400,
): NextResponse {
  const finalCode = code as PublishErrorCode;
  const finalMessage = message ?? publishErrorMessage(finalCode);
  const error: ApiError = { code: finalCode, message: finalMessage };
  return NextResponse.json({ ok: false, error }, { status });
}

export type ReadBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

/** Parse a JSON body with a hard cap (returns 413/400 responses on failure). */
export async function readJsonBody(request: Request): Promise<ReadBodyResult> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { ok: false, response: fail("INVALID_INPUT", "Couldn't read the request.", 400) };
  }
  if (raw.length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: fail("ARTIFACT_TOO_LARGE", "Request body is too large.", 413),
    };
  }
  if (raw.length === 0) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, response: fail("INVALID_INPUT", "Invalid JSON in request body.", 400) };
  }
}

/** Map a thrown provider error to a response (never leaks internals). */
export function providerErrorResponse(err: unknown): NextResponse {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err
  ) {
    const e = err as { code: string; message: string };
    const status =
      e.code === "AUTH_REQUIRED"
        ? 401
        : e.code === "PROVIDER_RATE_LIMITED" || e.code === "RATE_LIMITED"
          ? 429
          : e.code === "DOMAIN_ALREADY_IN_USE" || e.code === "DUPLICATE_PUBLISH"
            ? 409
            : e.code === "DEPLOYMENT_NOT_FOUND" || e.code === "DOMAIN_NOT_FOUND"
              ? 404
              : 400;
    return NextResponse.json(
      { ok: false, error: { code: e.code, message: e.message } },
      { status },
    );
  }
  return fail("UNKNOWN", "Something went wrong. Please try again.", 500);
}
