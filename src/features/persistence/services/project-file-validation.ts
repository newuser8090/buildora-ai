// ---------------------------------------------------------------------------
// Project File Validation
//
// Pure utilities for validating imported project files and generating
// deterministic download filenames. No browser APIs, no React, no storage.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { sanitiseFolderName } from "@/features/export/formatters/jsx-formatter";
import {
  ACCEPTED_PROJECT_EXTENSIONS,
  MAX_PROJECT_FILE_SIZE_BYTES,
} from "../constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectFileMetadataResult {
  valid: boolean;
  error?: string;
}

export interface FileMetadata {
  filename?: string;
  size?: number;
  mimeType?: string;
}

// ---------------------------------------------------------------------------
// Validate file metadata before parsing
// ---------------------------------------------------------------------------

/**
 * Validate an imported project file's metadata before attempting to parse.
 *
 * Checks:
 * - Filename extension is accepted (case-insensitive)
 * - File size is within the configured maximum
 * - Does not depend solely on browser-reported MIME type
 */
export function validateProjectFileMetadata(
  metadata: FileMetadata,
  options?: { maxSizeBytes?: number },
): ProjectFileMetadataResult {
  const { filename, size, mimeType } = metadata;

  // Must have a filename
  if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
    return { valid: false, error: "File must have a name." };
  }

  // Validate extension (case-insensitive)
  const ext = getExtension(filename.toLowerCase());
  if (!ext) {
    return {
      valid: false,
      error: `File "${filename}" has no recognizable extension. Accepted: ${ACCEPTED_PROJECT_EXTENSIONS.join(", ")}`,
    };
  }

  const accepted = ACCEPTED_PROJECT_EXTENSIONS.map((e) => e.toLowerCase());
  if (!accepted.includes(ext.toLowerCase())) {
    return {
      valid: false,
      error: `Unsupported file type ".${ext}". Accepted: ${ACCEPTED_PROJECT_EXTENSIONS.join(", ")}`,
    };
  }

  // Check size
  if (size !== undefined && size !== null) {
    const maxSize = options?.maxSizeBytes ?? MAX_PROJECT_FILE_SIZE_BYTES;
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
      return { valid: false, error: "Invalid file size." };
    }
    if (size > maxSize) {
      const sizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      return {
        valid: false,
        error: `File is too large. Maximum allowed size is ${sizeMB} MB.`,
      };
    }
  }

  // MIME type is advisory only — don't reject based solely on it
  // But if it's explicitly wrong, warn
  if (mimeType && mimeType !== "application/json" && mimeType !== "application/octet-stream" && !mimeType.includes("text")) {
    // Not blocking — the file extension check is authoritative
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Project filename generation for download
// ---------------------------------------------------------------------------

/**
 * Create a deterministic, sanitized filename for a downloadable project file.
 *
 * Examples:
 *   "My Project" → "my-project.buildora.json"
 *   "" → "project.buildora.json"
 *   "../etc" → "etc.buildora.json"
 */
export function createProjectFilename(project: Pick<Project, "name">): string {
  const sanitized = sanitiseFolderName(project.name || "") || "project";
  return `${sanitized}.buildora.json`;
}

// ---------------------------------------------------------------------------
// Extract extension from filename (case-preserving for validation)
// ---------------------------------------------------------------------------

/**
 * Get the file extension from a filename, supporting multi-dot filenames.
 *
 * "project.buildora.json" → ".json" (takes last extension)
 * "logo.PNG" → ".PNG"
 * "readme" → ""
 * ".gitignore" → ""
 */
export function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return "";
  return filename.slice(lastDot);
}
