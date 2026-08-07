// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — structured errors
//
// Deterministic, user-safe error construction. Mirrors the persistence /
// my-blocks error conventions. User-facing messages never expose SQL, stack
// traces, tokens, table names, or raw provider errors.
// ---------------------------------------------------------------------------

import type { CloudSyncError, CloudSyncErrorCode } from "./types";

export type { CloudSyncError, CloudSyncErrorCode } from "./types";

const RETRYABLE_CODES: ReadonlySet<CloudSyncErrorCode> = new Set([
  "OFFLINE",
  "NETWORK_FAILED",
  "RATE_LIMITED",
  "STORAGE_QUOTA",
  "SESSION_EXPIRED",
]);

export function makeCloudSyncError(
  code: CloudSyncErrorCode,
  message: string,
  cause?: string,
): CloudSyncError {
  return {
    code,
    message,
    cause,
    retryable: RETRYABLE_CODES.has(code),
  };
}

/** Normalize an unknown thrown value into a structured cloud error. */
export function toCloudSyncError(
  err: unknown,
  fallbackCode: CloudSyncErrorCode = "UNKNOWN",
  fallbackMessage = "Cloud sync could not complete right now.",
): CloudSyncError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as Partial<CloudSyncError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return makeCloudSyncError(
        candidate.code as CloudSyncErrorCode,
        candidate.message,
        candidate.cause ?? (err instanceof Error ? err.message : undefined),
      );
    }
  }
  if (err && typeof err === "object" && "statusCode" in err) {
    // Provider-level HTTP errors map to safe codes (never leak the raw body).
    const rawStatus = (err as { statusCode?: unknown }).statusCode;
    const status =
      typeof rawStatus === "number" ? rawStatus : Number(rawStatus);
    if (status === 401 || status === 403) {
      return makeCloudSyncError(
        "SESSION_EXPIRED",
        "Your session ended. Sign in again to keep syncing.",
      );
    }
    if (status === 429) {
      return makeCloudSyncError(
        "RATE_LIMITED",
        "Too many syncs in a row. Buildora will try again shortly.",
      );
    }
    if (status >= 500) {
      return makeCloudSyncError(
        "NETWORK_FAILED",
        "The sync service is having trouble. Your work is safe on this device.",
      );
    }
  }
  return makeCloudSyncError(
    fallbackCode,
    err instanceof Error ? err.message : fallbackMessage,
    err instanceof Error ? err.message : String(err),
  );
}

/** Map a code to a user-safe, beginner-friendly message. */
export function cloudSyncErrorMessage(error: CloudSyncError): string {
  switch (error.code) {
    case "AUTH_REQUIRED":
    case "SESSION_EXPIRED":
      return "Sign in to back up your saved pieces.";
    case "OFFLINE":
      return "You're offline — changes are saved on this device and will sync when you're back online.";
    case "NETWORK_FAILED":
      return "Couldn't reach the backup service. Your work is safe on this device.";
    case "RATE_LIMITED":
      return "Syncing too quickly. Buildora will try again in a moment.";
    case "REMOTE_VALIDATION_FAILED":
    case "UNSUPPORTED_REMOTE_VERSION":
      return "A cloud copy couldn't be read. Sync needs attention.";
    case "CONFLICT":
      return "Two versions of a saved piece need your review.";
    case "PERMISSION_DENIED":
      return "You don't have access to that shared library.";
    case "INVITE_EXPIRED":
      return "That invitation has expired. Ask the owner to invite you again.";
    case "INVITE_INVALID":
      return "That invitation is no longer valid.";
    case "STORAGE_QUOTA":
      return "This device is running low on storage. Free up space and try again.";
    case "SYNC_CANCELLED":
      return "Sync was cancelled.";
    case "NOT_CONFIGURED":
      return "Cloud backup isn't set up for this app yet.";
    case "UNKNOWN":
    default:
      return error.message || "Cloud sync could not complete right now.";
  }
}
