import type { Project } from "@/types/project";
import { validateProjectForExport } from "../validators/export-validator";
import { generateExportProject } from "../generators/project-generator";
import { buildAndDownloadExport } from "../zip/zip-builder";
import type { ExportResult, ExportValidation } from "./types";

// ---------------------------------------------------------------------------
// Export pipeline — validates, generates, zips, and downloads the project
//
// Call this from the UI (Export button) with the current project from the store.
// Returns an ExportResult indicating success or failure.
// ---------------------------------------------------------------------------

export async function exportProject(project: Project): Promise<ExportResult> {
  // 1. Validate
  const validation: ExportValidation = validateProjectForExport(project);
  if (!validation.valid) {
    return {
      success: false,
      projectName: project.name || "project",
      fileCount: 0,
      error: `Export validation failed:\n${validation.errors.join("\n")}`,
    };
  }

  // 2. Generate files
  const { folderName, files } = generateExportProject(project);

  // 3. Build ZIP and download
  return await buildAndDownloadExport(folderName, files);
}
