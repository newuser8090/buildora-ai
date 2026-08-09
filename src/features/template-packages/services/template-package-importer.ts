// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — importer
//
// Treats the package as UNTRUSTED input. Pipeline:
//   file-level validation → archive load → entry path/count/size inspection
//   → manifest parse (strict schema) → version/type compatibility
//   → payload parse (strict schema) → dangerous-key/depth/URL checks
//   → asset cross-checks → per-asset extraction (magic bytes, size)
//   → restore data URLs → re-validate project → build fresh record + preview
//
// Persistence happens ONLY after the user confirms (a single saveTemplate
// write) — a failed import can never leave a half-installed template.
// ---------------------------------------------------------------------------

import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { MAX_PROJECT_NAME_LENGTH } from "@/features/projects/utils/validate-project-name";
import { getPersonalTemplateService } from "@/features/personal-templates/services/personal-template-service";
import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import {
  BUILDORA_TEMPLATE_FORMAT_VERSION,
  MANIFEST_FILENAME,
  MAX_TEMPLATE_ASSET_BYTES,
  MAX_TEMPLATE_JSON_BYTES,
  MAX_TEMPLATE_PACKAGE_ENTRIES,
  MAX_TEMPLATE_PACKAGE_FILE_SIZE_BYTES,
  MAX_TEMPLATE_PACKAGE_UNCOMPRESSED_BYTES,
  PACKAGE_TYPE_TEMPLATE,
  TEMPLATE_PAYLOAD_FILENAME,
} from "../constants";
import { PackageManifestSchema, PackagePayloadSchema } from "../schema";
import type {
  BuildTemplateImportPreviewResult,
  ReadTemplatePackageResult,
  TemplateImportPreviewInfo,
  TemplatePackageError,
} from "../types";
import { makeTemplatePackageError } from "../types";
import { validatePackageEntryPath } from "../utils/zip-path";
import { bytesToDataUrl, isUnsafeUrlValue, sniffImageBytes } from "../utils/data-url-io";

// ---------------------------------------------------------------------------
// File-level validation + read
// ---------------------------------------------------------------------------

/**
 * Validate extension/size and read a .buildora-template File as ArrayBuffer.
 * Does NOT parse the archive.
 */
export async function readTemplatePackageFile(
  file: File,
): Promise<ReadTemplatePackageResult> {
  // NOTE: there is deliberately NO extension gate here. Package filenames can
  // lose their `.buildora-template` extension in transit (renamed by download
  // managers, email, USB copies), so the name is never trusted alone — the
  // archive + manifest + payload content below is the authoritative check
  // (see architecture: "never trust MIME/extension alone"). The file picker's
  // `accept=".buildora-template"` attribute still guides beginners.

  if (file.size === 0) {
    return {
      ok: false,
      error: makeTemplatePackageError("ARCHIVE_INVALID", "The file is empty."),
    };
  }

  if (file.size > MAX_TEMPLATE_PACKAGE_FILE_SIZE_BYTES) {
    return {
      ok: false,
      error: makeTemplatePackageError(
        "PACKAGE_TOO_LARGE",
        `File is too large. Maximum size is ${Math.round(MAX_TEMPLATE_PACKAGE_FILE_SIZE_BYTES / (1024 * 1024))} MB.`,
        undefined,
        { limit: "FILE_SIZE", actual: file.size, max: MAX_TEMPLATE_PACKAGE_FILE_SIZE_BYTES },
      ),
    };
  }

  try {
    const buffer = await readFileAsArrayBuffer(file);
    return { ok: true, buffer, sizeBytes: file.size };
  } catch (err) {
    return {
      ok: false,
      error: makeTemplatePackageError("FILE_READ_FAILED", "The file could not be read.", err),
    };
  }
}

// ---------------------------------------------------------------------------
// Full import pipeline (parse + validate + preview + ready-to-install record)
// ---------------------------------------------------------------------------

export interface BuildTemplateImportPreviewOptions {
  /** Injected record id — deterministic in tests. */
  id?: string;
  /** Injected clock (ISO string) — deterministic in tests. */
  now?: string;
}

/**
 * Parse + validate a package and produce a preview plus a fully-validated
 * record. Nothing is persisted. The caller shows the preview and only calls
 * installImportedTemplate(record) after user confirmation.
 */
