// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — shared types + error taxonomy
//
// Mirrors the project-transfer conventions (structured errors, user-safe
// message mapping, parse/commit separation). No React, no browser APIs beyond
// Blob in result types.
// ---------------------------------------------------------------------------

import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import type { TemplateCategory } from "@/features/templates/types";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

export interface TemplatePackageAssetEntry {
  /** Deterministic, sanitized package path, e.g. "assets/asset-0001.png". */
  path: string;
  /** Original asset id (provenance only — never authoritative). */
  assetId: string;
  /** Original asset name (<= 256 chars). */
  name: string;
  /** Must be an allowed image MIME type. */
  mimeType: string;
  /** Must agree with mimeType. */
  extension: string;
  /** Decoded byte size (recomputed on import). */
  size: number;
}

export interface TemplatePackageManifest {
  format: "buildora-template";
  formatVersion: number;
  packageType: "template" | "project";
  exportedAt: string;
  assetCount: number;
  totalAssetBytes: number;
  assets: TemplatePackageAssetEntry[];
}

// ---------------------------------------------------------------------------
// Payload types (template.json)
// ---------------------------------------------------------------------------

export interface TemplatePackageMeta {
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplatePackagePayload {
  template: TemplatePackageMeta;
  /**
   * Project snapshot with assets EXTERNALIZED: each asset's source.value is the
   * package path (e.g. "assets/asset-0001.png") instead of a data URL. The
   * importer restores canonical data URLs before persistence.
   */
  project: Project;
}

// ---------------------------------------------------------------------------
// Import preview
// ---------------------------------------------------------------------------

export interface TemplateImportPreviewInfo {
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  pageCount: number;
  sectionCount: number;
  assetCount: number;
  /** Compressed package file size in bytes (approximate). */
  packageSizeBytes: number;
  formatVersion: number;
  /** Always true — incompatible packages never reach the preview. */
  formatCompatible: true;
  warnings: string[];
  originalName: string;
}

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

export type TemplatePackageErrorCode =
  | "INVALID_FILE_TYPE"
  | "FILE_READ_FAILED"
  | "PACKAGE_TOO_LARGE"
  | "ARCHIVE_INVALID"
  | "ARCHIVE_TOO_MANY_FILES"
  | "ARCHIVE_TOO_LARGE"
  | "ARCHIVE_ENTRY_UNSAFE"
  | "MANIFEST_MISSING"
  | "MANIFEST_INVALID"
  | "FORMAT_UNSUPPORTED"
  | "FORMAT_TOO_NEW"
  | "WRONG_PACKAGE_TYPE"
  | "TEMPLATE_INVALID"
  | "ASSET_MISSING"
  | "ASSET_INVALID"
  | "ASSET_TOO_LARGE"
  | "DOWNLOAD_FAILED"
  | "EXPORT_FAILED"
  | "IMPORT_FAILED";

export interface TemplatePackageError {
  code: TemplatePackageErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Internal technical detail — never displayed raw. */
  cause?: unknown;
  details?: Record<string, unknown>;
}

export function makeTemplatePackageError(
  code: TemplatePackageErrorCode,
  message: string,
  cause?: unknown,
  details?: Record<string, unknown>,
): TemplatePackageError {
  return { code, message, cause, details };
}

/** Normalize an unknown thrown value into a structured package error. */
export function toTemplatePackageError(
  err: unknown,
  fallbackCode: TemplatePackageErrorCode = "IMPORT_FAILED",
  fallbackMessage = "This template could not be read.",
): TemplatePackageError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as Partial<TemplatePackageError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return makeTemplatePackageError(
        candidate.code as TemplatePackageErrorCode,
        candidate.message,
        candidate.cause ?? (err instanceof Error ? err.message : undefined),
        candidate.details,
      );
    }
  }
  return makeTemplatePackageError(
    fallbackCode,
    err instanceof Error ? err.message : fallbackMessage,
    err instanceof Error ? err.message : String(err),
  );
}

/**
 * Map a package error to beginner-safe copy. Never exposes parser internals,
 * stack traces, zod dumps, or filesystem paths.
 */
export function mapTemplatePackageErrorToMessage(
  error: TemplatePackageError,
): string {
  switch (error.code) {
    case "INVALID_FILE_TYPE":
      return "Please choose a .buildora-template file.";
    case "FILE_READ_FAILED":
      return "The file could not be read. Please try again.";
    case "PACKAGE_TOO_LARGE":
      return "This template package is too large to import.";
    case "ARCHIVE_INVALID":
      return "This file is damaged or is not a Buildora template.";
    case "ARCHIVE_TOO_MANY_FILES":
      return "This template package contains too many files.";
    case "ARCHIVE_TOO_LARGE":
      return "This template package expands beyond the supported size.";
    case "ARCHIVE_ENTRY_UNSAFE":
      return "This template package contains an unsafe file entry.";
    case "MANIFEST_MISSING":
      return "This file is missing its template information.";
    case "MANIFEST_INVALID":
      return "This file is not a valid Buildora template.";
    case "FORMAT_UNSUPPORTED":
      return "This file is not a supported Buildora template.";
    case "FORMAT_TOO_NEW":
      return "This template was created with a newer version of Buildora.";
    case "WRONG_PACKAGE_TYPE":
      return "This package is not a template.";
    case "TEMPLATE_INVALID":
      return "The template inside this package is invalid.";
    case "ASSET_MISSING":
      return "The template is missing one of its images.";
    case "ASSET_INVALID":
      return "One of the template's images is not valid.";
    case "ASSET_TOO_LARGE":
      return "One of the template's images is too large.";
    case "DOWNLOAD_FAILED":
      return "The download could not be started.";
    case "EXPORT_FAILED":
      return "The template could not be exported.";
    case "IMPORT_FAILED":
    default:
      return error.message || "This template could not be imported.";
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ExportTemplatePackageResult =
  | {
      ok: true;
      blob: Blob;
      filename: string;
      manifest: TemplatePackageManifest;
      payload: TemplatePackagePayload;
      assetCount: number;
      totalAssetBytes: number;
    }
  | { ok: false; error: TemplatePackageError };

export type ReadTemplatePackageResult =
  | { ok: true; buffer: ArrayBuffer; sizeBytes: number }
  | { ok: false; error: TemplatePackageError };

export type BuildTemplateImportPreviewResult =
  | {
      ok: true;
      preview: TemplateImportPreviewInfo;
      /** Validated, ready-to-install record. Persisted only on user confirm. */
      record: PersonalTemplateRecord;
    }
  | { ok: false; error: TemplatePackageError };
