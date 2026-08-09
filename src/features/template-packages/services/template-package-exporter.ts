// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — exporter
//
// Builds a deterministic .buildora-template ZIP from a PersonalTemplateRecord:
//   manifest.json + template.json + assets/<file> (only referenced assets).
//
// Deterministic core: assets sorted by id, deduped by data-URL content,
// fixed JSON key order, canonical base64 encoding, fixed ZIP file dates
// (injected `now`). Timestamps that are intended metadata (exportedAt) may
// differ between exports.
//
// Environment-independent apart from Blob (browser). JSZip is lazy-loaded so
// ZIP machinery never enters the main editor bundle unless an export runs.
// ---------------------------------------------------------------------------

import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { getCanonicalExtension } from "@/features/assets/services/file-validator";
import { sanitizeExportFilename } from "@/features/projects/utils/sanitize-export-filename";
import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import type { Project } from "@/types/project";
import {
  BUILDORA_TEMPLATE_FORMAT_MARKER,
  BUILDORA_TEMPLATE_FORMAT_VERSION,
  BUILDORA_TEMPLATE_EXTENSION,
  DEFAULT_TEMPLATE_PACKAGE_FILENAME,
  MANIFEST_FILENAME,
  MAX_TEMPLATE_ASSET_BYTES,
  PACKAGE_TYPE_TEMPLATE,
  TEMPLATE_PAYLOAD_FILENAME,
} from "../constants";
import type {
  ExportTemplatePackageResult,
  TemplatePackageError,
  TemplatePackageManifest,
  TemplatePackagePayload,
} from "../types";
import { makeTemplatePackageError } from "../types";
import { collectPackagedAssetIds } from "./asset-collector";
import { assetPackagePath } from "../utils/zip-path";
import { dataUrlToBytes } from "../utils/data-url-io";

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportTemplatePackageInput {
  record: PersonalTemplateRecord;
  /** Injected clock (ISO string) — deterministic in tests. */
  now?: string;
}

/**
 * Build a .buildora-template package Blob from a personal template record.
 * Never mutates the input record.
 */
