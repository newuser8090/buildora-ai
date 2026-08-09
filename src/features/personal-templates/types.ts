// ---------------------------------------------------------------------------
// Personal Templates (Phase P9) — types, errors, quota
//
// Personal templates wrap/derive from the existing Project schema (never a
// second project model). They are local-only in P9. No deployment records,
// custom-domain records, cloud sync queues/markers, or auth session state
// are ever stored in a personal template — the Project schema carries no
// such state, and the conversion layer never copies persistence metadata.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import type { TemplateCategory } from "@/features/templates/types";

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export interface PersonalTemplateRecord {
  /** Fresh id: "personal-<uuid>". Stable across renames. */
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  source: "personal";
  /** Deep-cloned Project snapshot, validated through ProjectSchema. */
  project: Project;
  /**
   * Phase P13 — provenance for templates installed from a .buildora-template
   * package. Optional record field (no IndexedDB schema change): old records
   * load unchanged. Non-authoritative display metadata only — imported local
   * IDs are never trusted as authoritative.
   */
  provenance?: {
    source: "import";
    packageFormatVersion: number;
    exportedAt: string;
    originalName: string;
  };
}

// ---------------------------------------------------------------------------
// Save request
// ---------------------------------------------------------------------------

export interface SaveAsTemplateInput {
  project: Project;
  name: string;
  description?: string;
  category: TemplateCategory;
  tags?: string[];
  /** Injected clock value (ISO string) — deterministic in tests. */
  now?: string;
  /** Injected id — deterministic in tests. */
  id?: string;
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

/** Maximum number of saved personal templates (local storage cap). */
export const MAX_PERSONAL_TEMPLATES = 25;

/** Maximum tag count + per-tag length for personal templates. */
export const MAX_TEMPLATE_TAGS = 8;
export const MAX_TAG_LENGTH = 24;

/** Maximum description length. */
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 200;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PersonalTemplateErrorCode =
  | "PERSONAL_TEMPLATE_NOT_FOUND"
  | "PERSONAL_TEMPLATE_QUOTA_EXCEEDED"
  | "PERSONAL_TEMPLATE_INVALID_INPUT"
  | "PERSONAL_TEMPLATE_SNAPSHOT_INVALID"
  | "PERSONAL_TEMPLATE_UNKNOWN_ERROR";

export interface PersonalTemplateError {
  code: PersonalTemplateErrorCode;
  /** User-safe message suitable for display. */
  message: string;
  /** Internal technical detail — never exposed as a raw stack trace. */
  cause?: string;
}

export function makePersonalTemplateError(
  code: PersonalTemplateErrorCode,
  message: string,
  cause?: string,
): PersonalTemplateError {
  return { code, message, cause };
}

/** Normalize an unknown thrown value into a structured error. */
export function toPersonalTemplateError(
  err: unknown,
  fallbackCode: PersonalTemplateErrorCode = "PERSONAL_TEMPLATE_UNKNOWN_ERROR",
  fallbackMessage = "Something went wrong while using your templates.",
): PersonalTemplateError {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const candidate = err as Partial<PersonalTemplateError>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.message === "string"
    ) {
      return makePersonalTemplateError(
        candidate.code as PersonalTemplateErrorCode,
        candidate.message,
        candidate.cause ?? (err instanceof Error ? err.message : undefined),
      );
    }
  }
  return makePersonalTemplateError(
    fallbackCode,
    err instanceof Error ? err.message : fallbackMessage,
    err instanceof Error ? err.message : String(err),
  );
}
