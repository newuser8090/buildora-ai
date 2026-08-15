import type { Project } from "@/types/project";
import { validateProjectForExport } from "../validators/export-validator";
import { generateExportProject } from "../generators/project-generator";
import { buildAndDownloadExport } from "../zip/zip-builder";
import { resolveProjectBindingsForExport } from "@/features/elements/binding/resolve";
import type { CollectionRecords } from "@/features/elements/collections/types";
import type { ExportResult, ExportValidation } from "./types";

// ---------------------------------------------------------------------------
// Export pipeline — validates, generates, zips, and downloads the project
//
// Call this from the UI (Export button) with the current project from the store.
// Returns an ExportResult indicating success or failure.
//
// Phase P22-J — STATIC SNAPSHOT export: collection bindings are resolved at
// export time against the runtime records supplied by the caller and the
// resolved values are baked into the generated site. The exported project is
// a snapshot — no runtime fetching, no secrets, no dynamic code. When records
// are absent, unresolved bindings keep their static fallback props.
// ---------------------------------------------------------------------------

export async function exportProject(
  project: Project,
  options?: { records?: CollectionRecords },
): Promise<ExportResult> {
  // 1. Validate the ORIGINAL project — bindings are still intact so the
  // validator can reject dangling collection references.
  const validation: ExportValidation = validateProjectForExport(project);
  if (!validation.valid) {
    return {
      success: false,
      projectName: project.name || "project",
      fileCount: 0,
      error: `Export validation failed:\n${validation.errors.join("\n")}`,
    };
  }

  // Phase P22-J — resolve bindings into a static snapshot; the resolved
  // values (or static fallbacks for unresolved bindings) are what the export
  // generators bake into the generated site.
  const snapshot = resolveProjectBindingsForExport(project, options?.records);

  // 2. Generate files
  const { folderName, files } = generateExportProject(snapshot);

  // 3. Build ZIP and download
  return await buildAndDownloadExport(folderName, files);
}
