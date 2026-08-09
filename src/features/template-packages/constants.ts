// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — constants
//
// The .buildora-template package format is a versioned ZIP archive:
//   manifest.json  — format identity, package type, exportedAt, asset manifest
//   template.json  — template metadata + project snapshot (assets externalized)
//   assets/…       — referenced binary asset files
//
// Format version is decoupled from IndexedDB DATABASE_VERSION and from the
// .buildora.json EXPORT_FORMAT_VERSION.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Format identity
// ---------------------------------------------------------------------------

/** Fixed format marker for .buildora-template packages. */
export const BUILDORA_TEMPLATE_FORMAT_MARKER = "buildora-template" as const;

/** Current package format version. Bump only on a breaking format change. */
export const BUILDORA_TEMPLATE_FORMAT_VERSION = 1;

/** File extension for Buildora template packages. */
export const BUILDORA_TEMPLATE_EXTENSION = ".buildora-template";

/** Package types. P13 produces/accepts "template"; "project" is reserved. */
export const PACKAGE_TYPE_TEMPLATE = "template" as const;
export const PACKAGE_TYPE_PROJECT = "project" as const;
export const PACKAGE_TYPES = [PACKAGE_TYPE_TEMPLATE, PACKAGE_TYPE_PROJECT] as const;

// ---------------------------------------------------------------------------
// Package layout
// ---------------------------------------------------------------------------

export const MANIFEST_FILENAME = "manifest.json";
export const TEMPLATE_PAYLOAD_FILENAME = "template.json";
export const ASSETS_DIRECTORY = "assets";

/** Regex for generated asset paths: assets/asset-0001.png */
export const ASSET_PATH_PATTERN = /^assets\/[a-z0-9-]+\.(png|jpg|jpeg|webp|svg)$/;

/** Allowed extensions inside an assets/ entry (case-insensitive, stored lower). */
export const PACKAGE_ASSET_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".svg"] as const;

// ---------------------------------------------------------------------------
// Limits (enforced, never silently truncated)
// ---------------------------------------------------------------------------

/** Maximum compressed .buildora-template file size (25 MB). */
export const MAX_TEMPLATE_PACKAGE_FILE_SIZE_BYTES = 25 * 1024 * 1024;

/** Maximum number of archive entries (folders excluded). */
export const MAX_TEMPLATE_PACKAGE_ENTRIES = 2000;

/**
 * Maximum total uncompressed payload. Enforced during extraction with early
 * abort — a decompression bomb cannot allocate unbounded memory.
 */
export const MAX_TEMPLATE_PACKAGE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

/** Maximum decoded size of a single packaged asset (matches upload cap). */
export const MAX_TEMPLATE_ASSET_BYTES = 5 * 1024 * 1024;

/** Maximum number of packaged assets (matches the project asset cap). */
export const MAX_TEMPLATE_ASSETS = 2000;

/** Maximum ZIP path depth (assets/asset-0001.png is depth 2). */
export const MAX_TEMPLATE_PATH_DEPTH = 4;

/** Maximum packaged asset name length. */
export const MAX_TEMPLATE_ASSET_NAME_LENGTH = 256;

/** Maximum decoded size of manifest.json / template.json inside the archive. */
export const MAX_TEMPLATE_JSON_BYTES = 10 * 1024 * 1024;

/** Fallback download filename when the sanitized template name is empty. */
export const DEFAULT_TEMPLATE_PACKAGE_FILENAME = "buildora-template.buildora-template";

/** Maximum template name length (matches the canonical project-name limit). */
export const MAX_TEMPLATE_PACKAGE_NAME_LENGTH = 80;
