// ---------------------------------------------------------------------------
// Publishing — structured errors (Phase P7)
//
// User messages never expose provider secrets, raw stack traces, shell
// output, or internal filesystem paths.
// ---------------------------------------------------------------------------

export type PublishErrorCode =
  | "PROJECT_INVALID"
  | "EXPORT_INVALID"
  | "READINESS_BLOCKED"
  | "PROVIDER_UNAVAILABLE"
  | "AUTH_REQUIRED"
  | "BUILD_FAILED"
  | "UPLOAD_FAILED"
  | "DEPLOY_FAILED"
  | "RATE_LIMITED"
  | "NETWORK_FAILED"
  | "CANCELLED"
  | "DEPLOYMENT_NOT_FOUND"
  | "ROLLBACK_UNSUPPORTED"
  | "UNKNOWN";

export interface PublishError {
  code: PublishErrorCode;
  message: string;
}

export function makePublishError(
  code: PublishErrorCode,
  message: string,
): PublishError {
  return { code, message };
}

/** Map a user-facing message to a structured code (best-effort). */
export function toPublishError(
  err: unknown,
  fallbackCode: PublishErrorCode = "UNKNOWN",
): PublishError {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err
  ) {
    const e = err as { code: unknown; message: unknown };
    if (
      typeof e.code === "string" &&
      typeof e.message === "string"
    ) {
      return { code: e.code as PublishErrorCode, message: e.message };
    }
  }
  return {
    code: fallbackCode,
    message:
      err instanceof Error
        ? err.message
        : "Something went wrong. Please try again.",
  };
}