export async function buildTemplateImportPreview(
  file: File,
  existingNames: string[],
  options?: BuildTemplateImportPreviewOptions,
): Promise<BuildTemplateImportPreviewResult> {
  const read = await readTemplatePackageFile(file);
  if (!read.ok) return read;

  try {
    const JSZip = (await import("jszip")).default;
    let zip: InstanceType<typeof JSZip>;
    try {
      zip = await JSZip.loadAsync(read.buffer);
    } catch (err) {
      return {
        ok: false,
        error: makeTemplatePackageError("ARCHIVE_INVALID", "This file is not a valid Buildora template.", err),
      };
    }

    // ---- Archive inspection: count + path safety + size pre-scan -----------
    const entries = Object.values(zip.files).filter((e) => !e.dir);
    if (entries.length > MAX_TEMPLATE_PACKAGE_ENTRIES) {
      return {
        ok: false,
        error: makeTemplatePackageError(
          "ARCHIVE_TOO_MANY_FILES",
          `The package contains too many files (maximum ${MAX_TEMPLATE_PACKAGE_ENTRIES}).`,
          undefined,
          { limit: "ENTRIES", actual: entries.length, max: MAX_TEMPLATE_PACKAGE_ENTRIES },
        ),
      };
    }

    for (const entry of entries) {
      const safe = validatePackageEntryPath(entry.name);
      if (!safe.valid) {
        return {
          ok: false,
          error: makeTemplatePackageError("ARCHIVE_ENTRY_UNSAFE", "The package contains an unsafe file entry.", undefined, {
            entry: entry.name,
            reason: safe.reason,
          }),
        };
      }
    }

    // Cheap bomb guard from the central directory when sizes are available;
    // extraction-time enforcement below is the authoritative bound.
    let claimedTotal = 0;
    for (const entry of entries) {
      const claimed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (typeof claimed === "number" && claimed > MAX_TEMPLATE_PACKAGE_UNCOMPRESSED_BYTES) {
        return {
          ok: false,
          error: makeTemplatePackageError("ARCHIVE_TOO_LARGE", "The package expands beyond the supported size."),
        };
      }
      claimedTotal += typeof claimed === "number" ? claimed : 0;
    }
    if (claimedTotal > MAX_TEMPLATE_PACKAGE_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        error: makeTemplatePackageError("ARCHIVE_TOO_LARGE", "The package expands beyond the supported size."),
      };
    }

    let extractedTotal = 0;

    // ---- Manifest -----------------------------------------------------------
    const manifestEntry = zip.file(MANIFEST_FILENAME);
    if (!manifestEntry) {
      return {
        ok: false,
        error: makeTemplatePackageError("MANIFEST_MISSING", "The package is missing its template information."),
      };
    }
    const manifestText = await readEntryText(manifestEntry, "manifest");
    if (!manifestText.ok) return { ok: false, error: manifestText.error };
    extractedTotal += manifestText.text.length;

    let manifestRaw: unknown;
    try {
      manifestRaw = JSON.parse(manifestText.text);
    } catch (err) {
      return {
        ok: false,
        error: makeTemplatePackageError("MANIFEST_INVALID", "The package information is not valid JSON.", err),
      };
    }
    if (hasDangerousKeys(manifestRaw, 0)) {
      return {
        ok: false,
        error: makeTemplatePackageError("MANIFEST_INVALID", "The package information contains unsafe keys."),
      };
    }

    const manifestValidation = PackageManifestSchema.safeParse(manifestRaw);
    if (!manifestValidation.success) {
      return {
        ok: false,
        error: makeTemplatePackageError("MANIFEST_INVALID", "The package information is invalid."),
      };
    }
    const manifest = manifestValidation.data;

    if (manifest.formatVersion > BUILDORA_TEMPLATE_FORMAT_VERSION) {
      return {
        ok: false,
        error: makeTemplatePackageError(
          "FORMAT_TOO_NEW",
          `This template was created with a newer version of Buildora (format ${manifest.formatVersion}).`,
          undefined,
          { formatVersion: manifest.formatVersion, supported: BUILDORA_TEMPLATE_FORMAT_VERSION },
        ),
      };
    }
    if (manifest.packageType !== PACKAGE_TYPE_TEMPLATE) {
      return {
        ok: false,
        error: makeTemplatePackageError("WRONG_PACKAGE_TYPE", "This package is not a template."),
      };
    }

    // ---- Payload ------------------------------------------------------------
    const payloadEntry = zip.file(TEMPLATE_PAYLOAD_FILENAME);
    if (!payloadEntry) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template inside this package is missing."),
      };
    }
    const payloadText = await readEntryText(payloadEntry, "template");
    if (!payloadText.ok) return { ok: false, error: payloadText.error };
    extractedTotal += payloadText.text.length;

    let payloadRaw: unknown;
    try {
      payloadRaw = JSON.parse(payloadText.text);
    } catch (err) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content is not valid JSON.", err),
      };
    }
    if (hasDangerousKeys(payloadRaw, 0)) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content contains unsafe keys."),
      };
    }
    if (!validateStructuralDepth(payloadRaw, 20)) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content is nested too deeply."),
      };
    }

    const payloadValidation = PackagePayloadSchema.safeParse(payloadRaw);
    if (!payloadValidation.success) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content is invalid."),
      };
    }
    const payload = payloadValidation.data;

    // A whitespace-only name passes the schema's min-length check but is not a
    // usable name (the canonical validateProjectName requires non-empty after
    // trim). Reject here so the user sees a clear error instead of an empty
    // preview that later fails at install time.
    if (!payload.template.name.trim()) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template does not have a name."),
      };
    }

    if (containsUnsafeUrl(payloadRaw, 0)) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content contains an unsafe link."),
      };
    }

    // ---- Asset cross-checks ---------------------------------------------------
    // Every project asset path must exist in the manifest; the manifest's path
    // set and the project's path set must be identical (no missing, no orphans).
    const projectPaths = new Set(payload.project.assets.map((a) => a.source.value));
    const manifestPaths = new Set(manifest.assets.map((a) => a.path));
    for (const path of projectPaths) {
      if (!manifestPaths.has(path)) {
        return {
          ok: false,
          error: makeTemplatePackageError("ASSET_MISSING", "The template is missing one of its images.", undefined, {
            path,
          }),
        };
      }
    }
    for (const path of manifestPaths) {
      if (!projectPaths.has(path)) {
        return {
          ok: false,
          error: makeTemplatePackageError("ASSET_MISSING", "The package references an image the template does not use.", undefined, {
            path,
          }),
        };
      }
      if (!zip.file(path)) {
        return {
          ok: false,
          error: makeTemplatePackageError("ASSET_MISSING", "The template is missing one of its images.", undefined, {
            path,
          }),
        };
      }
    }

    // No orphan entries: every archive entry is manifest/payload/manifest asset.
    for (const entry of entries) {
      if (entry.name === MANIFEST_FILENAME || entry.name === TEMPLATE_PAYLOAD_FILENAME) continue;
      if (!manifestPaths.has(entry.name)) {
        return {
          ok: false,
          error: makeTemplatePackageError("ARCHIVE_ENTRY_UNSAFE", "The package contains unexpected files.", undefined, {
            entry: entry.name,
          }),
        };
      }
    }

    // ---- Asset extraction + validation ---------------------------------------
    const bytesByPath = new Map<string, Uint8Array>();
    const uniquePaths = Array.from(manifestPaths).sort();
    for (const path of uniquePaths) {
      const meta = manifest.assets.find((a) => a.path === path)!;
      if (extractedTotal + meta.size > MAX_TEMPLATE_PACKAGE_UNCOMPRESSED_BYTES) {
        return {
          ok: false,
          error: makeTemplatePackageError("ARCHIVE_TOO_LARGE", "The package expands beyond the supported size."),
        };
      }
      const read = await readEntryBytes(zip.file(path)!, path);
      if (!read.ok) return { ok: false, error: read.error };
      const bytes = read.bytes;
      extractedTotal += bytes.length;
      if (extractedTotal > MAX_TEMPLATE_PACKAGE_UNCOMPRESSED_BYTES) {
        return {
          ok: false,
          error: makeTemplatePackageError("ARCHIVE_TOO_LARGE", "The package expands beyond the supported size."),
        };
      }
      if (bytes.length > MAX_TEMPLATE_ASSET_BYTES) {
        return {
          ok: false,
          error: makeTemplatePackageError("ASSET_TOO_LARGE", "One of the template's images is too large.", undefined, {
            path,
            size: bytes.length,
          }),
        };
      }
      if (bytes.length !== meta.size) {
        return {
          ok: false,
          error: makeTemplatePackageError("ASSET_INVALID", "One of the template's images does not match its description.", undefined, {
            path,
          }),
        };
      }
      if (!sniffImageBytes(bytes, meta.mimeType)) {
        return {
          ok: false,
          error: makeTemplatePackageError("ASSET_INVALID", "One of the template's images is not valid.", undefined, {
            path,
            mimeType: meta.mimeType,
          }),
        };
      }
      bytesByPath.set(path, bytes);
    }

    // ---- Restore data URLs + re-validate -------------------------------------
    let restored: PersonalTemplateRecord["project"];
    try {
      restored = JSON.parse(JSON.stringify(payload.project)) as PersonalTemplateRecord["project"];
    } catch (err) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content could not be prepared.", err),
      };
    }
    restored.assets = restored.assets.map((asset) => {
      const bytes = bytesByPath.get(asset.source.value)!;
      return {
        ...asset,
        size: bytes.length,
        source: { type: "data-url", value: bytesToDataUrl(bytes, asset.mimeType) },
      };
    });

    const restoredValidation = ProjectSchema.safeParse(restored);
    if (!restoredValidation.success) {
      return {
        ok: false,
        error: makeTemplatePackageError("TEMPLATE_INVALID", "The template content is invalid."),
      };
    }

    // ---- Build fresh record + preview ------------------------------------------
    const now = options?.now ?? new Date().toISOString();
    const finalName = generateUniqueTemplateName(payload.template.name, existingNames);
    const warnings: string[] = [];
    if (finalName !== payload.template.name) {
      warnings.push(`Saved as “${finalName}” because a template with that name already exists.`);
    }
    if (uniquePaths.length < manifest.assets.length) {
      warnings.push("Some identical images were combined to keep the file small.");
    }

    const record: PersonalTemplateRecord = {
      id: options?.id ?? `personal-${crypto.randomUUID()}`,
      name: finalName,
      description: payload.template.description,
      category: payload.template.category,
      tags: payload.template.tags,
      createdAt: now,
      updatedAt: now,
      source: "personal",
      provenance: {
        source: "import",
        packageFormatVersion: manifest.formatVersion,
        exportedAt: manifest.exportedAt,
        originalName: payload.template.name,
      },
      project: restoredValidation.data,
    };

    const preview: TemplateImportPreviewInfo = {
      name: finalName,
      description: payload.template.description,
      category: payload.template.category,
      tags: payload.template.tags,
      pageCount: restoredValidation.data.pages.length,
      sectionCount: restoredValidation.data.pages.reduce((sum, p) => sum + p.sections.length, 0),
      assetCount: restoredValidation.data.assets.length,
      packageSizeBytes: read.sizeBytes,
      formatVersion: manifest.formatVersion,
      formatCompatible: true,
      warnings,
      originalName: payload.template.name,
    };

    return { ok: true, preview, record };
  } catch (err) {
    return {
      ok: false,
      error: makeTemplatePackageError("IMPORT_FAILED", "The template could not be imported.", err),
    };
  }
}

