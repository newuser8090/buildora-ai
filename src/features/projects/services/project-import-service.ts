// ---------------------------------------------------------------------------
// ProjectImportService
//
// Handles parsing and validating imported Buildora project files.
//
// Pure service — no persistence, no React, no browser APIs.
// Parsing pipeline:
//   1. Reject empty text
//   2. Parse JSON safely
//   3. Validate root envelope (format, formatVersion)
//   4. Validate structural depth
//   5. Reject dangerous prototype-pollution keys (including inside arrays)
//   6. Collect unknown-field warnings (UNKNOWN_OPTIONAL_FIELD_IGNORED)
//   7. Extract serialized project
//   8. Run existing migration pipeline via deserializeProject
//   9. Enforce aggregate limits + canonical project-name limit
//   10. Produce preview with warnings
//
// Persistence of imported projects is handled by ProjectService.commitImportedProject().
//
// --- Unknown-field policy (ENFORCED) ---
// Unknown optional fields in the export envelope or project data are ignored:
//   - A UNKNOWN_OPTIONAL_FIELD_IGNORED warning is added to the preview for each
//     unknown field, in deterministic (document-order) traversal, deduplicated
//     by field path.
//   - Unknown values never reach the runtime Project: deserializeProject passes
//     through ProjectSchema which strips unknown keys (non-strict object).
//   - Required-field shape errors remain fatal and produce INVALID_EXPORT_ENVELOPE
//     or PROJECT_VALIDATION_FAILED errors.
//
// --- Dangerous-keys policy ---
// The dangerous-keys check (checkDangerousKeys) uses Object.keys() which
// returns only own enumerable properties. After JSON.parse, keys like
// "__proto__" become own enumerable properties. This ensures:
//   - Inherited properties like constructor are NOT rejected (false positives)
//   - Text values containing "constructor" are NOT rejected
//   - Only actual own keys matching the dangerous set are rejected
//   - Dangerous keys nested in arrays are also rejected (arrays are traversed)
//
// --- Limits policy ---
// All limits are enforced, never silently truncated, and every limit error
// carries structured details: { limit, actual, max, path }.
// ---------------------------------------------------------------------------

import { deserializeProject } from "@/features/persistence/services/project-serializer";
import { MAX_IMPORT_STRUCTURAL_DEPTH } from "@/features/persistence/constants";
import { validateProjectName, MAX_PROJECT_NAME_LENGTH } from "../utils/validate-project-name";
import type {
  ParseProjectImportResult,
  ImportProjectPreview,
  ProjectTransferError,
  ImportProjectWarning,
} from "../types/project-transfer";
import {
  EXPORT_FORMAT_VERSION,
  EXPORT_FORMAT_MARKER,
  BUILDORA_EXTENSION,
} from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum total pages. */
const MAX_TOTAL_PAGES = 100;

/** Maximum total sections across all pages. */
const MAX_TOTAL_SECTIONS = 2000;

