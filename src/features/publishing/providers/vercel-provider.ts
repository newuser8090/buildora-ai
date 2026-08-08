"use client";
// ---------------------------------------------------------------------------
// VercelPublishingProvider — the P8 real production provider (client adapter)
//
// This adapter NEVER holds a Vercel token. Every privileged provider call is
// proxied through Buildora server routes (/api/publish/vercel/*), which
// verify the Buildora session server-side and talk to the provider.
//
// publish(): re-runs the canonical export generator on the P7 snapshot
// (same code, same deterministic hash), uploads the files through the server,
// then polls provider status with bounded backoff until terminal. The result
// carries a deploymentPatch that PublishService persists on success.
//
// isAvailable() reads the server status endpoint (cached with a short TTL) —
// missing provider credentials gracefully disable only this provider.
// ---------------------------------------------------------------------------

import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import { validateProjectForExport } from "@/features/export/validators/export-validator";
import { generateExportProject } from "@/features/export/generators/project-generator";
import type { Project } from "@/types/project";
import { VERCEL_CAPABILITIES } from "../capabilities";
import type { PublishingProviderCapabilities } from "../capabilities";
import {
  makePublishError,
  type PublishError,
  type PublishErrorCode,
} from "../errors";
import { getPublishBearerToken } from "../client-auth";
import type {
  DeploymentRecord,
  ProviderAvailability,
  PublishInput,
  PublishProgressEvent,
  PublishProgressListener,
  PublishResult,
  PublishingProvider,
} from "../types";
import type {
  ApiEnvelope,
  DeployResponseData,
  DeploymentStatusData,
} from "../server/publish-api-types";
import type {
  AttachDomainResult,
  DomainProviderClient,
  DomainStatusResult,
  ListDomainsResult,
} from "../domain/types";

export interface VercelProviderOptions {
  /** Injectable fetch for unit tests (defaults to window/global fetch). */
  apiFetch?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => string;
  /** Polling schedule (bounded, respects abort). */
  initialPollIntervalMs?: number;
  maxPollIntervalMs?: number;
  /** Total publish timeout. */
  pollTimeoutMs?: number;
}

const DEFAULT_POLL_INITIAL_MS = 800;
const DEFAULT_POLL_MAX_MS = 4_000;
const DEFAULT_POLL_TIMEOUT_MS = 15 * 60_000;

function defaultFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/** Map a server error code onto the structured publish error model. */
function mapServerCode(code: string, message: string): PublishError {
  const known = new Set<PublishErrorCode>([
    "AUTH_REQUIRED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_AUTH_FAILED",
    "PROVIDER_RATE_LIMITED",
    "PROVIDER_PROJECT_FAILED",
    "ARTIFACT_UPLOAD_FAILED",
    "ARTIFACT_TOO_LARGE",
    "ARTIFACT_INVALID",
    "DEPLOYMENT_CREATE_FAILED",
    "DEPLOYMENT_FAILED",
    "DEPLOYMENT_CANCEL_FAILED",
    "DEPLOYMENT_NOT_FOUND",
    "ROLLBACK_FAILED",
    "RATE_LIMITED",
    "DUPLICATE_PUBLISH",
    "DOMAIN_INVALID",
    "DOMAIN_ATTACH_FAILED",
    "DOMAIN_VERIFICATION_PENDING",
    "DOMAIN_VERIFICATION_FAILED",
    "DOMAIN_ALREADY_IN_USE",
    "DOMAIN_NOT_FOUND",
    "DOMAIN_LIMIT_REACHED",
    "CANCELLED",
    "UNKNOWN",
  ]);
  if (known.has(code as PublishErrorCode)) {
    if (code === "NOT_CONFIGURED") {
      return makePublishError(
        "PROVIDER_UNAVAILABLE",
        "Vercel publishing isn't configured on this Buildora installation.",
      );
    }
    return makePublishError(code as PublishErrorCode, message);
  }
  return makePublishError("UNKNOWN", message);
}

export class VercelPublishingProvider implements PublishingProvider {
  readonly id = "vercel";
  readonly label = "Vercel";
  readonly description =
    "Publish your site to the internet and get a live link.";