// ---------------------------------------------------------------------------
// Install (persist) — called only after user confirmation
// ---------------------------------------------------------------------------

export type InstallImportedTemplateResult =
  | { ok: true; record: PersonalTemplateRecord }
  | { ok: false; error: TemplatePackageError };

/**
 * Persist a validated imported template through the canonical personal-template
 * service (enforces the local quota). A single write — nothing half-installed.
 */
export async function installImportedTemplate(
  record: PersonalTemplateRecord,
): Promise<InstallImportedTemplateResult> {
  const result = await getPersonalTemplateService().installRecord(record);
  if (!result.ok) {
    return {
      ok: false,
      error: makeTemplatePackageError("IMPORT_FAILED", result.error.message, result.error.cause),
    };
  }
  return { ok: true, record: result.record };
}

// ---------------------------------------------------------------------------
// Name conflict resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a template-name conflict with the beginner-friendly
 * "Portfolio", "Portfolio (2)", "Portfolio (3)" strategy. The base is
 * truncated to stay within the canonical 80-char limit.
 */
export function generateUniqueTemplateName(
  name: string,
  existingNames: string[],
): string {
  const trimmed = name.trim();
  if (!existingNames.includes(trimmed)) return trimmed;

  let counter = 2;
  for (;;) {
    const suffix = ` (${counter})`;
    const maxBase = MAX_PROJECT_NAME_LENGTH - suffix.length;
    const base = trimmed.length > maxBase ? trimmed.slice(0, maxBase) : trimmed;
    const candidate = `${base}${suffix}`;
    if (!existingNames.includes(candidate)) return candidate;
    counter += 1;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("File reader returned a non-buffer result."));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file."));
    reader.onabort = () => reject(new Error("File reading was aborted."));
    reader.readAsArrayBuffer(file);
  });
}

