// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — ZIP path safety + generation
//
// Logical ZIP paths are UNTRUSTED strings. Every entry path is validated before
// it is read: no traversal, no absolute paths, no drive letters, no backslashes,
// no control characters, bounded depth, and a strict allow-list of locations
// (manifest.json, template.json, assets/<safe-image>).
// ---------------------------------------------------------------------------

import {
  ASSETS_DIRECTORY,
  MANIFEST_FILENAME,
  MAX_TEMPLATE_PATH_DEPTH,
  PACKAGE_ASSET_EXTENSIONS,
  TEMPLATE_PAYLOAD_FILENAME,
} from "../constants";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CONTROL_CHARS = /[\x00-\x1f]/;
const PACKAGE_EXT_SET = new Set<string>(PACKAGE_ASSET_EXTENSIONS);
const ASSET_FILE_PATTERN = /^[a-z0-9-]+\.[a-z0-9]+$/;

export type PathValidationResult =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validate a logical ZIP entry path.
 *
 * Rejects:
 *  - empty paths and whitespace-only names
 *  - backslashes and control characters
 *  - absolute paths (/…), Windows drive paths (C:\…, C:/…)
 *  - "." / ".." segments
 *  - paths deeper than MAX_TEMPLATE_PATH_DEPTH
 *  - anything outside manifest.json / template.json / assets/<image>
 */
export function validatePackageEntryPath(path: string): PathValidationResult {
  if (typeof path !== "string" || path.trim().length === 0) {
    return { valid: false, reason: "Empty entry path" };
  }

  if (path.includes("\\")) {
    return { valid: false, reason: "Backslash in entry path" };
  }

  if (CONTROL_CHARS.test(path)) {
    return { valid: false, reason: "Control characters in entry path" };
  }

  if (path.startsWith("/")) {
    return { valid: false, reason: "Absolute path" };
  }

  if (/^[A-Za-z]:/.test(path)) {
    return { valid: false, reason: "Drive-letter path" };
  }

  const segments = path.split("/");
  if (segments.length > MAX_TEMPLATE_PATH_DEPTH) {
    return { valid: false, reason: "Path is too deep" };
  }

  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return { valid: false, reason: "Unsafe path segment" };
    }
  }

  // Top-level files: only the two canonical JSON files.
  if (segments.length === 1) {
    if (path === MANIFEST_FILENAME || path === TEMPLATE_PAYLOAD_FILENAME) {
      return { valid: true };
    }
    return { valid: false, reason: "Unexpected top-level entry" };
  }

  // Nested entries: only assets/<safe-image-file>.
  if (segments[0] !== ASSETS_DIRECTORY || segments.length !== 2) {
    return { valid: false, reason: "Unexpected nested entry" };
  }

  const filename = segments[1];
  if (!ASSET_FILE_PATTERN.test(filename)) {
    return { valid: false, reason: "Unsafe asset filename" };
  }

  const ext = filename.slice(filename.lastIndexOf("."));
  if (!PACKAGE_EXT_SET.has(ext.toLowerCase())) {
    return { valid: false, reason: "Unsupported asset extension" };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Generation (export side)
// ---------------------------------------------------------------------------

/** Deterministic package path for a zero-padded asset index. */
export function assetPackagePath(index: number, extension: string): string {
  const safeExt = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  const number = String(index + 1).padStart(4, "0");
  return `${ASSETS_DIRECTORY}/asset-${number}${safeExt}`;
}
