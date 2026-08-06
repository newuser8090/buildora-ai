// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — structured errors
//
// Deterministic, user-safe error construction. Mirrors the persistence and
// thumbnail error conventions. No React, no Zustand.
// ---------------------------------------------------------------------------

import type { MyBlockError, MyBlockErrorCode } from "./types";

export function makeMyBlockError(
  code: MyBlockErrorCode,
  message: string,
  cause?: string,
): MyBlockError {
  return { code, message, cause };
}

/** Normalize an unknown thrown value into a structured MyBlockError. */
export function toMyBlockError(
  err: unknown,
  fallbackCode: MyBlockErrorCode = "UNKNOWN_ERROR",
  fallbackMessage = "Something went wrong while using your saved blocks.",
): MyBlockError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as Partial<MyBlockError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return makeMyBlockError(
        candidate.code as MyBlockErrorCode,
        candidate.message,
        candidate.cause ?? (err instanceof Error ? err.message : undefined),
      );
    }
  }
  return makeMyBlockError(
    fallbackCode,
    err instanceof Error ? err.message : fallbackMessage,
    err instanceof Error ? err.message : String(err),
  );
}

/** Map an IndexedDB DOMException to a structured error. */
export function mapMyBlockDomException(
  error: DOMException | null | undefined,
  fallbackCode: MyBlockErrorCode = "TRANSACTION_FAILED",
  fallbackMessage = "The saved block could not be written to storage.",
): MyBlockError {
  if (!error) return makeMyBlockError(fallbackCode, fallbackMessage);
  if (error.name === "QuotaExceededError") {
    return makeMyBlockError(
      "QUOTA_EXCEEDED",
      "Your browser's storage is full. Delete a saved block or free up space, then try again.",
      error.message,
    );
  }
  if (error.name === "TransactionInactiveError" || error.name === "AbortError") {
    return makeMyBlockError(fallbackCode, fallbackMessage, error.message);
  }
  return makeMyBlockError(
    fallbackCode,
    error.message || fallbackMessage,
    error.message,
  );
}

/** Map quota + oversized records to user-safe quota errors. */
export function quotaErrorFor(bytes: number, limit: number): MyBlockError {
  return makeMyBlockError(
    "RECORD_TOO_LARGE",
    `This saved block is too large to store (about ${formatBytes(bytes)}, the limit is ${formatBytes(limit)}).`,
    `Record size ${bytes} exceeds limit ${limit}.`,
  );
}

/**
 * User-safe error when the whole library would exceed the recommended size.
 * Used by the adapter before any write — no silent data loss.
 */
export function libraryQuotaError(
  usedBytes: number,
  incomingBytes: number,
  limit: number,
): MyBlockError {
  const total = usedBytes + incomingBytes;
  return makeMyBlockError(
    "QUOTA_EXCEEDED",
    `Your saved-block library is full (about ${formatBytes(total)} of ${formatBytes(limit)}). Delete a saved block or free up space, then try again.`,
    `Library size ${total} exceeds recommended limit ${limit}.`,
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
