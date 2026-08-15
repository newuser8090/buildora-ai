// ---------------------------------------------------------------------------
// Provider error codes
// ---------------------------------------------------------------------------

export const ERROR_CODES = {
  MISSING_API_KEY: "MISSING_API_KEY",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_NETWORK: "PROVIDER_NETWORK",
  PROVIDER_RATE_LIMIT: "PROVIDER_RATE_LIMIT",
  PROVIDER_AUTH: "PROVIDER_AUTH",
  INVALID_SCHEMA: "INVALID_SCHEMA",
  EMPTY_RESPONSE: "EMPTY_RESPONSE",
  MALFORMED_JSON: "MALFORMED_JSON",
  BLOCKED_CONTENT: "BLOCKED_CONTENT",
  UNKNOWN: "UNKNOWN",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// ---------------------------------------------------------------------------
// Abort / timeout detection
//
// A client-side abort surfaces as a DOMException ("AbortError" from
// AbortController.abort(), "TimeoutError" from AbortSignal.timeout()). The
// @google/genai SDK wraps both: fetch aborts become "RequestAbortedError" and
// signal timeouts become "RequestTimeoutError", each carrying the original
// error on `cause`. Checking the cause chain keeps classification correct
// regardless of which layer raised it.
//
// Timeouts are deliberately NOT retryable: retrying a hung request only
// doubles the wait (the /api/generate path must fall back to rule-based
// within the client's ~30s budget).
// ---------------------------------------------------------------------------

export function isAbortOrTimeoutError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    const name = current.name;
    if (
      name === "AbortError" ||
      name === "TimeoutError" ||
      name === "RequestAbortedError" ||
      name === "RequestTimeoutError"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Typed provider error
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
