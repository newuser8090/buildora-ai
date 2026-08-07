// ---------------------------------------------------------------------------
// Project Serializer
//
// Canonical serialization and deserialization for Buildora project files.
// The pipeline is:
//
//   Deserialize:
//     parse JSON → detect version → migrate → normalize → validate → return Project
//
//   Serialize:
//     validate project → wrap in envelope → stringify JSON
//
// All functions are environment-independent (no React, no browser APIs).
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { CURRENT_FORMAT_VERSION } from "../constants";
import { migrateProjectEnvelope } from "./project-migrations";
import { normalizeProject } from "./project-normalizer";
import { validateProjectImportLimits } from "./project-import-validator";
import type {
  SerializedBuildoraProject,
  ProjectDeserializationResult,
  MigrationResult,
} from "../types";

// ---------------------------------------------------------------------------
// Serialize — Project → formatted JSON string
// ---------------------------------------------------------------------------

export interface SerializeOptions {
  /** Optional human-readable app version. */
  appVersion?: string;
  /** ISO timestamp for exportedAt. If not set, not included unless explicit. */
  exportedAt?: string;
  /** If true, output pretty-printed JSON. Default false (compact). */
  pretty?: boolean;
}

/**
 * Serialize a Project into a canonical JSON string.
 *
 * The project is wrapped in a SerializedBuildoraProject envelope with the
 * current format version. Transient editor state is excluded.
 *
 * Does not mutate the input project.
 */
export function serializeProject(
  project: Project,
  options?: SerializeOptions,
): string {
  // Clone to avoid mutating input
  const cloned: Project = JSON.parse(JSON.stringify(project));

  // Remove any transient fields that may have leaked into the project
  const allowedKeys = [
    "id", "name", "theme", "pages", "assets", "createdAt", "updatedAt",
    "siteSettings",
  ];
  const cloneObj = cloned as unknown as Record<string, unknown>;
  for (const key of Object.keys(cloneObj)) {
    if (!allowedKeys.includes(key)) {
      delete cloneObj[key];
    }
  }

  // Build envelope
  const envelope: SerializedBuildoraProject = {
    formatVersion: CURRENT_FORMAT_VERSION,
    project: cloned,
  };

  if (options?.appVersion) {
    envelope.appVersion = options.appVersion;
  }
  if (options?.exportedAt) {
    envelope.exportedAt = options.exportedAt;
  }

  const space = options?.pretty ? 2 : undefined;
  return JSON.stringify(envelope, null, space);
}

// ---------------------------------------------------------------------------
// Deserialize — string or unknown → structured result
// ---------------------------------------------------------------------------

/**
 * Deserialize a Buildora project file from a JSON string or parsed value.
 *
 * Full pipeline:
 *   1. Parse JSON string to value
 *   2. Detect envelope/version
 *   3. Apply migrations sequentially
 *   4. Normalize the project
 *   5. Validate against ProjectSchema
 *   6. Return the validated Project
 */
export function deserializeProject(
  input: string | unknown,
): ProjectDeserializationResult {
  // ---- Step 1: Parse JSON ----
  let parsed: unknown;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      return {
        success: false,
        error: {
          code: "INVALID_JSON",
          message: "The file contains invalid JSON and could not be parsed.",
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
  } else {
    parsed = input;
  }

  // Null or array at root is always invalid
  if (parsed === null || parsed === undefined) {
    return {
      success: false,
      error: {
        code: "INVALID_ENVELOPE",
        message: "The project file is empty.",
      },
    };
  }
  if (Array.isArray(parsed)) {
    return {
      success: false,
      error: {
        code: "INVALID_ENVELOPE",
        message: "Expected a project object, but the file contains an array at the root level.",
      },
    };
  }
  if (typeof parsed !== "object") {
    return {
      success: false,
      error: {
        code: "INVALID_ENVELOPE",
        message: `Expected a project object, but found a ${typeof parsed} value.`,
      },
    };
  }

  // ---- Step 2: Detect version and migrate ----
  let migrationResult: MigrationResult;
  try {
    migrationResult = migrateProjectEnvelope(parsed);
  } catch (err) {
    // Unexpected exception from migration — return as structured MIGRATION_FAILED
    return {
      success: false,
      error: {
        code: "MIGRATION_FAILED",
        message: "An unexpected error occurred during project migration.",
        cause: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // Forward structured migration errors directly (preserves INVALID_FORMAT_VERSION,
  // UNSUPPORTED_FUTURE_VERSION, MIGRATION_FAILED codes)
  if (migrationResult.error) {
    return {
      success: false,
      error: migrationResult.error,
    };
  }

  const migrated = migrationResult.data;
  const migrationsApplied = migrationResult.applied;
  const migrationWarnings = migrationResult.warnings;

  // ---- Step 3: Extract project from envelope ----
  let projectData: unknown;
  if (typeof migrated === "object" && migrated !== null) {
    const envelope = migrated as Record<string, unknown>;

    // If the data has formatVersion (i.e. it's in envelope format), project is required
    if (typeof envelope.formatVersion === "number") {
      if (!envelope.project || typeof envelope.project !== "object" || Array.isArray(envelope.project)) {
        return {
          success: false,
          error: {
            code: "INVALID_ENVELOPE",
            message: "The project envelope is missing the required 'project' field.",
          },
        };
      }
      projectData = envelope.project;
    } else if (envelope.project && typeof envelope.project === "object") {
      // Non-envelope format with a project field (unlikely after migration, but handle gracefully)
      projectData = envelope.project;
    } else {
      // V1 raw project — the whole migrated value is the project
      projectData = migrated;
    }
  } else {
    return {
      success: false,
      error: {
        code: "INVALID_ENVELOPE",
        message: "The migrated project data is not a valid object.",
      },
    };
  }

  // ---- Step 4: Normalize ----
  const normalized = normalizeProject(projectData);
  if (!normalized.success) {
    return {
      success: false,
      error: normalized.error,
    };
  }

  // ---- Step 5: Validate against ProjectSchema ----
  const validation = ProjectSchema.safeParse(normalized.project);
  if (!validation.success) {
    const issues = validation.error.issues.map(
      (issue) => `${issue.path.join(".")} — ${issue.message}`,
    );
    return {
      success: false,
      error: {
        code: "PROJECT_VALIDATION_FAILED",
        message: `Project validation failed: ${issues.join("; ")}`,
        cause: issues.join("; "),
      },
    };
  }

  // ---- Step 6: Enforce import limits ----
  const limitError = validateProjectImportLimits(validation.data);
  if (limitError) {
    return { success: false, error: limitError };
  }

  // ---- Step 7: Return ----
  return {
    success: true,
    project: validation.data,
    formatVersion: CURRENT_FORMAT_VERSION,
    migrationsApplied,
    warnings: migrationWarnings,
  };
}
