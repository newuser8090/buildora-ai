// ---------------------------------------------------------------------------
// PublishService — canonical publish pipeline (Phase P7)
//
// 1. validate project (ProjectSchema)
// 2. calculate readiness (non-blocking, informational)
// 3. run export validation (BLOCKING)
// 4. generate export files
// 5. compute deterministic export hash
// 6. create deployment record
// 7. invoke provider (progress)
// 8. update progress
// 9. persist final state
// 10. return success/failure
//
// Publishing NEVER mutates project content: the provider receives a
// deep-cloned snapshot.
// ---------------------------------------------------------------------------

import type { Project } from "@/types/project";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { generateExportProject } from "@/features/export/generators/project-generator";
import { validateProjectForExport } from "@/features/export/validators/export-validator";
import type {
  DeploymentRecord,
  PublishProgressListener,
  PublishRequest,
  PublishServiceResult,
  PublishingProvider,
} from "../types";
import { makePublishError, toPublishError } from "../errors";
import { hashExportFiles, contentHashOfProject } from "./hash";
import type { DeploymentStorageAdapter } from "../storage/deployment-adapter";

export interface PublishServiceDeps {
  provider: PublishingProvider;
  storage: DeploymentStorageAdapter;
  now?: () => string;
  createId?: () => string;
}

function defaultId(): string {
  return `deploy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PublishService {
  private deps: PublishServiceDeps;

  constructor(deps: PublishServiceDeps) {
    this.deps = {
      now: () => new Date().toISOString(),
      createId: defaultId,
      ...deps,
    };
  }

  async publish(
    request: PublishRequest,
    onProgress: PublishProgressListener,
    signal?: AbortSignal,
  ): Promise<PublishServiceResult> {
    const { project, revision, providerId } = request;
    const now = this.deps.now!;
    const createId = this.deps.createId!;

    // 1. Provider availability
    const availability = await this.deps.provider.isAvailable();
    if (!availability.available) {
      return {
        ok: false,
        error: makePublishError(
          "PROVIDER_UNAVAILABLE",
          availability.reason ?? "This publishing option isn't available right now.",
        ),
      };
    }

    // 1b. Project structural validity
    const schema = ProjectSchema.safeParse(project);
    if (!schema.success) {
      return {
        ok: false,
        error: makePublishError(
          "PROJECT_INVALID",
          "Your project has a structural problem that prevents publishing.",
        ),
      };
    }

    // 3. Export validation (blocking)
    const validation = validateProjectForExport(project);
    if (!validation.valid) {
      return {
        ok: false,
        error: makePublishError(
          "EXPORT_INVALID",
          validation.errors[0] ?? "Your site has a problem that prevents publishing.",
        ),
      };
    }

    // 4. Generate export (on a snapshot — never the live project)
    let files;
    try {
      files = generateExportProject(project).files;
    } catch (err) {
      return {
        ok: false,
        error: makePublishError(
          "BUILD_FAILED",
          err instanceof Error ? err.message : "Failed to prepare your site.",
        ),
      };
    }

    // 5. Deterministic export hash + content hash
    const exportHash = hashExportFiles(files);
    const contentHash = contentHashOfProject(project);

    // 6. Create deployment record (status queued)
    const deploymentId = createId();
    const record: DeploymentRecord = {
      id: deploymentId,
      projectId: project.id,
      providerId,
      status: "queued",
      createdAt: now(),
      projectRevision: revision,
      exportHash,
      contentHash,
    };
    await this.deps.storage.createDeployment(record);

    try {
      // 7. Invoke provider with a deep-cloned snapshot
      const snapshot = JSON.parse(JSON.stringify(project)) as Project;
      const result = await this.deps.provider.publish(
        {
          projectId: project.id,
          projectSnapshot: snapshot,
          deploymentId,
          exportHash,
          contentHash,
          idempotencyKey: `${project.id}:${exportHash}`,
        },
        (event) => {
          // 8. Update progress (persist intermediate status)
          const status: DeploymentRecord["status"] =
            event.stage === "building"
              ? "building"
              : event.stage === "publishing"
                ? "uploading"
                : event.stage === "live"
                  ? "live"
                  : "queued";
          void this.deps.storage.updateDeployment(deploymentId, {
            status,
            ...(event.stage === "live" ? { completedAt: now(), activatedAt: now() } : {}),
          });
          onProgress(event);
        },
        signal,
      );

      if (!result.ok) {
        // 9. Persist final failure state (cancellation preserved distinctly).
        const cancelled = result.error?.code === "CANCELLED";
        await this.deps.storage.updateDeployment(deploymentId, {
          status: cancelled ? "cancelled" : "failed",
          completedAt: now(),
          errorCode: result.error?.code,
        });
        return {
          ok: false,
          error: result.error ?? makePublishError("DEPLOY_FAILED", "Publishing failed."),
        };
      }

      // 9. Persist final live state (merge the provider's deploymentPatch —
      //    provider metadata like providerDeploymentId / productionUrl).
      const final = await this.deps.storage.updateDeployment(deploymentId, {
        status: "live",
        completedAt: now(),
        activatedAt: now(),
        url: result.url,
        ...(result.deploymentPatch ?? {}),
      });

      return { ok: true, deployment: final ?? { ...record, status: "live" } };
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "AbortError";
      const error = aborted
        ? makePublishError("CANCELLED", "Publishing was cancelled.")
        : toPublishError(err, "DEPLOY_FAILED");
      await this.deps.storage.updateDeployment(deploymentId, {
        status: aborted ? "cancelled" : "failed",
        completedAt: now(),
        errorCode: error.code,
      });
      return { ok: false, error };
    }
  }
}
