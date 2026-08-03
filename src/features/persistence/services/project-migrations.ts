// ---------------------------------------------------------------------------
// Project Migration Pipeline
//
// Converts older project formats to the current format version through
// sequential, deterministic migration functions. Each function handles
// one version increment. Migrations never mutate their input.
//
// Pipeline: detect version → migrate sequentially → return migrated data
// ---------------------------------------------------------------------------

import { CURRENT_FORMAT_VERSION } from "../constants";
import type { MigrationResult } from "../types";
import type { ProjectFileError, ProjectFileWarning } from "../types";

// ---------------------------------------------------------------------------
// Migration registry — maps source version to the migration function
// that upgrades from that version to (sourceVersion + 1).
// ---------------------------------------------------------------------------

type MigrationFn = (input: unknown) => { data: unknown; warnings: ProjectFileWarning[] };

const migrationRegistry: Record<number, MigrationFn> = {
  1: migrateV1ToV2,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the migration pipeline on an input value.
 *
 * 1. Determine the input format version
 * 2. Apply all migrations sequentially to reach CURRENT_FORMAT_VERSION
 * 3. Report which migrations were applied
 *
 * Returns a MigrationResult with migrated data and metadata.
 * Expected failures (invalid version, future version, missing migration) are
 * returned as structured errors — they do NOT throw.
 * Only genuinely unexpected programmer errors may throw.
 */
export function migrateProjectEnvelope(input: unknown): MigrationResult {
  const warnings: ProjectFileWarning[] = [];
  const applied: string[] = [];

  // Detect current version
  const currentVersion = detectVersion(input);
  if (currentVersion === null) {
    return {
      data: undefined as unknown,
      applied,
      warnings,
      error: makeError("INVALID_FORMAT_VERSION", "Cannot determine project format version."),
    };
  }
  if (currentVersion > CURRENT_FORMAT_VERSION) {
    return {
      data: undefined as unknown,
      applied,
      warnings,
      error: makeError(
        "UNSUPPORTED_FUTURE_VERSION",
        `This project uses format version ${currentVersion}, but this version of Buildora supports up to version ${CURRENT_FORMAT_VERSION}. Please update Buildora to open this file.`,
      ),
    };
  }

  // Apply migrations sequentially
  let data = input;
  let v = currentVersion;

  while (v < CURRENT_FORMAT_VERSION) {
    const migration = migrationRegistry[v];
    if (!migration) {
      return {
        data: undefined as unknown,
        applied,
        warnings,
        error: makeError(
          "MIGRATION_FAILED",
          `No migration available from format version ${v} to ${v + 1}.`,
        ),
      };
    }

    const result = migration(data);
    data = result.data;
    warnings.push(...result.warnings);
    applied.push(`v${v}→v${v + 1}`);
    v++;
  }

  return { data, applied, warnings };
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

/**
 * Detect the format version of an input value.
 *
 * Rules:
 * - null/undefined/primitive → null (cannot determine)
 * - No formatVersion field → 1 (legacy project)
 * - If formatVersion is present, must be a positive integer
 * - Fractional, negative, string, or otherwise invalid → null
 */
function detectVersion(input: unknown): number | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const obj = input as Record<string, unknown>;

  // No formatVersion → legacy version 1
  if (obj.formatVersion === undefined) return 1;

  const v = obj.formatVersion;

  // Must be a number
  if (typeof v !== "number" || !Number.isFinite(v)) return null;

  // Must be a positive integer
  if (!Number.isInteger(v) || v < 1) return null;

  return v;
}

// ---------------------------------------------------------------------------
// Migration: V1 → V2
// ---------------------------------------------------------------------------

/**
 * Migrate from format version 1 to version 2.
 *
 * Version 1 projects may be:
 *   A. A raw Project object (no envelope) — wrap inside SerializedBuildoraProject
 *   B. An old envelope that predates the canonical format — treated same way
 *
 * Changes in V2:
 *   - Wrap in SerializedBuildoraProject envelope with formatVersion: 2
 *   - Normalize missing assets to []
 *   - Recover missing createdAt/updatedAt using a deterministic policy (not the current clock)
 *   - Preserve all other fields
 *
 * Deterministic timestamp recovery policy:
 *   A. Both valid → preserve both
 *   B. createdAt valid, updatedAt missing → set updatedAt = createdAt
 *   C. updatedAt valid, createdAt missing → set createdAt = updatedAt
 *   D. Both missing → use THE_EPOCH constant (1970-01-01T00:00:00.000Z)
 *
 * Does NOT mutate the input.
 */
function migrateV1ToV2(input: unknown): { data: unknown; warnings: ProjectFileWarning[] } {
  const warnings: ProjectFileWarning[] = [];

  // Deep clone to avoid mutating input
  const raw = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;

  // Determine if this is already an envelope (has a project field) or a raw project
  const rawProject: Record<string, unknown> = raw.project && typeof raw.project === "object" && !Array.isArray(raw.project)
    ? (raw.project as Record<string, unknown>)
    : raw;

  // Normalize assets: ensure it's an array
  if (!rawProject.assets || !Array.isArray(rawProject.assets)) {
    rawProject.assets = [];
    warnings.push({
      code: "ASSETS_NORMALIZED",
      message: "Assets field was missing or invalid. Defaulted to empty array.",
    });
  }

  // Deterministic timestamp recovery (no Date.now() / new Date() calls)
  const createdAt = typeof rawProject.createdAt === "string" && rawProject.createdAt.length > 0
    ? rawProject.createdAt
    : undefined;
  const updatedAt = typeof rawProject.updatedAt === "string" && rawProject.updatedAt.length > 0
    ? rawProject.updatedAt
    : undefined;

  if (createdAt && updatedAt) {
    // Both valid — preserve both (no change needed)
  } else if (createdAt && !updatedAt) {
    rawProject.updatedAt = createdAt;
    warnings.push({
      code: "TIMESTAMP_RECOVERED",
      message: "Missing updatedAt copied from createdAt.",
    });
  } else if (updatedAt && !createdAt) {
    rawProject.createdAt = updatedAt;
    warnings.push({
      code: "TIMESTAMP_RECOVERED",
      message: "Missing createdAt copied from updatedAt.",
    });
  } else {
    // Both missing — use a constant epoch
    rawProject.createdAt = THE_EPOCH;
    rawProject.updatedAt = THE_EPOCH;
    warnings.push({
      code: "TIMESTAMP_RECOVERED",
      message: "Both timestamps were missing. Defaulted to epoch (1970-01-01T00:00:00.000Z).",
    });
  }

  // Wrap in envelope
  const envelope: Record<string, unknown> = {
    formatVersion: 2,
    project: rawProject,
  };

  warnings.push({
    code: "PROJECT_WRAPPED_IN_ENVELOPE",
    message: "Project was wrapped in the current serialization format.",
  });

  return { data: envelope, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic epoch constant used when no project timestamps exist.
 * Never uses Date.now() or new Date() — always this constant value.
 */
const THE_EPOCH = "1970-01-01T00:00:00.000Z";

function makeError(code: ProjectFileError["code"], message: string): ProjectFileError {
  return { code, message };
}
