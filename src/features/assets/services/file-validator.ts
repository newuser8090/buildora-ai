// ---------------------------------------------------------------------------
// File Validator
//
// Validates upload file suitability based on MIME type, extension, and size.
// All checks are case-insensitive for extensions.
// Returns structured, user-friendly validation results.
// ---------------------------------------------------------------------------

import { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE_BYTES } from "../schemas/asset-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationErrorCode =
  | "UNSUPPORTED_MIME_TYPE"
  | "UNSUPPORTED_EXTENSION"
  | "MIME_EXTENSION_MISMATCH"
  | "FILE_TOO_LARGE"
  | "FILE_EMPTY";

export interface ValidationResult {
  valid: boolean;
  /** User-friendly error message when valid is false */
  error?: string;
  /** Machine-readable error code */
  errorCode?: ValidationErrorCode;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_EXTENSIONS_SET = new Set(ALLOWED_EXTENSIONS.map((ext) => ext.toLowerCase()));
const VALID_MIME_SET = new Set(ALLOWED_MIME_TYPES as readonly string[]);

/** MIME type → canonical extension mapping (for validation and export) */
export const MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
};

/** Extension → MIME type mapping (case-insensitive, stored lowercase) */
export const EXTENSION_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the extension from a filename, case-preserved if valid. */
function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a file for upload.
 * Checks MIME type, extension (case-insensitive), MIME/extension agreement,
 * and file size.
 */
export function validateFile(
  file: { name: string; type: string; size: number },
): ValidationResult {
  // 1. Empty file check
  if (file.size === 0) {
    return {
      valid: false,
      error: "File is empty. Please select a non-empty file.",
      errorCode: "FILE_EMPTY",
    };
  }

  // 2. Size check
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    const maxMB = MAX_UPLOAD_SIZE_BYTES / (1024 * 1024);
    const fileMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size (${fileMB} MB) exceeds the maximum allowed size of ${maxMB} MB.`,
      errorCode: "FILE_TOO_LARGE",
    };
  }

  // 3. MIME type check
  if (!VALID_MIME_SET.has(file.type)) {
    // Build a human-readable list of supported types
    const supported = ALLOWED_MIME_TYPES.map((m) => {
      const ext = MIME_TO_EXTENSION[m] || "";
      return `${ext} (${m})`;
    }).join(", ");
    return {
      valid: false,
      error: `Unsupported file type "${file.type}". Supported types: ${supported}.`,
      errorCode: "UNSUPPORTED_MIME_TYPE",
    };
  }

  // 4. Extension check
  const ext = extractExtension(file.name);
  if (!ext || !VALID_EXTENSIONS_SET.has(ext)) {
    const supported = ALLOWED_EXTENSIONS.join(", ");
    return {
      valid: false,
      error: `Unsupported file extension. Supported extensions: ${supported}.`,
      errorCode: "UNSUPPORTED_EXTENSION",
    };
  }

  // 5. MIME/extension agreement
  const expectedMime = EXTENSION_TO_MIME[ext];
  if (expectedMime && expectedMime !== file.type) {
    return {
      valid: false,
      error: `File type mismatch: MIME type "${file.type}" does not match the file extension "${ext}".`,
      errorCode: "MIME_EXTENSION_MISMATCH",
    };
  }

  return { valid: true };
}

/**
 * Get the canonical extension for a MIME type. Returns undefined for
 * unsupported MIME types.
 */
export function getCanonicalExtension(mimeType: string): string | undefined {
  return MIME_TO_EXTENSION[mimeType];
}

/**
 * Get the MIME type for a file extension (case-insensitive).
 * Returns undefined for unsupported extensions.
 */
export function getMimeForExtension(extension: string): string | undefined {
  const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return EXTENSION_TO_MIME[normalized];
}
