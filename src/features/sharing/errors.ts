// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — structured errors
//
// Deterministic, user-safe error construction. Mirrors the cloud-sync /
// my-blocks / publishing conventions. User-facing messages never expose SQL,
// stack traces, tokens, table names, or raw provider errors.
// ---------------------------------------------------------------------------

import type { ShareError, ShareErrorCode } from "./types";

export type { ShareError, ShareErrorCode } from "./types";

const RETRYABLE_CODES: ReadonlySet<ShareErrorCode> = new Set([
  "OFFLINE",
  "NETWORK_FAILED",
  "RATE_LIMITED",
  "SESSION_EXPIRED",
  "MALFORMED_RESPONSE",
]);

export function makeShareError(
  code: ShareErrorCode,
  message: string,
  cause?: string,
): ShareError {
  return {
    code,
    message,
    cause,
    retryable: RETRYABLE_CODES.has(code),
  };
}

/** Normalize an unknown thrown value into a structured share error. */
export function toShareError(
  err: unknown,
  fallbackCode: ShareErrorCode = "UNKNOWN",
  fallbackMessage = "Sharing couldn't complete right now.",
): ShareError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as Partial<ShareError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return makeShareError(
        candidate.code as ShareErrorCode,
        candidate.message,
        candidate.cause ?? (err instanceof Error ? err.message : undefined),
      );
    }
  }
  if (err && typeof err === "object" && "statusCode" in err) {
    const rawStatus = (err as { statusCode?: unknown }).statusCode;
    const status = typeof rawStatus === "number" ? rawStatus : Number(rawStatus);
    if (status === 401) {
      return makeShareError(
        "SESSION_EXPIRED",
        "Your session ended. Sign in again to manage review links.",
      );
    }
    if (status === 403) {
      return makeShareError(
        "PERMISSION_DENIED",
        "You don't have permission to do that.",
      );
    }
    if (status === 429) {
      return makeShareError(
        "RATE_LIMITED",
        "Too many requests. Please wait a moment and try again.",
      );
    }
    if (status >= 500) {
      return makeShareError(
        "NETWORK_FAILED",
        "The review service is having trouble. Please try again shortly.",
      );
    }
  }
  return makeShareError(
    fallbackCode,
    err instanceof Error ? err.message : fallbackMessage,
    err instanceof Error ? err.message : String(err),
  );
}

/** Map a structured share error to a beginner-safe, human message. */
export function shareErrorMessage(error: ShareError): string {
  switch (error.code) {
    case "AUTH_REQUIRED":
      return "Sign in to share this website.";
    case "SESSION_EXPIRED":
      return "Your session ended. Sign in again to manage review links.";
    case "PERMISSION_DENIED":
      return "You don't have permission to do that.";
    case "OFFLINE":
      return "You're offline. Reconnect to create or manage review links.";
    case "NETWORK_FAILED":
      return "Couldn't reach the review service. Please try again.";
    case "RATE_LIMITED":
      return "Too many comments — please wait a moment and try again.";
    case "INVALID_TOKEN":
      return "This review link isn't working.";
    case "EXPIRED":
      return "This review link has expired.";
    case "REVOKED":
      return "This review link is no longer available.";
    case "FEEDBACK_DISABLED":
      return "Feedback isn't enabled for this review link.";
    case "NOT_FOUND":
      return "That review link could not be found.";
    case "PROJECT_NOT_FOUND":
      return "That project could not be found.";
    case "INVALID_INPUT":
      return "Please check your input and try again.";
    case "PROJECTION_TOO_LARGE":
      return "This website is too large to share right now. Try removing some large images.";
    case "NOT_CONFIGURED":
      return "Review links aren't set up for this app yet.";
    case "MALFORMED_RESPONSE":
      return "The review service returned an unexpected response. Please try again.";
    case "UNKNOWN":
    default:
      return error.message || "Sharing couldn't complete right now.";
  }
}