export async function exportTemplatePackage(
  input: ExportTemplatePackageInput,
): Promise<ExportTemplatePackageResult> {
  const { record } = input;

  // ---- 1. Validate the stored project -------------------------------------
  const validation = ProjectSchema.safeParse(record.project);
  if (!validation.success) {
    return {
      ok: false,
      error: makeTemplatePackageError(
        "EXPORT_FAILED",
        "This template could not be exported because its content is not valid.",
        validation.error.issues
          .map((i) => `${i.path.join(".")} — ${i.message}`)
          .join("; "),
      ),
    };
  }
  const project = validation.data;

  // ---- 2. Collect + sort referenced assets --------------------------------
  const wanted = collectPackagedAssetIds(project);
  const assets = project.assets
    .filter((a) => wanted.has(a.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  // ---- 3. Decode + dedupe by data-URL content ------------------------------
  // Identical content (same data URL string) maps to ONE package file; both
  // assets keep their own manifest entry sharing that path. Deterministic:
  // assets are processed in sorted id order, so paths are assigned in a
  // stable sequence.
  const pathByContent = new Map<string, string>();
  const pathByAssetId = new Map<string, string>();
  const bytesByPath = new Map<string, Uint8Array>();
  const entries: TemplatePackageManifest["assets"] = [];

  for (const asset of assets) {
    let bytes: Uint8Array;
    try {
      bytes = dataUrlToBytes(asset.source.value);
    } catch (err) {
      return {
        ok: false,
        error: makeTemplatePackageError(
          "EXPORT_FAILED",
          "This template could not be exported because one of its images is damaged.",
          err,
        ),
      };
    }

    if (bytes.length > MAX_TEMPLATE_ASSET_BYTES) {
      return {
        ok: false,
        error: makeTemplatePackageError(
          "EXPORT_FAILED",
          "This template could not be exported because one of its images is larger than 5 MB.",
        ),
      };
    }

    const extension = getCanonicalExtension(asset.mimeType);
    if (!extension) {
      return {
        ok: false,
        error: makeTemplatePackageError(
          "EXPORT_FAILED",
          "This template could not be exported because it uses an unsupported image type.",
        ),
      };
    }

    const contentKey = asset.source.value;
    let path = pathByContent.get(contentKey);
    if (!path) {
      path = assetPackagePath(entries.length, extension);
      pathByContent.set(contentKey, path);
      bytesByPath.set(path, bytes);
    }
    pathByAssetId.set(asset.id, path);

    entries.push({
      path,
      assetId: asset.id,
      name: asset.name.slice(0, 256),
      mimeType: asset.mimeType,
      extension,
      size: bytes.length,
    });
  }

  // ---- 4. Build the payload (assets externalized) --------------------------
  const payloadProject: Project = JSON.parse(JSON.stringify(project)) as Project;
  payloadProject.assets = assets.map((asset) => {
    const clone = JSON.parse(JSON.stringify(asset)) as Project["assets"][number];
    clone.source = { type: "data-url", value: pathByAssetId.get(asset.id)! };
    return clone;
  });

  const now = input.now ?? new Date().toISOString();
  const payload: TemplatePackagePayload = {
    template: {
      name: record.name,
      description: record.description,
      category: record.category,
      tags: record.tags,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    project: payloadProject,
  };

  const totalAssetBytes = entries.reduce((sum, e) => sum + e.size, 0);
  const manifest: TemplatePackageManifest = {
    format: BUILDORA_TEMPLATE_FORMAT_MARKER,
    formatVersion: BUILDORA_TEMPLATE_FORMAT_VERSION,
    packageType: PACKAGE_TYPE_TEMPLATE,
    exportedAt: now,
    assetCount: entries.length,
    totalAssetBytes,
    assets: entries,
  };

  // ---- 5. Build the ZIP (fixed dates for determinism) -----------------------
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const fixedDate = new Date(now);

    zip.file(MANIFEST_FILENAME, serializeJson(manifest), { date: fixedDate });
    zip.file(TEMPLATE_PAYLOAD_FILENAME, serializeJson(payload), { date: fixedDate });

    // Deterministic path order.
    const paths = Array.from(bytesByPath.keys()).sort();
    for (const path of paths) {
      zip.file(path, bytesByPath.get(path)!, { date: fixedDate });
    }

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });

    return {
      ok: true,
      blob,
      filename: sanitizeTemplatePackageFilename(record.name),
      manifest,
      payload,
      assetCount: entries.length,
      totalAssetBytes,
    };
  } catch (err) {
    return {
      ok: false,
      error: makeTemplatePackageError(
        "EXPORT_FAILED",
        "The template could not be exported.",
        err,
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Trigger a browser download of an exported package. */
export function downloadTemplatePackage(
  result: Extract<ExportTemplatePackageResult, { ok: true }>,
): { ok: true } | { ok: false; error: TemplatePackageError } {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    !document.createElement
  ) {
    return {
      ok: false,
      error: makeTemplatePackageError(
        "DOWNLOAD_FAILED",
        "Download is only available in a browser environment.",
      ),
    };
  }

  let anchor: HTMLAnchorElement | null = null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(result.blob);
    anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: makeTemplatePackageError("DOWNLOAD_FAILED", "The download could not be started.", err),
    };
  } finally {
    try {
      if (anchor && anchor.parentNode) {
        anchor.parentNode.removeChild(anchor);
      }
    } catch {
      // Ignore cleanup errors.
    }
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke errors.
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic 2-space JSON with a trailing newline. */
function serializeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Safe download filename: sanitized base + .buildora-template exactly once. */
export function sanitizeTemplatePackageFilename(templateName: string): string {
  if (!templateName.trim()) {
    return DEFAULT_TEMPLATE_PACKAGE_FILENAME;
  }
  // sanitizeExportFilename always yields a non-empty base; strip its extension
  // and append ours exactly once.
  const base = sanitizeExportFilename(templateName).replace(/\.buildora\.json$/i, "");
  return `${base}${BUILDORA_TEMPLATE_EXTENSION}`;
}
