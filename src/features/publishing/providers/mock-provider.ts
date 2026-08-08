// ---------------------------------------------------------------------------
// MockPublishingProvider — dev/E2E only (Phase P7)
//
// Simulates prepare → build → upload → live (or failed/cancelled) with
// deterministic delays. Returns a demo URL that opens the internal visitor
// preview route — it is NOT internet-public and is labeled "Demo site".
//
// E2E determinism: stage durations are injectable and short by default.
// ---------------------------------------------------------------------------

import type {
  DeploymentRecord,
  PublishInput,
  PublishProgressListener,
  PublishResult,
  PublishingProvider,
  PublishStage,
} from "../types";
import { makePublishError } from "../errors";
import { MOCK_CAPABILITIES } from "../capabilities";
import type { PublishingProviderCapabilities } from "../capabilities";

export interface MockProviderOptions {
  /** Stage durations in ms. Defaults keep E2E fast. */
  durations?: Record<PublishStage, number>;
  /** Force failure at a stage (for tests). */
  failAt?: PublishStage;
  /** Error code to surface on failure. */
  failCode?: PublishErrorCodeLike;
  /** Clock for deterministic timestamps. */
  now?: () => string;
  /** Base for the demo URL. */
  origin?: string;
}

type PublishErrorCodeLike =
  | "BUILD_FAILED"
  | "UPLOAD_FAILED"
  | "DEPLOY_FAILED"
  | "NETWORK_FAILED";

const DEFAULT_DURATIONS: Record<PublishStage, number> = {
  checking: 150,
  preparing: 250,
  building: 400,
  publishing: 300,
  live: 0,
};

const STAGE_ORDER: PublishStage[] = [
  "checking",
  "preparing",
  "building",
  "publishing",
  "live",
];

const STAGE_MESSAGES: Record<PublishStage, string> = {
  checking: "Checking your site",
  preparing: "Preparing files",
  building: "Building your site",
  publishing: "Publishing",
  live: "Live",
};

export class MockPublishingProvider implements PublishingProvider {
  readonly id = "mock";
  readonly label = "Demo publish";
  readonly description =
    "A practice publish that shows how publishing works. Your site is not put on the real internet.";
  readonly capabilities: PublishingProviderCapabilities = MOCK_CAPABILITIES;

  private durations: Record<PublishStage, number>;
  private failAt?: PublishStage;
  private failCode: PublishErrorCodeLike;
  private now: () => string;
  private origin: string;

  /** In-memory deployment store (persistent for the session; E2E-visible). */
  private deployments = new Map<string, DeploymentRecord>();

  constructor(options: MockProviderOptions = {}) {
    this.durations = { ...DEFAULT_DURATIONS, ...options.durations };
    this.failAt = options.failAt;
    this.failCode = options.failCode ?? "BUILD_FAILED";
    this.now = options.now ?? (() => new Date().toISOString());
    this.origin =
      options.origin ??
      (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
  }

  /** Test hook: seed a deployment or reset the in-memory store. */
  _seed(deployment: DeploymentRecord): void {
    this.deployments.set(deployment.id, deployment);
  }

  _reset(): void {
    this.deployments.clear();
  }

  async isAvailable() {
    return { available: true, devOnly: true, capabilities: MOCK_CAPABILITIES };
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  async publish(
    input: PublishInput,
    onProgress: PublishProgressListener,
    signal?: AbortSignal,
  ): Promise<PublishResult> {
    const deploymentId = input.deploymentId;
    const seed: DeploymentRecord = {
      id: deploymentId,
      projectId: input.projectId,
      providerId: this.id,
      status: "queued",
      createdAt: this.now(),
      projectRevision: 0,
      exportHash: input.exportHash,
      contentHash: "",
    };
    this.deployments.set(deploymentId, seed);

    try {
      for (const stage of STAGE_ORDER) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

        const isLast = stage === "live";
        const duration = this.durations[stage];
        if (duration > 0) await this.wait(duration, signal);

        if (this.failAt === stage && !isLast) {
          const failed: DeploymentRecord = {
            ...seed,
            status: "failed",
            completedAt: this.now(),
            errorCode: this.failCode,
          };
          this.deployments.set(deploymentId, failed);
          return {
            ok: false,
            error: makePublishError(this.failCode, failureMessage(this.failCode)),
          };
        }

        const status: DeploymentRecord["status"] = isLast
          ? "live"
          : stage === "building"
            ? "building"
            : stage === "publishing"
              ? "uploading"
              : "queued";

        const next: DeploymentRecord = {
          ...seed,
          status,
          ...(isLast
            ? {
                completedAt: this.now(),
                url: this.demoUrl(input.projectId),
                activatedAt: this.now(),
              }
            : {}),
        };
        this.deployments.set(deploymentId, next);

        const fraction = STAGE_ORDER.indexOf(stage) / (STAGE_ORDER.length - 1);
        onProgress({ stage, fraction, message: STAGE_MESSAGES[stage] });
      }

      const final = this.deployments.get(deploymentId)!;
      return { ok: true, url: final.url };
    } catch (err) {
      const aborted =
        err instanceof DOMException && err.name === "AbortError";
      const cancelled: DeploymentRecord = {
        ...(this.deployments.get(deploymentId) ?? seed),
        status: "cancelled",
        completedAt: this.now(),
        errorCode: aborted ? "CANCELLED" : undefined,
      };
      this.deployments.set(deploymentId, cancelled);
      return {
        ok: false,
        error: aborted
          ? makePublishError("CANCELLED", "Publishing was cancelled.")
          : makePublishError("DEPLOY_FAILED", "The demo publish failed."),
      };
    }
  }

  private demoUrl(projectId: string): string {
    return `${this.origin}/preview/${projectId}`;
  }

  async getDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    return this.deployments.get(deploymentId) ?? null;
  }

  async listDeployments(projectId: string): Promise<DeploymentRecord[]> {
    return [...this.deployments.values()]
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Rollback semantics (mock): marks the target deployment as the active one
   * by refreshing its activatedAt. The project's editor content is never
   * touched — only which deployment is "current".
   */
  async rollback(deploymentId: string, _projectId?: string): Promise<DeploymentRecord> {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw makePublishError("DEPLOYMENT_NOT_FOUND", "That deployment no longer exists.");
    }
    if (deployment.status !== "live") {
      throw makePublishError(
        "DEPLOYMENT_NOT_FOUND",
        "Only a live deployment can be restored.",
      );
    }
    const next: DeploymentRecord = {
      ...deployment,
      activatedAt: this.now(),
    };
    this.deployments.set(deploymentId, next);
    return next;
  }

  async deleteDeployment(deploymentId: string): Promise<void> {
    this.deployments.delete(deploymentId);
  }
}

function failureMessage(code: PublishErrorCodeLike): string {
  switch (code) {
    case "BUILD_FAILED":
      return "Building your demo site failed. Please try again.";
    case "UPLOAD_FAILED":
      return "Uploading the demo site failed. Please try again.";
    case "NETWORK_FAILED":
      return "A network problem interrupted the demo publish.";
    default:
      return "The demo publish failed. Please try again.";
  }
}
