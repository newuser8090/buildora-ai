// ---------------------------------------------------------------------------
// Project Transfer — shared types for import/export of Buildora projects
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Export envelope — the on-disk format for a Buildora project file
// ---------------------------------------------------------------------------

export interface BuildoraProjectExport {
  /** Fixed format marker — must be exactly "buildora-project" */
  format: "buildora-project";
  /** Integer format version. Current: 1. */
  formatVersion: number;
  /** ISO timestamp of when this file was exported. */
  exportedAt: string;
  /** Optional human-readable application version. */
  appVersion?: string;
  /** The serialized project data. */
  project: Project;
  /** Origin metadata for traceability. */
  metadata?: {
    originalProjectId: string;
    originalProjectName: string;
    originalCreatedAt: string;
    originalUpdatedAt: string;
  };
}

// ---------------------------------------------------------------------------
// Transfer error codes
// ---------------------------------------------------------------------------

export type ProjectTransferErrorCode =
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "INVALID_FILE_EXTENSION"
  | "FILE_READ_FAILED"
  | "INVALID_JSON"
  | "INVALID_EXPORT_ENVELOPE"
  | "UNSUPPORTED_FORMAT"
  | "UNSUPPORTED_FORMAT_VERSION"
  | "INVALID_PROJECT_DATA"
  | "PROJECT_MIGRATION_FAILED"
  | "PROJECT_DESERIALIZATION_FAILED"
  | "PROJECT_VALIDATION_FAILED"
  | "PROJECT_ID_CONFLICT"
  | "PROJECT_NAME_CONFLICT"
  | "IMPORT_SAVE_FAILED"
  | "EXPORT_SERIALIZATION_FAILED"
  | "DOWNLOAD_FAILED"
  | "PROJECT_NOT_FOUND"
  | "UNKNOWN_TRANSFER_ERROR";

export interface ProjectTransferError {
  code: ProjectTransferErrorCode;
  message: string;
  cause?: unknown;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Export result
// ---------------------------------------------------------------------------

export type ExportProjectResult =
  | {
      ok: true;
      filename: string;
      content: string;
      envelope: BuildoraProjectExport;
    }
  | {
      ok: false;
      error: ProjectTransferError;
    };

// ---------------------------------------------------------------------------
// Import preview — returned after parsing, before commit
// ---------------------------------------------------------------------------

export interface ImportProjectPreview {
  sourceFilename: string;
  project: Project;
  originalProjectId: string;
  originalProjectName: string;
  schemaVersion: number;
  migrationApplied: boolean;
  warnings: ImportProjectWarning[];
}

export interface ImportProjectWarning {
  code: ProjectImportWarningCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Import warning codes
// ---------------------------------------------------------------------------

export type ProjectImportWarningCode =
  | "FILE_EXTENSION_NOT_BUILDORA"
  | "MIGRATION_APPLIED"
  | "PROJECT_ID_REGENERATED"
  | "PROJECT_NAME_CHANGED"
  | "UNKNOWN_OPTIONAL_FIELD_IGNORED"
  | "LEGACY_TIMESTAMP_RECOVERED";

// ---------------------------------------------------------------------------
// Import result
// ---------------------------------------------------------------------------

export type ParseProjectImportResult =
  | {
      ok: true;
      preview: ImportProjectPreview;
    }
  | {
      ok: false;
      error: ProjectTransferError;
    };

// ---------------------------------------------------------------------------
// Commit result
// ---------------------------------------------------------------------------

export interface CommitImportedProjectResult {
  ok: true;
  project: Project;
  summary: {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    pageCount: number;
    assetCount: number;
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExportProjectOptions {
  exportedAt?: string;
  appVersion?: string;
}

export interface ImportProjectOptions {
  preserveProjectId?: boolean;
  importedAt?: string;
}

export interface CommitImportedProjectOptions {
  name?: string;
  preserveCreatedAt?: boolean;
  importedAt?: string;
}

// ---------------------------------------------------------------------------
// Read/Download results
// ---------------------------------------------------------------------------

export type ReadProjectFileResult =
  | { ok: true; text: string }
  | { ok: false; error: ProjectTransferError };

// ---------------------------------------------------------------------------
// User-facing message mapping
// ---------------------------------------------------------------------------

/**
 * Map a ProjectTransferError to a user-safe message string.
 * Falls back to the error's own message for unknown codes.
 */
export function mapProjectTransferErrorToMessage(
  error: ProjectTransferError,
): string {
  switch (error.code) {
    case "FILE_TOO_LARGE":
      return "The selected file is too large. Maximum file size is 10 MB.";
    case "EMPTY_FILE":
      return "The selected file is empty.";
    case "INVALID_FILE_EXTENSION":
      return "Please select a .buildora.json file.";
    case "FILE_READ_FAILED":
      return "Could not read the selected file. Please try again.";
    case "INVALID_JSON":
      return "The file contains invalid JSON and could not be parsed.";
    case "INVALID_EXPORT_ENVELOPE":
      return "The file does not appear to be a valid Buildora project export.";
    case "UNSUPPORTED_FORMAT":
      return "This file is not a Buildora project file.";
    case "UNSUPPORTED_FORMAT_VERSION":
      return "This project was created by a newer version of Buildora and cannot be imported.";
    case "INVALID_PROJECT_DATA":
      return "The project data in this file is invalid.";
    case "PROJECT_MIGRATION_FAILED":
      return "The project could not be migrated from an older format version.";
    case "PROJECT_DESERIALIZATION_FAILED":
      return "The project data could not be read.";
    case "PROJECT_VALIDATION_FAILED":
      return "The project data did not pass validation checks.";
    case "PROJECT_ID_CONFLICT":
      return "A project with the same ID already exists.";
    case "PROJECT_NAME_CONFLICT":
      return "A project with this name already exists.";
    case "IMPORT_SAVE_FAILED":
      return "The imported project could not be saved.";
    case "EXPORT_SERIALIZATION_FAILED":
      return "The project could not be exported.";
    case "DOWNLOAD_FAILED":
      return "The download could not be started.";
    case "PROJECT_NOT_FOUND":
      return error.message || "The project could not be found.";
    case "UNKNOWN_TRANSFER_ERROR":
    default:
      return error.message || "An unexpected error occurred.";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current export envelope format version. */
export const EXPORT_FORMAT_VERSION = 1;

/** Fixed format marker for Buildora project exports. */
export const EXPORT_FORMAT_MARKER = "buildora-project" as const;

/** Maximum file size for import (10 MB). */
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Import limits policy (documented — enforced, never silently truncated)
// ---------------------------------------------------------------------------
//
// File size .............. 10 MB (MAX_IMPORT_FILE_SIZE)
// Pages .................. 100 total
// Sections ............... 2,000 total across ALL pages
// Assets ................. 2,000 total
// Project name ........... canonical limit (validateProjectName — 80 chars)
// Individual text field .. 5,000 characters (MAX_TEXT_FIELD_LENGTH),
//                           checked consistently for nested text fields
// Structural depth ....... 20 levels (MAX_IMPORT_STRUCTURAL_DEPTH),
//                           enforced via explicit schema traversal
//
// Every violation returns a structured ProjectTransferError whose `details`
// carries: { limit, actual, max, path }. Violations are rejected — data is
// never truncated.
// ---------------------------------------------------------------------------

/** Default fallback filename when sanitized name is empty. */
export const DEFAULT_EXPORT_FILENAME = "buildora-project.buildora.json";

/** File extension for Buildora project files. */
export const BUILDORA_EXTENSION = ".buildora.json";
