// ---------------------------------------------------------------------------
// ProjectExportService
//
// Pure service for exporting a Buildora project to a deterministic JSON file.
// Environment-independent (no React, no browser APIs).
//
// The download step is handled separately by downloadProjectFile().
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import type { ExportProjectResult, ExportProjectOptions, BuildoraProjectExport } from "../types/project-transfer";
import { EXPORT_FORMAT_VERSION, EXPORT_FORMAT_MARKER } from "../types/project-transfer";
import { sanitizeExportFilename } from "../utils/sanitize-export-filename";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProjectExportService {
  /**
   * Export a project to its serialized envelope form.
   *
   * Steps:
   * 1. Validate project via Zod schema
   * 2. Build the export envelope with metadata
   * 3. Serialize to deterministic JSON
   * 4. Generate a safe filename
   *
   * Does NOT mutate the input project.
   * Does NOT trigger a browser download.
   */
  exportProject(
    project: Project,
    options?: ExportProjectOptions,
  ): ExportProjectResult {
    // ---- Step 1: Validate ----
    const validation = ProjectSchema.safeParse(project);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((i) => `${i.path.join(".")} — ${i.message}`)
        .join("; ");
      return {
        ok: false,
        error: {
          code: "EXPORT_SERIALIZATION_FAILED",
          message: `Project validation failed: ${issues}`,
          cause: issues,
        },
      };
    }

    const validProject = validation.data;

    // ---- Step 2: Build envelope ----
    const exportedAt = options?.exportedAt ?? new Date().toISOString();

    const envelope: BuildoraProjectExport = {
      format: EXPORT_FORMAT_MARKER,
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt,
      project: validProject,
      metadata: {
        originalProjectId: validProject.id,
        originalProjectName: validProject.name,
        originalCreatedAt: validProject.createdAt,
        originalUpdatedAt: validProject.updatedAt,
      },
    };

    if (options?.appVersion) {
      envelope.appVersion = options.appVersion;
    }

    // ---- Step 3: Serialize ----
    // Use deterministic key order via a helper that constructs the object
    // with keys in a fixed order before JSON.stringify.
    try {
      const content = serializeExportEnvelope(envelope);
      const filename = sanitizeExportFilename(validProject.name);
      return { ok: true, filename, content, envelope };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "EXPORT_SERIALIZATION_FAILED",
          message: err instanceof Error ? err.message : "Failed to serialize project for export.",
          cause: err,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize the export envelope to deterministic JSON.
 *
 * Uses a fixed key order so that identical projects with the same `exportedAt`
 * produce identical output. Produces pretty-printed JSON with 2-space indent
 * and a trailing newline.
 */
function serializeExportEnvelope(envelope: BuildoraProjectExport): string {
  // Build a new object with deterministic key order
  const ordered: Record<string, unknown> = {
    format: envelope.format,
    formatVersion: envelope.formatVersion,
    exportedAt: envelope.exportedAt,
  };

  if (envelope.appVersion !== undefined) {
    ordered.appVersion = envelope.appVersion;
  }

  ordered.project = envelope.project;

  if (envelope.metadata) {
    ordered.metadata = {
      originalProjectId: envelope.metadata.originalProjectId,
      originalProjectName: envelope.metadata.originalProjectName,
      originalCreatedAt: envelope.metadata.originalCreatedAt,
      originalUpdatedAt: envelope.metadata.originalUpdatedAt,
    };
  }

  return JSON.stringify(ordered, null, 2) + "\n";
}
