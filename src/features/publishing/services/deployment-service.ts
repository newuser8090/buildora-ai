// ---------------------------------------------------------------------------
// DeploymentService — history, active deployment, unpublished changes,
// rollback, and delete (Phase P7).
//
// "Active" deployment = the live deployment with the newest activatedAt
// (rollback refreshes activatedAt without touching project content).
// ---------------------------------------------------------------------------

import type { DeploymentRecord, PublishStatus } from "../types";
import type { DeploymentStorageAdapter } from "../storage/deployment-adapter";
import { makePublishError, type PublishError } from "../errors";
import { contentHashOfProject } from "./hash";
import type { Project } from "@/types/project";

export class DeploymentService {
  private storage: DeploymentStorageAdapter;
  private now: () => string;

  constructor(storage: DeploymentStorageAdapter, now?: () => string) {
    this.storage = storage;
    this.now = now ?? (() => new Date().toISOString());
  }

  async listDeployments(projectId: string): Promise<DeploymentRecord[]> {
    return this.storage.listDeployments(projectId);
  }

  /** The live deployment that is currently active (newest activatedAt). */
  async getActiveDeployment(projectId: string): Promise<DeploymentRecord | null> {
    const all = await this.storage.listDeployments(projectId);
    const live = all.filter((d) => d.status === "live");
    if (live.length === 0) return null;
    return live.sort((a, b) =>
      (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
        a.activatedAt ?? a.completedAt ?? a.createdAt,
      ),
    )[0];
  }

  /**
   * Publish status derived from deployment history + current project state.
   * Never stored in the project — always derived.
   */
  async getPublishStatus(
    project: Project,
    revision: number,
  ): Promise<PublishStatus> {
    const active = await this.getActiveDeployment(project.id);
    if (!active) return "never-published";

    const currentHash = contentHashOfProject(project);
    if (currentHash !== active.contentHash) return "changes-unpublished";
    if (revision > active.projectRevision) return "changes-unpublished";
    return "published";
  }

  /** True when the project has content not present in the active deployment. */
  async hasUnpublishedChanges(
    project: Project,
    revision: number,
  ): Promise<boolean> {
    return (await this.getPublishStatus(project, revision)) === "changes-unpublished";
  }

  /**
   * Rollback to a past live deployment. NEVER touches project content.
   * Refreshes activatedAt on the target; providers without rollback throw
   * ROLLBACK_UNSUPPORTED.
   */
  async rollback(
    projectId: string,
    deploymentId: string,
    providerRollback?: (id: string, projectId?: string) => Promise<DeploymentRecord>,
  ): Promise<{ ok: true; deployment: DeploymentRecord } | { ok: false; error: PublishError }> {
    try {
      if (!providerRollback) {
        return {
          ok: false,
          error: makePublishError(
            "ROLLBACK_UNSUPPORTED",
            "This publishing option doesn't support restoring older versions.",
          ),
        };
      }
      const deployment = await this.storage.getDeployment(deploymentId);
      if (!deployment || deployment.projectId !== projectId) {
        return {
          ok: false,
          error: makePublishError("DEPLOYMENT_NOT_FOUND", "That deployment no longer exists."),
        };
      }
      // The provider manages deployments by ITS id (providerDeploymentId),
      // never the local Buildora id — passing the local id would 404 on the
      // provider (real Vercel and the dev mock server both key by dpl-...).
      const updated = await providerRollback(
        deployment.providerDeploymentId ?? deploymentId,
        projectId,
      );
      await this.storage.updateDeployment(deploymentId, {
        activatedAt: updated.activatedAt ?? this.now(),
        status: "live",
      });
      const final = await this.storage.getDeployment(deploymentId);
      return { ok: true, deployment: final ?? updated };
    } catch (err) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        "message" in err
      ) {
        return { ok: false, error: err as PublishError };
      }
      return {
        ok: false,
        error: makePublishError("UNKNOWN", "Could not restore that version."),
      };
    }
  }

  async deleteDeployment(
    deploymentId: string,
    providerDelete?: (id: string) => Promise<void>,
  ): Promise<{ ok: true } | { ok: false; error: PublishError }> {
    try {
      const deployment = await this.storage.getDeployment(deploymentId);
      // Same provider-id contract as rollback (see above).
      await providerDelete?.(deployment?.providerDeploymentId ?? deploymentId);
      await this.storage.removeDeployment(deploymentId);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error:
          err && typeof err === "object" && "code" in err && "message" in err
            ? (err as PublishError)
            : makePublishError("UNKNOWN", "Could not delete that deployment."),
      };
    }
  }

  /** Remove all deployment history for a project (on project deletion). */
  async removeDeploymentsForProject(projectId: string): Promise<void> {
    await this.storage.removeDeploymentsForProject(projectId);
  }
}
