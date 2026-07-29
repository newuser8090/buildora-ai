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
