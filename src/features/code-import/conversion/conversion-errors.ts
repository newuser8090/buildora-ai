// ---------------------------------------------------------------------------
// Universal Block Import (Phase P2) — structured conversion errors
//
// Conversion failures are user-safe, deterministic, serializable and free of
// raw stack traces. Fatal errors abort conversion and are surfaced by the
// orchestrator as structured failures. No React, no DOM, no store.
// ---------------------------------------------------------------------------

export type ConversionErrorCode =
  | "CONVERSION_NOT_ALLOWED"
  | "NO_CONVERTIBLE_CONTENT"
  | "INVALID_OUTPUT_TREE"
  | "UNKNOWN_CONVERSION_ERROR";

export interface ConversionError {
  code: ConversionErrorCode;
  message: string;
  /** Optional structured detail (e.g. the first tree validation problem). */
  detail?: string;
}

export interface ConversionFailure {
  ok: false;
  error: ConversionError;
}

export type ConversionResult<T> =
  | { ok: true; value: T }
  | ConversionFailure;

export function createConversionError(
  code: ConversionErrorCode,
  message: string,
  detail?: string,
): ConversionError {
  return { code, message, detail };
}

/** Structured fatal error thrown during conversion (aborts the run). */
export class ConversionFatalError extends Error {
  readonly error: ConversionError;

  constructor(error: ConversionError) {
    super(error.message);
    this.name = "ConversionFatalError";
    this.error = error;
  }
}

export function throwConversionFatal(
  code: ConversionErrorCode,
  message: string,
  detail?: string,
): never {
  throw new ConversionFatalError(createConversionError(code, message, detail));
}

// ---------------------------------------------------------------------------
// Deterministic block id factory (mirrors P1's ImportIdFactory contract)
// ---------------------------------------------------------------------------

export interface ConversionIdFactory {
  next(prefix?: string): string;
}

/**
 * Default conversion id factory — a plain counter, never Math.random. Tests
 * inject factories so converted block ids are fully deterministic.
 */
export function createConversionIdFactory(prefix = "conv"): ConversionIdFactory {
  let counter = 0;
  return {
    next(requestedPrefix?: string): string {
      counter += 1;
      return `${requestedPrefix ?? prefix}-${counter}`;
    },
  };
}