/** Maximum total assets. */
const MAX_TOTAL_ASSETS = 2000;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProjectImportService {
  constructor() {}


  // -----------------------------------------------------------------------
  // Parse — validate and preview an import without persisting
  // -----------------------------------------------------------------------

  /**
   * Parse an imported project file from raw text.
   *
   * Full pipeline:
   *   1. Reject empty text
   *   2. Parse JSON safely
   *   3. Validate root envelope
   *   4. Validate format marker
   *   5. Validate formatVersion
   *   6. Extract serialized project
   *   7. Run existing migration+deserialization pipeline
   *   8. Produce preview
   *   9. Return warnings where recovery occurred
   *
   * Does NOT save anything during parsing.
   * Parsing and persistence remain separate.
   */
  parse(
    text: string,
    sourceFilename: string,
  ): ParseProjectImportResult {
    const warnings: ImportProjectWarning[] = [];

    // ---- Step 1: Reject empty text ----
    if (!text || text.trim().length === 0) {
      return {
        ok: false,
        error: {
          code: "EMPTY_FILE",
          message: "The file is empty.",
        },
      };
    }

    // ---- Step 2: Parse JSON safely ----
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "INVALID_JSON",
          message: "The file contains invalid JSON.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }

    // ---- Step 3: Validate root is a non-null, non-array object ----
    if (parsed === null || parsed === undefined) {
      return {
        ok: false,
        error: {
          code: "INVALID_EXPORT_ENVELOPE",
          message: "The file is empty (null root).",
        },
      };
    }
    if (Array.isArray(parsed)) {
      return {
        ok: false,
        error: {
          code: "INVALID_EXPORT_ENVELOPE",
          message: "Expected a project object, but the root is an array.",
        },
      };
    }
    if (typeof parsed !== "object") {
      return {
        ok: false,
        error: {
          code: "INVALID_EXPORT_ENVELOPE",
          message: `Expected a project object, but found a ${typeof parsed} value.`,
        },
      };
    }

    // ---- Step 3b: Validate structural depth ----
    // Enforced explicitly (not conflated with dangerous keys) so excessive or
    // impossible nesting is rejected with a structured limit error.
    const depthResult = validateStructuralDepth(parsed, MAX_IMPORT_STRUCTURAL_DEPTH, "$");
    if (!depthResult.valid) {
      return {
        ok: false,
        error: {
          code: "PROJECT_VALIDATION_FAILED",
          message: `Project data exceeds the maximum supported nesting depth of ${MAX_IMPORT_STRUCTURAL_DEPTH}.`,
          details: {
            limit: "STRUCTURAL_DEPTH",
            actual: depthResult.actualDepth,
            max: MAX_IMPORT_STRUCTURAL_DEPTH,
            path: depthResult.path,
          },
        },
      };
    }

    // ---- Step 3c: Reject dangerous prototype-pollution keys ----
    // Runs after the depth check, so recursion in checkDangerousKeys is bounded.
    const dangerousKeysResult = checkDangerousKeys(parsed as Record<string, unknown>);
    if (!dangerousKeysResult.valid) {
      return {
        ok: false,
        error: {
          code: "INVALID_PROJECT_DATA",
          message: "The file contains unsafe object keys.",
          details: { key: dangerousKeysResult.key },
        },
      };
    }

    const root = parsed as Record<string, unknown>;

    // ---- Step 3d: Collect unknown-field warnings (deterministic + dedup) ----
    const unknownFields = collectUnknownFields(root);
    for (const path of unknownFields) {
      warnings.push({
        code: "UNKNOWN_OPTIONAL_FIELD_IGNORED",
        message: `Unknown field "${path}" was ignored.`,
      });
    }

    // ---- Step 4: Validate format marker ----
    if (root.format !== EXPORT_FORMAT_MARKER) {
      if (typeof root.format === "string") {
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_FORMAT",
            message: `This file uses format "${root.format}", but Buildora expects "${EXPORT_FORMAT_MARKER}".`,
            details: { format: root.format },
          },
        };
      }
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_FORMAT",
          message: "This file does not appear to be a Buildora project export.",
        },
      };
    }

    // ---- Step 5: Validate formatVersion ----
    const formatVersion = root.formatVersion;
    if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
      return {
        ok: false,
        error: {
          code: "INVALID_EXPORT_ENVELOPE",
          message: "The file has an invalid format version.",
          details: { formatVersion },
        },
      };
    }

    if (formatVersion > EXPORT_FORMAT_VERSION) {
      return {
        ok: false,
        error: {
          code: "UNSUPPORTED_FORMAT_VERSION",
          message: `This file uses format version ${formatVersion}, but Buildora supports up to version ${EXPORT_FORMAT_VERSION}.`,
          details: { formatVersion, supportedVersion: EXPORT_FORMAT_VERSION },
        },
      };
    }

    // Check file extension warning (case-insensitive: .BUILDORA.JSON is a
    // canonical .buildora.json and produces no warning).
    if (!sourceFilename.toLowerCase().endsWith(BUILDORA_EXTENSION)) {
      warnings.push({
        code: "FILE_EXTENSION_NOT_BUILDORA",
        message: `File extension is not ".buildora.json". Some features may not work correctly.`,
      });
    }

    // ---- Step 6: Extract serialized project ----
    const projectData = root.project;
    if (!projectData || typeof projectData !== "object" || Array.isArray(projectData)) {
      return {
        ok: false,
        error: {
          code: "INVALID_EXPORT_ENVELOPE",
          message: "The file is missing a valid 'project' field.",
        },
      };
    }

    // (Dangerous keys inside the project were already rejected by the root
    // check above, which traverses the whole document including arrays.)

    // ---- Step 7: Run migration + deserialization pipeline ----
    // We need to wrap the project back into a format that deserializeProject
    // understands. The export format is different from the internal SerializedBuildoraProject.
    // So we construct the internal envelope format expected by deserializeProject.
    const internalEnvelope = reconstructInternalEnvelope(projectData);

    const deserialized = deserializeProject(JSON.stringify(internalEnvelope));

    if (!deserialized.success) {
      // Map existing error codes to transfer error codes, preserving the
      // structured limit details (limit name / actual / max / path).
      const errorCode = mapDeserializationErrorCode(deserialized.error.code);
      return {
        ok: false,
        error: {
          code: errorCode,
          message: deserialized.error.message,
          cause: deserialized.error.cause,
          details: deserialized.error.details
            ? { ...deserialized.error.details }
            : deserialized.error.field
              ? { path: deserialized.error.field }
              : undefined,
        },
      };
    }

    // ---- Step 7b: Check aggregate limits + canonical project-name limit ----
    // Every limit error carries structured details: limit name, actual, max, path.
    const totalSections = deserialized.project.pages.reduce(
      (sum, p) => sum + p.sections.length,
      0,
    );

    // Canonical project-name limit (80 chars, enforced before preview)
    const nameValidation = validateProjectName(deserialized.project.name);
    if (!nameValidation.valid) {
      return {
        ok: false,
        error: {
          code: "PROJECT_VALIDATION_FAILED",
          message: `Project name exceeds the canonical limit: ${deserialized.project.name.length} characters (maximum ${MAX_PROJECT_NAME_LENGTH}).`,
          details: {
            limit: "PROJECT_NAME",
            actual: deserialized.project.name.length,
            max: MAX_PROJECT_NAME_LENGTH,
            path: "project.name",
          },
        },
      };
    }

    // Page limit
    if (deserialized.project.pages.length > MAX_TOTAL_PAGES) {
      return {
        ok: false,
        error: {
          code: "PROJECT_VALIDATION_FAILED",
          message: `Project has ${deserialized.project.pages.length} pages, but the maximum allowed is ${MAX_TOTAL_PAGES}.`,
          details: {
            limit: "PAGES",
            actual: deserialized.project.pages.length,
            max: MAX_TOTAL_PAGES,
            path: "project.pages",
          },
        },
      };
    }

    // Total sections across ALL pages
    if (totalSections > MAX_TOTAL_SECTIONS) {
      return {
        ok: false,
        error: {
          code: "PROJECT_VALIDATION_FAILED",
          message: `Project has ${totalSections} total sections across all pages, but the maximum allowed is ${MAX_TOTAL_SECTIONS}.`,
          details: {
            limit: "SECTIONS",
            actual: totalSections,
            max: MAX_TOTAL_SECTIONS,
            path: "project.pages[].sections",
          },
        },
      };
    }

    // Assets limit
    if (deserialized.project.assets.length > MAX_TOTAL_ASSETS) {
      return {
        ok: false,
        error: {
          code: "PROJECT_VALIDATION_FAILED",
          message: `Project has ${deserialized.project.assets.length} assets, but the maximum allowed is ${MAX_TOTAL_ASSETS}.`,
          details: {
            limit: "ASSETS",
            actual: deserialized.project.assets.length,
            max: MAX_TOTAL_ASSETS,
            path: "project.assets",
          },
        },
      };
    }

    // ---- Step 8: Collect migration warnings ----
    const migrationApplied = deserialized.migrationsApplied.length > 0;
    if (migrationApplied) {
      warnings.push({
        code: "MIGRATION_APPLIED",
        message: `Project was migrated: ${deserialized.migrationsApplied.join(", ")}.`,
      });
    }

    // Forward any existing migration warnings from deserialization
    for (const w of deserialized.warnings) {
      if (w.code === "TIMESTAMP_RECOVERED") {
        warnings.push({
          code: "LEGACY_TIMESTAMP_RECOVERED",
          message: "Missing timestamps were recovered using available data.",
        });
      }
    }

    // ---- Step 9: Build preview ----
    const originalMetadata = extractOriginalMetadata(root);

    const preview: ImportProjectPreview = {
      sourceFilename,
      project: deserialized.project,
      originalProjectId: originalMetadata?.originalProjectId ?? deserialized.project.id,
      originalProjectName: originalMetadata?.originalProjectName ?? deserialized.project.name,
      schemaVersion: deserialized.formatVersion,
      migrationApplied,
      warnings,
    };

    return { ok: true, preview };
  }  // -----------------------------------------------------------------------
  // Generate a collision-safe import name
  // -----------------------------------------------------------------------

  /**
   * Generate a unique name when the original name conflicts with an existing project.
   *
   * Policy:
   * - First try: "Project Name (Imported)"
   * - If taken: "Project Name (Imported 2)"
   * - Then: "Project Name (Imported 3)" etc.
   *
   * The generated name always fits the canonical project-name limit (80 chars):
   * the base is truncated to leave room for the suffix, so the result is always
   * accepted by validateProjectName() and never triggers a commit-time error.
   */
  generateUniqueImportName(
    originalName: string,
    existingNames: string[],
  ): string {
    const baseName = fitBaseName(originalName, " (Imported)");
    const candidate = `${baseName} (Imported)`;
    if (!existingNames.includes(candidate)) return candidate;

    let counter = 2;
    while (true) {
      const suffix = ` (Imported ${counter})`;
      const candidate2 = `${fitBaseName(originalName, suffix)}${suffix}`;
      if (!existingNames.includes(candidate2)) return candidate2;
      counter++;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reconstruct a SerializedBuildoraProject-like envelope from the export format.
 *
 * The export envelope has format: "buildora-project", formatVersion: N,
 * and a `project` field containing the raw Project data.
 *
 * The internal deserializer expects a SerializedBuildoraProject with
 * formatVersion and project fields. We pass through the project data
 * and the format version so the migration pipeline can process it.
 */
function reconstructInternalEnvelope(
  projectData: unknown,
): Record<string, unknown> {
  // The deserializeProject pipeline handles raw project data at any version.
  // We pass the project data directly — the pipeline will detect the version
  // and apply migrations as needed.
  return {
    project: projectData,
  };
}

/**
 * Extract original metadata from the export envelope root.
 */
function extractOriginalMetadata(
  root: Record<string, unknown>,
): { originalProjectId: string; originalProjectName: string; originalCreatedAt: string; originalUpdatedAt: string } | null {
  const meta = root.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;

  const m = meta as Record<string, unknown>;
  if (
    typeof m.originalProjectId !== "string" ||
    typeof m.originalProjectName !== "string" ||
    typeof m.originalCreatedAt !== "string" ||
    typeof m.originalUpdatedAt !== "string"
  ) {
    return null;
  }

  return {
    originalProjectId: m.originalProjectId,
    originalProjectName: m.originalProjectName,
    originalCreatedAt: m.originalCreatedAt,
    originalUpdatedAt: m.originalUpdatedAt,
  };
}

/**
 * Map internal deserialization error codes to transfer error codes.
 */
function mapDeserializationErrorCode(
  code: string,
): ProjectTransferError["code"] {
  switch (code) {
    case "INVALID_JSON":
      return "INVALID_JSON";
    case "INVALID_ENVELOPE":
      return "INVALID_EXPORT_ENVELOPE";
    case "INVALID_FORMAT_VERSION":
      return "INVALID_EXPORT_ENVELOPE";
    case "UNSUPPORTED_FUTURE_VERSION":
      return "UNSUPPORTED_FORMAT_VERSION";
    case "MIGRATION_FAILED":
      return "PROJECT_MIGRATION_FAILED";
    case "PROJECT_VALIDATION_FAILED":
      return "PROJECT_VALIDATION_FAILED";
    default:
      return "UNKNOWN_TRANSFER_ERROR";
  }
}

/**
 * Truncate the base name so that base + suffix fits the canonical 80-char limit.
 */
function fitBaseName(originalName: string, suffix: string): string {
  const maxBase = MAX_PROJECT_NAME_LENGTH - suffix.length;
  if (maxBase <= 0) return "";
  return originalName.length > maxBase
    ? originalName.slice(0, maxBase)
    : originalName;
}

/**
 * Check for dangerous prototype-pollution keys in an object (recursive).
 *
 * - Uses Object.keys() → only own enumerable properties are inspected.
 * - Inherited properties (e.g. Object.prototype.constructor) are NOT rejected.
 * - Text VALUES containing "constructor" / "__proto__" are NOT rejected.
 * - Arrays are traversed, so a dangerous key inside an array element is
 *   rejected (JSON.parse output is acyclic, so recursion is safe here).
 */
function checkDangerousKeys(
  obj: Record<string, unknown>,
): { valid: true } | { valid: false; key: string } {
  const dangerous = ["__proto__", "prototype", "constructor"];
  for (const key of Object.keys(obj)) {
    if (dangerous.includes(key)) {
      return { valid: false, key };
    }
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) {
          const nested = checkDangerousKeys(item as Record<string, unknown>);
          if (!nested.valid) return nested;
        }
      }
    } else if (typeof val === "object" && val !== null) {
      const nested = checkDangerousKeys(val as Record<string, unknown>);
      if (!nested.valid) return nested;
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Structural depth validation
// ---------------------------------------------------------------------------

/**
 * Validate that the parsed JSON stays within the supported structural depth.
 * Root object counts as depth 1; every nested object/array level adds 1.
 */
function validateStructuralDepth(
  value: unknown,
  maxDepth: number,
  path: string,
  depth = 1,
): { valid: true } | { valid: false; actualDepth: number; path: string } {
  if (depth > maxDepth) {
    return { valid: false, actualDepth: depth, path };
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (item !== null && typeof item === "object") {
        const nested = validateStructuralDepth(item, maxDepth, `${path}[${i}]`, depth + 1);
        if (!nested.valid) return nested;
      }
    }
    return { valid: true };
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      if (child !== null && typeof child === "object") {
        const nested = validateStructuralDepth(child, maxDepth, `${path}.${key}`, depth + 1);
        if (!nested.valid) return nested;
      }
    }
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Unknown-field policy
// ---------------------------------------------------------------------------

/** Known keys at each structural level of the export envelope. */
const KNOWN_ROOT_KEYS = new Set([
  "format", "formatVersion", "exportedAt", "appVersion", "project", "metadata",
]);
const KNOWN_METADATA_KEYS = new Set([
  "originalProjectId", "originalProjectName", "originalCreatedAt", "originalUpdatedAt",
]);
const KNOWN_PROJECT_KEYS = new Set([
  "id", "name", "theme", "pages", "assets", "createdAt", "updatedAt",
]);
const KNOWN_THEME_KEYS = new Set(["palette", "typography", "spacing", "radius", "shadows"]);
const KNOWN_THEME_SUB = new Map<string, Set<string>>([
  ["palette", new Set([
    "background", "foreground", "primary", "primaryForeground", "secondary",
    "secondaryForeground", "muted", "mutedForeground", "accent", "accentForeground",
    "border", "card", "cardForeground",
  ])],
  ["typography", new Set(["fontFamily", "headingFont", "baseSize", "scale"])],
  ["spacing", new Set(["sectionPadding", "containerMaxWidth", "gap"])],
  ["radius", new Set(["sm", "md", "lg", "xl", "full"])],
  ["shadows", new Set(["sm", "md", "lg", "xl"])],
]);
const KNOWN_PAGE_KEYS = new Set(["id", "title", "slug", "sections", "meta"]);
const KNOWN_PAGE_META_KEYS = new Set(["title", "description"]);
const KNOWN_SECTION_KEYS = new Set(["id", "type", "order", "visible", "props", "styles"]);
const KNOWN_ASSET_KEYS = new Set([
  "id", "name", "type", "mimeType", "extension", "size", "width", "height",
  "source", "createdAt", "altText",
]);
const KNOWN_ASSET_SOURCE_KEYS = new Set(["type", "value"]);

/**
 * Collect unknown optional fields across the export envelope.
 *
 * Traversal is deterministic (document key order) and paths are deduplicated,
 * so the resulting warnings are ordered and contain each unknown path once.
 * Props/styles of sections are free-form content and are intentionally NOT
 * traversed.
 */
function collectUnknownFields(root: Record<string, unknown>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    found.push(path);
  };

  const checkKeys = (
    obj: Record<string, unknown>,
    known: Set<string>,
    path: string,
  ) => {
    for (const key of Object.keys(obj)) {
      if (!known.has(key)) add(`${path}.${key}`);
    }
  };

  checkKeys(root, KNOWN_ROOT_KEYS, "$");

  const metadata = root.metadata;
  if (metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)) {
    checkKeys(metadata as Record<string, unknown>, KNOWN_METADATA_KEYS, "$.metadata");
  }

  const project = root.project;
  if (project !== null && typeof project === "object" && !Array.isArray(project)) {
    const p = project as Record<string, unknown>;
    checkKeys(p, KNOWN_PROJECT_KEYS, "$.project");

    const theme = p.theme;
    if (theme !== null && typeof theme === "object" && !Array.isArray(theme)) {
      const t = theme as Record<string, unknown>;
      checkKeys(t, KNOWN_THEME_KEYS, "$.project.theme");
      for (const [subKey, subKnown] of KNOWN_THEME_SUB) {
        const sub = t[subKey];
        if (sub !== null && typeof sub === "object" && !Array.isArray(sub)) {
          checkKeys(sub as Record<string, unknown>, subKnown, `$.project.theme.${subKey}`);
        }
      }
    }

    const pages = p.pages;
    if (Array.isArray(pages)) {
      pages.forEach((page, i) => {
        if (page === null || typeof page !== "object" || Array.isArray(page)) return;
        const pg = page as Record<string, unknown>;
        checkKeys(pg, KNOWN_PAGE_KEYS, `$.project.pages[${i}]`);
        const meta = pg.meta;
        if (meta !== null && typeof meta === "object" && !Array.isArray(meta)) {
          checkKeys(
            meta as Record<string, unknown>,
            KNOWN_PAGE_META_KEYS,
            `$.project.pages[${i}].meta`,
          );
        }
        const sections = pg.sections;
        if (Array.isArray(sections)) {
          sections.forEach((section, j) => {
            if (section === null || typeof section !== "object" || Array.isArray(section)) return;
            checkKeys(
              section as Record<string, unknown>,
              KNOWN_SECTION_KEYS,
              `$.project.pages[${i}].sections[${j}]`,
            );
          });
        }
      });
    }

    const assets = p.assets;
    if (Array.isArray(assets)) {
      assets.forEach((asset, i) => {
        if (asset === null || typeof asset !== "object" || Array.isArray(asset)) return;
        const a = asset as Record<string, unknown>;
        checkKeys(a, KNOWN_ASSET_KEYS, `$.project.assets[${i}]`);
        const source = a.source;
        if (source !== null && typeof source === "object" && !Array.isArray(source)) {
          checkKeys(source as Record<string, unknown>, KNOWN_ASSET_SOURCE_KEYS, `$.project.assets[${i}].source`);
        }
      });
    }
  }

  return found;
}
