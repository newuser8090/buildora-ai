// ---------------------------------------------------------------------------
// LocalExportPublishingProvider — the guaranteed fallback (Phase P7)
//
// "Download website files": runs the canonical export pipeline against the
// snapshot and downloads the site ZIP. Always available, no credentials,
// works offline. Returns no URL (files live on the user's computer).
// ---------------------------------------------------------------------------

import { generateExportProject } from "@/features/export/generators/project-generator";
import { validateProjectForExport } from "@/features/export/validators/export-validator";
import { buildAndDownloadExport } from "@/features/export/zip/zip-builder";
import type {
  PublishInput,
  PublishProgressEvent,
  PublishProgressListener,
  PublishResult,
  PublishingProvider,
  DeploymentRecord,
} from "../types";
import type { Project } from "@/types/project";
import { makePublishError } from "../errors";

export type ExportDownloadFn = (
  folderName: string,
  files: import("@/features/export/pipeline/types").OutputFile[],
) => Promise<unknown>;

const defaultDownload: ExportDownloadFn = (folderName, files) =>
  buildAndDownloadExport(folderName, files);

export class LocalExportPublishingProvider implements PublishingProvider {
  readonly id = "local-export";
  readonly label = "Download website files";
  readonly description =
    "Save your website as files you can use with any hosting provider.";

  private download: ExportDownloadFn;

  constructor(download: ExportDownloadFn = defaultDownload) {
    this.download = download;
  }

  async isAvailable() {
    return { available: true };
  }

  async publish(
    input: PublishInput,
    onProgress: PublishProgressListener,
    _signal?: AbortSignal,
  ): Promise<PublishResult> {
    const project = input.projectSnapshot as Project;

    const emit = (fraction: number, message: string) => {
      const stage: PublishProgressEvent["stage"] =
        fraction >= 1 ? "live" : fraction >= 0.7 ? "publishing" : "preparing";
      onProgress({ stage, fraction, message });
    };

    try {
      emit(0.2, "Checking your site");
      const validation = validateProjectForExport(project);
      if (!validation.valid) {
        return {
          ok: false,
          error: makePublishError(
            "EXPORT_INVALID",
            validation.errors[0] ?? "Your site has a problem that prevents export.",
          ),
        };
      }

      emit(0.5, "Preparing files");
      const { folderName, files } = generateExportProject(project);

      emit(0.85, "Building your download");
      await this.download(folderName, files);

      emit(1, "Ready");
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: makePublishError(
          "BUILD_FAILED",
          err instanceof Error ? err.message : "Failed to prepare your website files.",
        ),
      };
    }
  }

  async getDeployment(_deploymentId: string): Promise<DeploymentRecord | null> {
    return null; // history lives in the deployment store, not the provider
  }

  async listDeployments(_projectId: string): Promise<DeploymentRecord[]> {
    return [];
  }
}