  readonly capabilities: PublishingProviderCapabilities = VERCEL_CAPABILITIES;

  private apiFetch: (url: string, init: RequestInit) => Promise<Response>;
  private now: () => string;
  private initialPollIntervalMs: number;
  private maxPollIntervalMs: number;
  private pollTimeoutMs: number;

  /** Domain provider client (server-proxied). */
  readonly domains: DomainProviderClient = {
    attachDomain: (projectId, domain) =>
      this.attachDomain(projectId, domain),
    getDomainStatus: (projectId, domain) =>
      this.getDomainStatus(projectId, domain),
    listDomains: (projectId) => this.listDomains(projectId),
    removeDomain: (projectId, domain) =>
      this.removeDomain(projectId, domain),
  };

  constructor(options: VercelProviderOptions = {}) {
    this.apiFetch = options.apiFetch ?? defaultFetch;
    this.now = options.now ?? (() => new Date().toISOString());
    this.initialPollIntervalMs = options.initialPollIntervalMs ?? DEFAULT_POLL_INITIAL_MS;
    this.maxPollIntervalMs = options.maxPollIntervalMs ?? DEFAULT_POLL_MAX_MS;
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // Availability (cached briefly; never validated on every render)
  // -------------------------------------------------------------------------

  private availabilityCache: { at: number; value: ProviderAvailability } | null = null;

  async isAvailable(): Promise<ProviderAvailability> {
    const now = Date.now();
    if (this.availabilityCache && now - this.availabilityCache.at < 30_000) {
      return this.availabilityCache.value;
    }
    try {
      const res = await this.apiFetch("/api/publish/vercel/status", { method: "GET" });
      const envelope = (await res.json().catch(() => null)) as ApiEnvelope<{
        available: boolean;
        devOnly?: boolean;
        reason?: string;
      }> | null;
      const available = envelope?.ok ? !!envelope.data.available : false;
      const value: ProviderAvailability = {
        available,
        devOnly: envelope?.ok ? envelope.data.devOnly : undefined,
        reason: envelope?.ok ? envelope.data.reason : undefined,
        capabilities: available ? VERCEL_CAPABILITIES : undefined,
      };
      this.availabilityCache = { at: now, value };
      return value;
    } catch {
      const value: ProviderAvailability = { available: false };
      this.availabilityCache = { at: now, value };
      return value;
    }
  }

  /** Test hook — clear the availability cache. */
  _resetAvailabilityCache(): void {
    this.availabilityCache = null;
  }

  // -------------------------------------------------------------------------
  // Publish (upload artifact + bounded polling to terminal state)
  // -------------------------------------------------------------------------

  async publish(
    input: PublishInput,
    onProgress: PublishProgressListener,
    signal?: AbortSignal,
  ): Promise<PublishResult> {
    const emit = (stage: PublishProgressEvent["stage"], fraction: number, message: string) => {
      onProgress({ stage, fraction, message });
    };

    emit("checking", 0.05, "Checking your site");

    const project = input.projectSnapshot as Project;

    const schema = ProjectSchema.safeParse(project);
    if (!schema.success) {
      return { ok: false, error: makePublishError("PROJECT_INVALID", "Your project has a structural problem that prevents publishing.") };
    }
    const validation = validateProjectForExport(project);
    if (!validation.valid) {
      return {
        ok: false,
        error: makePublishError("EXPORT_INVALID", validation.errors[0] ?? "Your site has a problem that prevents publishing."),
      };
    }

    let files;
    try {
      files = generateExportProject(project).files;
    } catch (err) {
      return {
        ok: false,
        error: makePublishError("BUILD_FAILED", err instanceof Error ? err.message : "Failed to prepare your site."),
      };
    }

    emit("preparing", 0.2, "Preparing files");
    await this.wait(50, signal).catch(() => undefined);

    const token = await getPublishBearerToken();
    if (!token) {
      return {
        ok: false,
        error: makePublishError("AUTH_REQUIRED", "Sign in to publish your site to the internet."),
      };
    }

    // Upload the artifact through the Buildora server (credentials stay there).
    const deploy = await this.request<DeployResponseData>(
      "/api/publish/vercel/deploy",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          projectId: project.id,
          deploymentId: input.deploymentId,
          exportHash: input.exportHash,
          contentHash: input.contentHash,
          projectName: project.name,
          idempotencyKey: input.idempotencyKey,
          files,
        }),
      },
    );
    if (!deploy.ok) {
      return { ok: false, error: deploy.error };
    }
    const data = deploy.data;

    emit("publishing", 0.45, "Uploading to the publishing service");
    await this.wait(120, signal).catch(() => undefined);

    // Bounded polling to a terminal state (queued → building → live).
    let interval = this.initialPollIntervalMs;
    const startedAt = Date.now();
    while (true) {
      if (signal?.aborted) {
        await this.bestEffortCancel(data.providerDeploymentId, token);
        return {
          ok: false,
          error: makePublishError("CANCELLED", "Publishing was cancelled."),
        };
      }
      if (Date.now() - startedAt > this.pollTimeoutMs) {
        return {
          ok: false,
          error: makePublishError("DEPLOY_FAILED", "Publishing took too long. Check the build details and try again."),
        };
      }

      const status = await this.request<DeploymentStatusData>(
        `/api/publish/vercel/deployments/${encodeURIComponent(data.providerDeploymentId)}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      );
      if (!status.ok) {
        return { ok: false, error: status.error };
      }

      const readyState = (status.data.readyState ?? "QUEUED").toUpperCase();
      if (readyState === "READY") {
        const productionUrl = status.data.productionUrl ?? status.data.url;
        emit("live", 1, "Live");
        return {
          ok: true,
          url: productionUrl,
          deploymentPatch: {
            providerDeploymentId: data.providerDeploymentId,
            providerProjectId: status.data.providerProjectId,
            providerProjectName: status.data.providerProjectName,
            providerState: "READY",
            deploymentUrl: status.data.url,
            productionUrl,
            previewUrl: status.data.previewUrl,
            buildStartedAt: status.data.buildStartedAt,
            buildCompletedAt: status.data.buildCompletedAt,
            ownerUserId: data.ownerUserId,
          },
        };
      }
      if (readyState === "ERROR") {
        return {
          ok: false,
          error: makePublishError(
            "DEPLOYMENT_FAILED",
            status.data.errorSummary ?? "Your site couldn't finish publishing.",
          ),
        };
      }
      if (readyState === "CANCELED") {
        return { ok: false, error: makePublishError("CANCELLED", "Publishing was cancelled.") };
      }

      // Queued / building / initializing.
      emit(
        readyState === "BUILDING" ? "building" : "publishing",
        readyState === "BUILDING" ? 0.7 : 0.55,
        readyState === "BUILDING" ? "Building your site" : "Preparing your site",
      );
      await this.wait(interval, signal).catch(() => undefined);
      interval = Math.min(interval * 1.6, this.maxPollIntervalMs);
    }
  }

  // -------------------------------------------------------------------------
  // Management (server-proxied)
  // -------------------------------------------------------------------------

  async getDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    const token = await getPublishBearerToken();
    if (!token) return null;
    const res = await this.request<DeploymentStatusData>(
      `/api/publish/vercel/deployments/${encodeURIComponent(deploymentId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    return {
      id: deploymentId,
      projectId: "",
      providerId: this.id,
      status: mapReadyState(res.data.readyState),
      createdAt: this.now(),
      projectRevision: 0,
      exportHash: "",
      contentHash: "",
      providerDeploymentId: res.data.providerDeploymentId,
      url: res.data.url,
      productionUrl: res.data.productionUrl,
    };
  }

  async listDeployments(_projectId: string): Promise<DeploymentRecord[]> {
    return []; // history lives in the deployment store, not the provider
  }

  async rollback(deploymentId: string, projectId?: string): Promise<DeploymentRecord> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage publishing.");
    if (!projectId) throw makePublishError("ROLLBACK_FAILED", "Restoring that version failed.");
    const res = await this.request<{ readyState: string; url: string; activatedAt: string }>(
      `/api/publish/vercel/deployments/${encodeURIComponent(deploymentId)}/rollback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId }),
      },
    );
    if (!res.ok) throw res.error;
    return {
      id: deploymentId,
      projectId,
      providerId: this.id,
      status: "live",
      createdAt: this.now(),
      completedAt: this.now(),
      projectRevision: 0,
      exportHash: "",
      contentHash: "",
      activatedAt: res.data.activatedAt,
      providerState: res.data.readyState,
      url: res.data.url,
    };
  }

  async cancel(deploymentId: string, _projectId?: string): Promise<DeploymentRecord> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage publishing.");
    const res = await this.request<{ readyState: string }>(
      `/api/publish/vercel/deployments/${encodeURIComponent(deploymentId)}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) throw res.error;
    return {
      id: deploymentId,
      projectId: "",
      providerId: this.id,
      status: "cancelled",
      createdAt: this.now(),
      completedAt: this.now(),
      projectRevision: 0,
      exportHash: "",
      contentHash: "",
      providerState: res.data.readyState,
    };
  }

  async deleteDeployment(deploymentId: string, _projectId?: string): Promise<void> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage publishing.");
    const res = await this.request<null>(
      `/api/publish/vercel/deployments/${encodeURIComponent(deploymentId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw res.error;
  }

  /**
   * Delete the provider project (the published site). Only ever called after
   * the user explicitly opts in during project deletion.
   */
  async deleteProject(projectId: string): Promise<void> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage publishing.");
    const res = await this.request<null>(
      `/api/publish/vercel/projects?projectId=${encodeURIComponent(projectId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw res.error;
  }

  // -------------------------------------------------------------------------
  // Domains (DomainProviderClient, server-proxied)
  // -------------------------------------------------------------------------

  private async attachDomain(projectId: string, domain: string): Promise<AttachDomainResult> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage domains.");
    const res = await this.request<AttachDomainResult>("/api/publish/vercel/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId, domain }),
    });
    if (!res.ok) throw res.error;
    return res.data;
  }

  private async getDomainStatus(projectId: string, domain: string): Promise<DomainStatusResult> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage domains.");
    const res = await this.request<DomainStatusResult>(
      `/api/publish/vercel/domains/${encodeURIComponent(domain)}/status?projectId=${encodeURIComponent(projectId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw res.error;
    return res.data;
  }

  private async listDomains(projectId: string): Promise<ListDomainsResult> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage domains.");
    const res = await this.request<ListDomainsResult>(
      `/api/publish/vercel/domains?projectId=${encodeURIComponent(projectId)}`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw res.error;
    return res.data;
  }

  private async removeDomain(projectId: string, domain: string): Promise<void> {
    const token = await getPublishBearerToken();
    if (!token) throw makePublishError("AUTH_REQUIRED", "Sign in to manage domains.");
    const res = await this.request<null>(
      `/api/publish/vercel/domains/${encodeURIComponent(domain)}?projectId=${encodeURIComponent(projectId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw res.error;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async request<T>(url: string, init: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: PublishError }> {
    let response: Response;
    try {
      response = await this.apiFetch(url, init);
    } catch {
      return {
        ok: false,
        error: makePublishError("NETWORK_FAILED", "Couldn't reach the publishing service. Check your connection and try again."),
      };
    }
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    if (response.ok && envelope?.ok) {
      return { ok: true, data: envelope.data };
    }
    const error = envelope && !envelope.ok ? envelope.error : null;
    return {
      ok: false,
      error: error
        ? mapServerCode(error.code, error.message)
        : makePublishError("UNKNOWN", "Something went wrong. Please try again."),
    };
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

  private async bestEffortCancel(providerDeploymentId: string, token: string): Promise<void> {
    try {
      await this.apiFetch(
        `/api/publish/vercel/deployments/${encodeURIComponent(providerDeploymentId)}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        },
      );
    } catch {
      // Best effort — cancellation is never fatal.
    }
  }
}

function mapReadyState(readyState: string): DeploymentRecord["status"] {
  switch ((readyState ?? "").toUpperCase()) {
    case "READY":
      return "live";
    case "BUILDING":
      return "building";
    case "ERROR":
      return "failed";
    case "CANCELED":
      return "cancelled";
    default:
      return "queued";
  }
}