type EntryTextResult = { ok: true; text: string } | { ok: false; error: TemplatePackageError };

async function readEntryText(
  entry: { async(type: "string"): Promise<string> },
  kind: "manifest" | "template",
): Promise<EntryTextResult> {
  const claimed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
    ?.uncompressedSize;
  if (typeof claimed === "number" && claimed > MAX_TEMPLATE_JSON_BYTES) {
    return {
      ok: false,
      error: makeTemplatePackageError(
        kind === "manifest" ? "MANIFEST_INVALID" : "TEMPLATE_INVALID",
        kind === "manifest" ? "The package information is too large." : "The template content is too large.",
      ),
    };
  }
  try {
    const text = await entry.async("string");
    if (text.length > MAX_TEMPLATE_JSON_BYTES) {
      return {
        ok: false,
        error: makeTemplatePackageError(
          kind === "manifest" ? "MANIFEST_INVALID" : "TEMPLATE_INVALID",
          kind === "manifest" ? "The package information is too large." : "The template content is too large.",
        ),
      };
    }
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      error: makeTemplatePackageError(
        kind === "manifest" ? "MANIFEST_INVALID" : "TEMPLATE_INVALID",
        kind === "manifest" ? "The package information could not be read." : "The template content could not be read.",
        err,
      ),
    };
  }
}

type EntryBytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: TemplatePackageError };

async function readEntryBytes(
  entry: { async(type: "uint8array"): Promise<Uint8Array> },
  path: string,
): Promise<EntryBytesResult> {
  try {
    const bytes = await entry.async("uint8array");
    return { ok: true, bytes };
  } catch (err) {
    return {
      ok: false,
      error: makeTemplatePackageError("ASSET_INVALID", "One of the template's images could not be read.", err, {
        path,
      }),
    };
  }
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Reject own enumerable keys that enable prototype pollution. */
function hasDangerousKeys(value: unknown, depth: number): boolean {
  if (value === null || typeof value !== "object" || depth > 20) return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (hasDangerousKeys(item, depth + 1)) return true;
    }
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (DANGEROUS_KEYS.has(key)) return true;
    if (hasDangerousKeys(record[key], depth + 1)) return true;
  }
  return false;
}

/** Bound structural depth before any recursive traversal or schema parse. */
function validateStructuralDepth(value: unknown, maxDepth: number, depth = 1): boolean {
  if (depth > maxDepth) return false;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === "object" && !validateStructuralDepth(item, maxDepth, depth + 1)) {
        return false;
      }
    }
    return true;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === "object" && !validateStructuralDepth(child, maxDepth, depth + 1)) {
        return false;
      }
    }
  }
  return true;
}

/** Scan all string values for unsafe URL schemes (javascript:, vbscript:, data:text/html). */
function containsUnsafeUrl(value: unknown, depth: number): boolean {
  if (value === null || depth > 20) return false;
  if (typeof value === "string") {
    return isUnsafeUrlValue(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsUnsafeUrl(item, depth + 1)) return true;
    }
    return false;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (containsUnsafeUrl((value as Record<string, unknown>)[key], depth + 1)) return true;
    }
  }
  return false;
}

