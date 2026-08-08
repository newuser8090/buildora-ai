// ---------------------------------------------------------------------------
// Publishing — structured errors (Phase P7 + P8)
//
// User messages never expose provider secrets, raw stack traces, shell
// output, provider internals, or internal filesystem paths.
// ---------------------------------------------------------------------------

export type PublishErrorCode =
  // P7 — core pipeline
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
  // P8 — real production provider
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_PROJECT_FAILED"
  | "ARTIFACT_UPLOAD_FAILED"
  | "DEPLOYMENT_CREATE_FAILED"
  | "DEPLOYMENT_FAILED"
  | "DEPLOYMENT_CANCEL_FAILED"
  | "ROLLBACK_FAILED"
  | "DEPLOYMENT_ALREADY_ACTIVE"
  | "DEPLOYMENT_BUSY"
  | "DUPLICATE_PUBLISH"
  | "ARTIFACT_TOO_LARGE"
  | "ARTIFACT_INVALID"
  // P8 — custom domains
  | "DOMAIN_INVALID"
  | "DOMAIN_ATTACH_FAILED"
  | "DOMAIN_VERIFICATION_PENDING"
  | "DOMAIN_VERIFICATION_FAILED"
  | "DOMAIN_ALREADY_IN_USE"
  | "DOMAIN_NOT_FOUND"
  | "DOMAIN_LIMIT_REACHED"
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

// ---------------------------------------------------------------------------
// P8 — beginner-safe default messages per code
// ---------------------------------------------------------------------------

const DEFAULT_MESSAGES: Partial<Record<PublishErrorCode, string>> = {
  PROVIDER_AUTH_FAILED:
    "The publishing service couldn't verify its credentials. Please try again later.",
  PROVIDER_RATE_LIMITED:
    "Publishing is temporarily busy. Try again shortly.",
  PROVIDER_PROJECT_FAILED:
    "Your site's publishing space couldn't be prepared. Please try again.",
  ARTIFACT_UPLOAD_FAILED:
    "Uploading your site files failed. Please try again.",
  DEPLOYMENT_CREATE_FAILED:
    "Starting the publish failed. Please try again.",
  DEPLOYMENT_FAILED:
    "Your site couldn't finish publishing.",
  DEPLOYMENT_CANCEL_FAILED:
    "The publish couldn't be cancelled. It may have finished already.",
  ROLLBACK_FAILED:
    "Restoring that version failed. Please try again.",
  DEPLOYMENT_ALREADY_ACTIVE:
    "That version is already the live one.",
  DEPLOYMENT_BUSY:
    "This project is already being published. Wait for it to finish, then try again.",
  DUPLICATE_PUBLISH:
    "This version is already being published. The existing publish will continue.",
  ARTIFACT_TOO_LARGE:
    "Your site files are too large to publish this way. Try removing large images, or download the files instead.",
  ARTIFACT_INVALID:
    "Your site files couldn't be prepared for publishing.",
  DOMAIN_INVALID:
    "That doesn't look like a valid domain. Enter just the domain — no https:// needed.",
  DOMAIN_ATTACH_FAILED:
    "The domain couldn't be added. Please try again.",
  DOMAIN_VERIFICATION_PENDING:
    "Your domain is still connecting. DNS changes can take a little while.",
  DOMAIN_VERIFICATION_FAILED:
    "We couldn't verify your domain yet. Check the records below, then try again.",
  DOMAIN_ALREADY_IN_USE:
    "That domain is already connected to a project.",
  DOMAIN_NOT_FOUND:
    "That domain isn't connected to this project anymore.",
  DOMAIN_LIMIT_REACHED:
    "This project already has a connected domain.",
};

/** User-safe message for a code (falls back to a generic sentence). */
export function publishErrorMessage(
  code: PublishErrorCode,
  fallback = "Something went wrong. Please try again.",
): string {
  return DEFAULT_MESSAGES[code] ?? fallback;
}
