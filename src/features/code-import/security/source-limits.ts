// ---------------------------------------------------------------------------
// Source limits (Phase P1)
//
// Pure helpers for limit enforcement. Enforced before or during normalization
// by the parsers/analyser; violations surface as structured CodeImportError
// entries carrying limit + actual. Nothing is ever silently truncated.
// ---------------------------------------------------------------------------

import {
  CODE_IMPORT_TOO_LARGE,
  MAX_SOURCE_SIZE_BYTES,
} from "../constants";
import { createCodeImportError } from "../errors";
import type { CodeImportError } from "../types";

/** UTF-8 byte size of a string (Node + browsers via TextEncoder). */
export function sourceByteSize(source: string): number {
  return new TextEncoder().encode(source).length;
}

export function exceedsSourceSize(source: string): boolean {
  return sourceByteSize(source) > MAX_SOURCE_SIZE_BYTES;
}

/**
 * Returns a CODE_IMPORT_TOO_LARGE error when the source exceeds the 200 KB
 * cap, otherwise null. Deterministic.
 */
export function checkSourceSize(source: string): CodeImportError | null {
  const actual = sourceByteSize(source);
  if (actual > MAX_SOURCE_SIZE_BYTES) {
    return createCodeImportError(
      CODE_IMPORT_TOO_LARGE,
      `Source is ${actual} bytes; the maximum allowed is ${MAX_SOURCE_SIZE_BYTES} bytes (200 KB).`,
      { limit: MAX_SOURCE_SIZE_BYTES, actual },
    );
  }
  return null;
}
