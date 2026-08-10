// ---------------------------------------------------------------------------
// Team Workspaces & Controlled Collaboration (Phase P14) — structured errors
//
// Deterministic, user-safe error construction (mirrors cloud-sync / sharing /
// publishing conventions). User-facing messages never expose SQL, stack
// traces, tokens, table names, or raw provider errors.
// ---------------------------------------------------------------------------

import type { WorkspaceError, WorkspaceErrorCode } from "./types";

export type { WorkspaceError, WorkspaceErrorCode } from "./types";

const RETRYABLE_CODES: ReadonlySet<WorkspaceErrorCode> = new Set([
  "OFFLINE",
  "NETWORK_FAILED",
  "RATE_LIMITED",
  "SESSION_EXPIRED",
  "MALFORMED_RESPONSE",
]);

export function makeWorkspaceError(
  code: WorkspaceErrorCode,
  message: string,
  cause?: string,
): WorkspaceError {
  return {
    code,
    message,
    cause,
    retryable: RETRYABLE_CODES.has(code),
  };
}

/** Normalize an unknown thrown value into a structured workspace error. */
export function toWorkspaceError(
  err: unknown,
  fallbackCode: WorkspaceErrorCode = "UNKNOWN",
  fallbackMessage = "This couldn't be completed right now.",
): WorkspaceError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as Partial<WorkspaceError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return makeWorkspaceError(
        candidate.code as WorkspaceErrorCode,
        candidate.message,
        candidate.cause ?? (err instanceof Error ? err.message : undefined),
      );
    }
  }
  if (err && typeof err === "object" && "statusCode" in err) {
    const rawStatus = (err as { statusCode?: unknown }).statusCode;
    const status = typeof rawStatus === "number" ? rawStatus : Number(rawStatus);
    if (status === 401) {
      return makeWorkspaceError(
        "SESSION_EXPIRED",
        "Your session ended. Sign in again to keep working with your team.",
      );
    }
    if (status === 403) {
      return makeWorkspaceError(
        "PERMISSION_DENIED",
        "You don't have permission to do that.",
      );
    }
    if (status === 404) {
      return makeWorkspaceError(
        "NOT_FOUND",
        "That workspace item could not be found.",
      );
    }
    if (status === 409) {
      return makeWorkspaceError(
        "STALE_REVISION",
        "This project changed since you opened it.",
      );
    }
    if (status === 429) {
      return makeWorkspaceError(
        "RATE_LIMITED",
        "Too many requests. Please wait a moment and try again.",
      );
    }
    if (status >= 500) {
      return makeWorkspaceError(
        "NETWORK_FAILED",
        "The workspace service is having trouble. Please try again shortly.",
      );
    }
  }
  return makeWorkspaceError(
    fallbackCode,
    err instanceof Error ? err.message : fallbackMessage,
    err instanceof Error ? err.message : String(err),
  );
}

/** Map a structured workspace error to beginner-safe copy. */
export function workspaceErrorMessage(error: WorkspaceError): string {
  switch (error.code) {
    case "AUTH_REQUIRED":
      return "Sign in to use workspaces.";
    case "SESSION_EXPIRED":
      return "Your session ended. Sign in again.";
    case "PERMISSION_DENIED":
      return "You don't have permission to do that.";
    case "OFFLINE":
      return "You're offline. Reconnect to work with your team.";
    case "NETWORK_FAILED":
      return "Couldn't reach the workspace service. Please try again.";
    case "RATE_LIMITED":
      return "Too many requests — please wait a moment and try again.";
    case "NOT_FOUND":
      return "That workspace item could not be found.";
    case "INVALID_NAME":
      return "Give your workspace a name.";
    case "INVALID_EMAIL":
      return "Please enter a valid email address.";
    case "INVALID_ROLE":
      return "Please choose a valid role.";
    case "INVALID_INPUT":
      return "Please check your input and try again.";
    case "ALREADY_MEMBER":
      return "That person is already in this workspace.";
    case "INVITE_INVALID":
      return "That invitation is no longer valid.";
    case "INVITE_EXPIRED":
      return "That invitation has expired. Ask the owner to invite you again.";
    case "STALE_REVISION":
      return "This project changed since you opened it. Reload the latest version before saving.";
    case "LEASE_HELD":
      return "Someone else is currently editing this project.";
    case "LEASE_INVALID":
      return "Your editing session ended. Reconnect to keep editing.";
    case "PROJECT_NOT_FOUND":
      return "That project could not be found.";
    case "PAYLOAD_TOO_LARGE":
      return "This project is too large to share with the workspace. Try removing some large images.";
    case "PAYLOAD_INVALID":
      return "This project couldn't be saved to the workspace because it isn't valid.";
    case "LAST_OWNER":
      return "A workspace must always have an owner.";
    case "NOT_CONFIGURED":
      return "Workspaces aren't set up for this app yet.";
    case "MALFORMED_RESPONSE":
      return "The workspace service returned an unexpected response. Please try again.";
    case "UNKNOWN":
    default:
      return error.message || "This couldn't be completed right now.";
  }
}
