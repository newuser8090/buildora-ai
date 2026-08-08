// ---------------------------------------------------------------------------
// Publishing — deploy request validation (Phase P8, server-side)
//
// Strict schemas + documented artifact caps. Every field is bounded; export
// paths are sanitized (relative, no traversal, no shell/control characters)
// because they become provider file-tree keys.
// ---------------------------------------------------------------------------

import { z } from "zod";

// ---------------------------------------------------------------------------
// Artifact caps (documented deployment limits)
// ---------------------------------------------------------------------------

export const MAX_EXPORT_FILES = 2_000;
export const MAX_EXPORT_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_EXPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_EXPORT_PATH_LENGTH = 500;

/**
 * Sanitize/validate a relative export path. Returns null when unsafe.
 * Allowed: lowercase+uppercase letters, digits, ".", "_", "/", "-".
 */
export function sanitizeExportPath(raw: string): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_EXPORT_PATH_LENGTH) {
    return null;
  }
  if (/[\x00-\x1f\x7f\\]/.test(raw)) return null; // control chars + backslash
  if (raw.startsWith("/") || raw.startsWith("~")) return null; // absolute
  if (raw.includes("..")) return null; // traversal
  if (!/^[A-Za-z0-9._/-]+$/.test(raw)) return null; // allowlist
  // Empty segments (e.g. "a//b" or a trailing "/") are rejected.
  if (raw.split("/").some((seg) => seg.length === 0)) return null;
  return raw;
}

function byteLengthOf(content: string, encoding: "utf-8" | "base64"): number {
  return encoding === "base64"
    ? Math.ceil((content.length * 3) / 4)
    : new TextEncoder().encode(content).length;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const hex16 = z.string().regex(/^[0-9a-f]{16}$/i, "Expected a 16-character hex hash.");

export const DeployRequestSchema = z
  .object({
    projectId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid project id."),
    deploymentId: z.string().min(1).max(80).regex(/^deploy-[A-Za-z0-9_-]+$/, "Invalid deployment id."),
    exportHash: hex16,
    contentHash: hex16,
    projectName: z.string().min(1).max(80),
    idempotencyKey: z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/, "Invalid idempotency key."),
    files: z
      .array(
        z.object({
          path: z.string().min(1).max(MAX_EXPORT_PATH_LENGTH),
          content: z.string(),
          encoding: z.enum(["utf-8", "base64"]).optional(),
        }),
      )
      .max(MAX_EXPORT_FILES, `Too many files (max ${MAX_EXPORT_FILES}).`),
  })
  .refine((body) => body.files.length > 0, {
    message: "No files were provided to publish.",
  });

export type DeployRequest = z.infer<typeof DeployRequestSchema>;

export interface ValidatedDeployRequest extends DeployRequest {
  /** Sanitized + size-checked files (throws structured error on violation). */
  checkedFiles: Array<{ path: string; content: string; encoding: "utf-8" | "base64" }>;
  totalBytes: number;
}

/** Validate caps + sanitize paths after the shape check. */
export function checkDeployPayload(body: DeployRequest): {
  ok: true; payload: ValidatedDeployRequest
} | {
  ok: false; code: string; message: string
} {
  const checkedFiles: ValidatedDeployRequest["checkedFiles"] = [];
  let totalBytes = 0;
  for (const file of body.files) {
    const path = sanitizeExportPath(file.path);
    if (!path) {
      return { ok: false, code: "ARTIFACT_INVALID", message: "One of the site files has an unsafe path." };
    }
    const encoding: "utf-8" | "base64" = file.encoding === "base64" ? "base64" : "utf-8";
    const size = byteLengthOf(file.content, encoding);
    if (size > MAX_EXPORT_FILE_BYTES) {
      return {
        ok: false,
        code: "ARTIFACT_TOO_LARGE",
        message: `One of the site files is too large (max ${Math.round(MAX_EXPORT_FILE_BYTES / 1024 / 1024)} MB per file).`,
      };
    }
    totalBytes += size;
    if (totalBytes > MAX_EXPORT_TOTAL_BYTES) {
      return {
        ok: false,
        code: "ARTIFACT_TOO_LARGE",
        message: `Your site files are too large to publish this way (max ${Math.round(MAX_EXPORT_TOTAL_BYTES / 1024 / 1024)} MB).`,
      };
    }
    checkedFiles.push({ path, content: file.content, encoding });
  }
  return {
    ok: true,
    payload: { ...body, checkedFiles, totalBytes },
  };
}

export const AttachDomainRequestSchema = z.object({
  projectId: z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid project id."),
  domain: z.string().min(1).max(254),
});

export type AttachDomainRequest = z.infer<typeof AttachDomainRequestSchema>;
