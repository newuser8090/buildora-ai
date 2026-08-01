// ---------------------------------------------------------------------------
// Thumbnails — error factory
//
// Stable error codes with user-safe messages. Never exposes raw stack traces.
// ---------------------------------------------------------------------------

import type { ThumbnailError, ThumbnailErrorCode } from "./types";

const DEFAULT_MESSAGES: Record<ThumbnailErrorCode, string> = {
  RENDER_TARGET_UNAVAILABLE:
    "Could not create a preview surface for the thumbnail.",
  RENDER_FAILED: "The project preview could not be rendered.",
  ENCODING_UNSUPPORTED:
    "Image encoding is not supported in this browser.",
  ENCODING_FAILED: "The thumbnail could not be encoded as an image.",
  CANVAS_TAINTED:
    "The preview contains an image that cannot be captured safely.",
  IMAGE_LOAD_FAILED: "A project image failed to load for the preview.",
  STORAGE_FAILED: "The thumbnail could not be saved to storage.",
  STALE_REVISION: "A newer thumbnail already exists for this project.",
  PROJECT_NOT_FOUND: "The project could not be found.",
  GENERATION_CANCELLED: "Thumbnail generation was cancelled.",
  UNKNOWN_THUMBNAIL_ERROR: "An unexpected error occurred while generating the thumbnail.",
};

export function makeThumbnailError(
  code: ThumbnailErrorCode,
  options?: {
    message?: string;
    projectId?: string;
    revision?: number;
    retryable?: boolean;
    cause?: string;
  },
): ThumbnailError {
  return {
    code,
    message: options?.message ?? DEFAULT_MESSAGES[code],
    projectId: options?.projectId,
    revision: options?.revision,
    retryable: options?.retryable,
    cause: options?.cause,
  };
}

/** Normalize an unknown thrown value into a structured ThumbnailError. */
export function toThumbnailError(
  err: unknown,
  fallbackCode: ThumbnailErrorCode = "UNKNOWN_THUMBNAIL_ERROR",
  options?: { projectId?: string; revision?: number; retryable?: boolean },
): ThumbnailError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as ThumbnailError;
    const known = Object.prototype.hasOwnProperty.call(
      DEFAULT_MESSAGES,
      candidate.code,
    );
    if (known) {
      return {
        ...candidate,
        projectId: candidate.projectId ?? options?.projectId,
        revision: candidate.revision ?? options?.revision,
      };
    }
  }
  return makeThumbnailError(fallbackCode, {
    projectId: options?.projectId,
    revision: options?.revision,
    retryable: options?.retryable,
    cause: err instanceof Error ? err.message : String(err),
  });
}

/** Convenience helpers for common codes. */
export const thumbnailErrors = {
  renderTargetUnavailable(projectId?: string, revision?: number) {
    return makeThumbnailError("RENDER_TARGET_UNAVAILABLE", { projectId, revision, retryable: true });
  },
  renderFailed(projectId?: string, revision?: number, cause?: string) {
    return makeThumbnailError("RENDER_FAILED", { projectId, revision, retryable: true, cause });
  },
  encodingUnsupported(projectId?: string, revision?: number) {
    return makeThumbnailError("ENCODING_UNSUPPORTED", { projectId, revision, retryable: false });
  },
  encodingFailed(projectId?: string, revision?: number, cause?: string) {
    return makeThumbnailError("ENCODING_FAILED", { projectId, revision, retryable: true, cause });
  },
  canvasTainted(projectId?: string, revision?: number) {
    return makeThumbnailError("CANVAS_TAINTED", { projectId, revision, retryable: false });
  },
  imageLoadFailed(projectId?: string, revision?: number) {
    return makeThumbnailError("IMAGE_LOAD_FAILED", { projectId, revision, retryable: true });
  },
  storageFailed(projectId?: string, revision?: number, cause?: string) {
    return makeThumbnailError("STORAGE_FAILED", { projectId, revision, retryable: true, cause });
  },
  staleRevision(projectId?: string, revision?: number) {
    return makeThumbnailError("STALE_REVISION", { projectId, revision, retryable: false });
  },
  projectNotFound(projectId?: string) {
    return makeThumbnailError("PROJECT_NOT_FOUND", { projectId, retryable: false });
  },
  cancelled(projectId?: string, revision?: number) {
    return makeThumbnailError("GENERATION_CANCELLED", { projectId, revision, retryable: false });
  },
};
