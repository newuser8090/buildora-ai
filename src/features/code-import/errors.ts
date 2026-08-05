// ---------------------------------------------------------------------------
// Universal Block Import — structured errors (Phase P1)
//
// Errors are user-safe, deterministic, serializable and free of raw stack
// traces. Fatal errors abort parsing/normalization and are converted into
// CodeImportError entries by the analysis entry point.
// ---------------------------------------------------------------------------

import type { CodeImportError, ImportSourceLocation } from "./types";

export interface CodeImportErrorOptions {
  limit?: number;
  actual?: number;
  path?: string;
  sourceLocation?: ImportSourceLocation;
}

export function createCodeImportError(
  code: string,
  message: string,
  options: CodeImportErrorOptions = {},
): CodeImportError {
  return {
    code,
    message,
    limit: options.limit,
    actual: options.actual,
    path: options.path,
    sourceLocation: options.sourceLocation,
  };
}

/** Structured fatal error thrown during parsing/normalization. */
export class CodeImportFatalError extends Error {
  readonly error: CodeImportError;

  constructor(error: CodeImportError) {
    super(error.message);
    this.name = "CodeImportFatalError";
    this.error = error;
  }
}

export function throwFatal(
  code: string,
  message: string,
  options: CodeImportErrorOptions = {},
): never {
  throw new CodeImportFatalError(createCodeImportError(code, message, options));
}

/**
 * Sanitize a parser error message: keep only the first line, drop anything
 * that looks like a stack frame or embedded source dump.
 */
export function sanitizeParserMessage(raw: string): string {
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim().slice(0, 500) || "Parser failed";
}
