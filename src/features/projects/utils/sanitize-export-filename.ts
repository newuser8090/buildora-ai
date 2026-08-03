// ---------------------------------------------------------------------------
// sanitizeExportFilename — create a safe, readable filename from a project name
// ---------------------------------------------------------------------------

import { BUILDORA_EXTENSION, DEFAULT_EXPORT_FILENAME } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum total filename length including extension. */
export const MAX_FILENAME_LENGTH = 100;

/** Characters that are removed from the sanitized name. */
const FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a safe export filename from a project name.
 *
 * Rules:
 * - Convert to lowercase
 * - Replace forbidden filesystem characters with empty string
 * - Collapse repeated whitespace to a single hyphen
 * - Trim leading/trailing separators
 * - Limit to MAX_FILENAME_LENGTH characters
 * - If result is empty, use DEFAULT_EXPORT_FILENAME
 * - Append `.buildora.json` exactly once
 *
 * @example
 * sanitizeExportFilename("Landing Page")      // "landing-page.buildora.json"
 * sanitizeExportFilename("My / Project?")     // "my-project.buildora.json"
 * sanitizeExportFilename("")                   // "buildora-project.buildora.json"
 * sanitizeExportFilename("  HELLO  WORLD  ")  // "hello-world.buildora.json"
 */
export function sanitizeExportFilename(projectName: string): string {
  // Normalize: lowercase, remove forbidden chars
  let sanitized = projectName
    .toLowerCase()
    .replace(FORBIDDEN_CHARS, "")
    .trim();

  // Collapse whitespace and repeated hyphens
  sanitized = sanitized
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  // Fallback for empty result
  if (!sanitized) {
    return DEFAULT_EXPORT_FILENAME;
  }

  // Limit length (reserve space for extension)
  const maxNameLength = MAX_FILENAME_LENGTH - BUILDORA_EXTENSION.length;
  if (sanitized.length > maxNameLength) {
    sanitized = sanitized.slice(0, maxNameLength).replace(/-+$/, "");
  }

  // Ensure extension is appended exactly once
  if (sanitized.endsWith(BUILDORA_EXTENSION)) {
    return sanitized;
  }

  return `${sanitized}${BUILDORA_EXTENSION}`;
}
