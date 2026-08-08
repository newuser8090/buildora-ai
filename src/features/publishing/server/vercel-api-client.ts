// ---------------------------------------------------------------------------
// Publishing — VercelApiClient (Phase P8, server-only)
//
// The single seam between Buildora's publish routes and the Vercel provider.
// Two implementations:
//   - HttpVercelApiClient — talks to api.vercel.com through an injectable
//     ProviderHttpClient (unit-testable without credentials)
//   - MockVercelApiClient — wraps the in-process MockVercelServer (dev/E2E)
// The route layer never knows which one it is holding.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { DEFAULT_PROVIDER_BASE_URL } from "./provider-http-client";
import type {
  AttachDomainResult,
  DomainStatusResult,
  ListDomainsResult,
} from "../domain/types";
import { makePublishError } from "../errors";
import type { ProviderHttpClient } from "./provider-http-client";
import { providerStatusError } from "./provider-http-client";
import * as mock from "./mock-vercel-server";
import type { DeploymentStatusData } from "./publish-api-types";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ProviderFile {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface VercelApiClient {
  ensureProject(opts: {
    ownerUserId: string;
    name: string;
  }): Promise<{ projectId: string; projectName: string }>;
  createDeployment(opts: {
    ownerUserId: string;
    projectId: string;
    projectName: string;
    files: ProviderFile[];
    target: "production" | "preview";
    idempotencyKey: string;
  }): Promise<{
    providerDeploymentId: string;
    url: string;
    readyState: string;
    previewUrl?: string;
  }>;
  getDeployment(opts: {
    ownerUserId: string;
    providerDeploymentId: string;
  }): Promise<DeploymentStatusData>;
  cancelDeployment(opts: {
    ownerUserId: string;
    providerDeploymentId: string;
  }): Promise<{ providerDeploymentId: string; readyState: string }>;
  deleteDeployment(opts: {
    ownerUserId: string;
    providerDeploymentId: string;
  }): Promise<void>;
  promoteDeployment(opts: {
    ownerUserId: string;
    projectId: string;
    providerDeploymentId: string;
  }): Promise<{ url: string; readyState: string; activatedAt: string }>;
  /** Delete a provider project (and its deployments/domains). */
  deleteProject(opts: { ownerUserId: string; projectName: string }): Promise<void>;
  attachDomain(opts: {
    ownerUserId: string;
    projectId: string;
    domain: string;
  }): Promise<AttachDomainResult>;
  getDomainStatus(opts: {
    ownerUserId: string;
    projectId: string;
    domain: string;
  }): Promise<DomainStatusResult>;
  listDomains(opts: {
    ownerUserId: string;
    projectId: string;
  }): Promise<ListDomainsResult>;
  removeDomain(opts: {
    ownerUserId: string;
    projectId: string;
    domain: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha1Hex(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

function fileBytes(file: ProviderFile): Uint8Array {
  return file.encoding === "base64"
    ? Uint8Array.from(Buffer.from(file.content, "base64"))
    : Uint8Array.from(Buffer.from(file.content, "utf8"));
}

function teamQuery(teamId?: string): string {
  return teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function isMissingEntry(value: unknown): value is { file: string; sha: string; size: number; url?: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.file === "string" && typeof v.sha === "string";
}

// ---------------------------------------------------------------------------
// Real HTTP implementation
// ---------------------------------------------------------------------------

export class HttpVercelApiClient implements VercelApiClient {
  private http: ProviderHttpClient;
  private token: string;
  private teamId?: string;
  private baseUrl: string;

  constructor(options: {
    http: ProviderHttpClient;
    token: string;
    teamId?: string;
    baseUrl?: string;
  }) {
    this.http = options.http;
    this.token = options.token;
    this.teamId = options.teamId;
    this.baseUrl = (options.baseUrl ?? DEFAULT_PROVIDER_BASE_URL).replace(/\/+$/, "");
  }

  /** Absolute provider URL for a path (fixed base — never user-controlled). */
  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { ...authHeaders(this.token), ...(extra ?? {}) };
  }

  private throwForStatus(
    response: { status: number; ok: boolean },
    context: "deploy" | "status" | "cancel" | "delete" | "rollback" | "domain" | "project",
  ): void {
    if (!response.ok) throw providerStatusError(response.status, context);
  }

  async ensureProject(opts: {
    ownerUserId: string;
    name: string;
  }): Promise<{ projectId: string; projectName: string }> {
    const list = await this.http.request({
      method: "GET",
      url: this.url(`/v9/projects?search=${encodeURIComponent(opts.name)}${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(list, "project");
    const projects = (list.json as { projects?: Array<{ id: string; name: string }> })?.projects ?? [];
    const match = projects.find((p) => p.name === opts.name);
    if (match) return { projectId: match.id, projectName: match.name };

    const created = await this.http.request({
      method: "POST",
      url: this.url(`/v10/projects${teamQuery(this.teamId)}`),
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: opts.name, framework: "nextjs" }),
    });
    this.throwForStatus(created, "project");
    const body = (created.json ?? {}) as { id?: string; name?: string };
    return { projectId: body.id ?? "", projectName: body.name ?? opts.name };
  }

  async createDeployment(opts: {
    ownerUserId: string;
    projectId: string;
    projectName: string;
    files: ProviderFile[];
    target: "production" | "preview";
    idempotencyKey: string;
  }): Promise<{
    providerDeploymentId: string;
    url: string;
    readyState: string;
    previewUrl?: string;
  }> {
    const filesMap = opts.files.map((file) => {
      const bytes = fileBytes(file);
      return { file: file.path, sha: sha1Hex(bytes), size: bytes.length };
    });

    const created = await this.http.request({
      method: "POST",
      url: this.url(`/v13/deployments${teamQuery(this.teamId)}`),
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        name: opts.projectName,
        project: opts.projectName,
        files: filesMap,
        projectSettings: { framework: "nextjs" },
        target: opts.target,
      }),
    });
    this.throwForStatus(created, "deploy");

    const body = (created.json ?? {}) as {
      id?: string;
      url?: string;
      readyState?: string;
      previewUrl?: string;
      missing?: unknown[];
    };
    const deploymentId = body.id ?? "";
    if (!deploymentId) {
      throw makePublishError("DEPLOYMENT_CREATE_FAILED", "Starting the publish failed.");
    }

    // Upload any files the provider said are missing.
    const missing = (body.missing ?? []).filter(isMissingEntry);
    const fileByPath = new Map(opts.files.map((f) => [f.path, f]));
    for (const entry of missing) {
      const file = fileByPath.get(entry.file);
      if (!file) continue;
      const bytes = fileBytes(file);
      if (entry.url && entry.url.startsWith("https://")) {
        await this.http.request({
          method: "PUT",
          url: entry.url,
          headers: { "Content-Type": "application/octet-stream" },
          body: bytes,
        });
      } else {
        // Fallback: direct upload endpoint with digest header.
        await this.http.request({
          method: "PUT",
          url: this.url(`/v13/deployments/${encodeURIComponent(deploymentId)}/files${teamQuery(this.teamId)}`),
          headers: {
            "Content-Type": "application/octet-stream",
            "x-vercel-digest": entry.sha,
          },
          body: bytes,
        });
      }
    }

    return {
      providerDeploymentId: deploymentId,
      url: body.url ?? `https://${opts.projectName}.vercel.app`,
      readyState: body.readyState ?? "QUEUED",
      previewUrl: body.previewUrl,
    };
  }

  async getDeployment(opts: {
    ownerUserId: string;
    providerDeploymentId: string;
  }): Promise<DeploymentStatusData> {
    const res = await this.http.request({
      method: "GET",
      url: this.url(`/v13/deployments/${encodeURIComponent(opts.providerDeploymentId)}${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(res, "status");
    const body = (res.json ?? {}) as {
      id?: string;
      url?: string;
      readyState?: string;
      alias?: string[];
      createdAt?: number;
      buildingAt?: number;
      readyAt?: number;
      target?: string;
      errorMessage?: string;
    };
    return {
      providerDeploymentId: opts.providerDeploymentId,
      url: body.url ?? "",
      readyState: body.readyState ?? "QUEUED",
      productionUrl: body.alias?.[0] ? `https://${body.alias[0]}` : undefined,
      buildStartedAt: body.buildingAt ? new Date(body.buildingAt).toISOString() : undefined,
      buildCompletedAt: body.readyAt ? new Date(body.readyAt).toISOString() : undefined,
      errorSummary: body.errorMessage,
    };
  }

  async cancelDeployment(opts: {
    ownerUserId: string;
    providerDeploymentId: string;
  }): Promise<{ providerDeploymentId: string; readyState: string }> {
    const res = await this.http.request({
      method: "POST",
      url: this.url(`/v16/deployments/${encodeURIComponent(opts.providerDeploymentId)}/cancel${teamQuery(this.teamId)}`),
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    this.throwForStatus(res, "cancel");
    const body = (res.json ?? {}) as { readyState?: string };
    return { providerDeploymentId: opts.providerDeploymentId, readyState: body.readyState ?? "CANCELED" };
  }

  async deleteDeployment(opts: {
    ownerUserId: string;
    providerDeploymentId: string;
  }): Promise<void> {
    const res = await this.http.request({
      method: "DELETE",
      url: this.url(`/v13/deployments/${encodeURIComponent(opts.providerDeploymentId)}${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(res, "delete");
  }

  async promoteDeployment(opts: {
    ownerUserId: string;
    projectId: string;
    providerDeploymentId: string;
  }): Promise<{ url: string; readyState: string; activatedAt: string }> {
    const res = await this.http.request({
      method: "POST",
      url: this.url(`/v1/projects/${encodeURIComponent(opts.projectId)}/rollback/${encodeURIComponent(opts.providerDeploymentId)}${teamQuery(this.teamId)}`),
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    this.throwForStatus(res, "rollback");
    const body = (res.json ?? {}) as { url?: string; readyState?: string };
    return {
      url: body.url ?? "",
      readyState: body.readyState ?? "READY",
      activatedAt: new Date().toISOString(),
    };
  }

  async deleteProject(opts: { ownerUserId: string; projectName: string }): Promise<void> {
    const res = await this.http.request({
      method: "DELETE",
      url: this.url(`/v9/projects/${encodeURIComponent(opts.projectName)}${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(res, "project");
  }

  async attachDomain(opts: {
    ownerUserId: string;
    projectId: string;
    domain: string;
  }): Promise<AttachDomainResult> {
    const res = await this.http.request({
      method: "POST",
      url: this.url(`/v10/projects/${encodeURIComponent(opts.projectId)}/domains${teamQuery(this.teamId)}`),
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ name: opts.domain }),
    });
    this.throwForStatus(res, "domain");
    const body = (res.json ?? {}) as {
      name?: string;
      verified?: boolean;
      verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
    };
    return {
      domain: body.name ?? opts.domain,
      status: body.verified ? "verified" : "pending",
      httpsReady: !!body.verified,
      verification: (body.verification ?? []).map((v) => ({
        type: (v.type === "TXT" || v.type === "A" ? v.type : "CNAME") as "CNAME" | "A" | "TXT",
        name: v.domain ?? opts.domain,
        value: v.value ?? "",
        purpose: v.reason ?? "Add this record to connect your domain.",
      })),
    };
  }

  async getDomainStatus(opts: {
    ownerUserId: string;
    projectId: string;
    domain: string;
  }): Promise<DomainStatusResult> {
    const res = await this.http.request({
      method: "GET",
      url: this.url(`/v9/projects/${encodeURIComponent(opts.projectId)}/domains/${encodeURIComponent(opts.domain)}${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(res, "domain");
    const body = (res.json ?? {}) as {
      name?: string;
      verified?: boolean;
      verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
    };
    return {
      domain: body.name ?? opts.domain,
      status: body.verified ? "verified" : "pending",
      httpsReady: !!body.verified,
      verification: (body.verification ?? []).map((v) => ({
        type: (v.type === "TXT" || v.type === "A" ? v.type : "CNAME") as "CNAME" | "A" | "TXT",
        name: v.domain ?? opts.domain,
        value: v.value ?? "",
        purpose: v.reason ?? "Add this record to connect your domain.",
      })),
      providerCode: body.verified ? undefined : "PENDING_DNS",
    };
  }

  async listDomains(opts: {
    ownerUserId: string;
    projectId: string;
  }): Promise<ListDomainsResult> {
    const res = await this.http.request({
      method: "GET",
      url: this.url(`/v9/projects/${encodeURIComponent(opts.projectId)}/domains${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(res, "domain");
    const body = (res.json ?? {}) as { domains?: Array<{ name?: string; verified?: boolean }> };
    return {
      domains: (body.domains ?? []).map((d) => ({
        domain: d.name ?? "",
        status: d.verified ? "verified" : "pending",
        httpsReady: !!d.verified,
        verification: [],
      })),
    };
  }

  async removeDomain(opts: {
    ownerUserId: string;
    projectId: string;
    domain: string;
  }): Promise<void> {
    const res = await this.http.request({
      method: "DELETE",
      url: this.url(`/v9/projects/${encodeURIComponent(opts.projectId)}/domains/${encodeURIComponent(opts.domain)}${teamQuery(this.teamId)}`),
      headers: this.headers(),
    });
    this.throwForStatus(res, "domain");
  }
}

// ---------------------------------------------------------------------------
// Mock implementation (dev/E2E)
// ---------------------------------------------------------------------------

export class MockVercelApiClient implements VercelApiClient {
  async ensureProject(opts: { ownerUserId: string; name: string }) {
    return mock.mockEnsureProject(opts.ownerUserId, opts.name);
  }

  async createDeployment(opts: {
    ownerUserId: string;
    projectId: string;
    projectName: string;
    files: ProviderFile[];
    target: "production" | "preview";
    idempotencyKey: string;
  }) {
    try {
      const result = mock.mockCreateDeployment({
        ownerUserId: opts.ownerUserId,
        projectId: opts.projectId,
        projectName: opts.projectName,
        files: opts.files,
        target: opts.target,
        idempotencyKey: opts.idempotencyKey,
      });
      return {
        providerDeploymentId: result.id,
        url: result.url,
        readyState: result.readyState,
        previewUrl: result.url,
      };
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "deploy");
      }
      throw makePublishError("DEPLOYMENT_CREATE_FAILED", "Starting the demo publish failed.");
    }
  }

  async getDeployment(opts: { ownerUserId: string; providerDeploymentId: string }) {
    try {
      const d = mock.mockGetDeployment(opts.ownerUserId, opts.providerDeploymentId);
      return {
        providerDeploymentId: d.id,
        providerProjectId: d.projectId,
        providerProjectName: d.projectName,
        url: d.url,
        previewUrl: d.previewUrl,
        productionUrl: d.productionUrl,
        readyState: d.readyState,
        buildStartedAt: d.buildStartedAt,
        buildCompletedAt: d.buildCompletedAt,
        errorSummary: d.errorSummary,
      } satisfies DeploymentStatusData;
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "status");
      }
      throw makePublishError("UNKNOWN", "The demo publishing service had a problem.");
    }
  }

  async cancelDeployment(opts: { ownerUserId: string; providerDeploymentId: string }) {
    try {
      const result = mock.mockCancelDeployment(opts.ownerUserId, opts.providerDeploymentId);
      return { providerDeploymentId: result.id, readyState: result.readyState };
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "cancel");
      }
      throw makePublishError("DEPLOYMENT_CANCEL_FAILED", "The demo publish couldn't be cancelled.");
    }
  }

  async deleteDeployment(opts: { ownerUserId: string; providerDeploymentId: string }) {
    try {
      mock.mockDeleteDeployment(opts.ownerUserId, opts.providerDeploymentId);
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "delete");
      }
      throw makePublishError("UNKNOWN", "Couldn't delete the demo deployment.");
    }
  }

  async promoteDeployment(opts: {
    ownerUserId: string;
    projectId: string;
    providerDeploymentId: string;
  }) {
    try {
      return mock.mockPromoteDeployment(opts.ownerUserId, opts.projectId, opts.providerDeploymentId);
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "rollback");
      }
      throw makePublishError("ROLLBACK_FAILED", "Restoring that version failed.");
    }
  }

  async deleteProject(opts: { ownerUserId: string; projectName: string }) {
    try {
      mock.mockDeleteProject(opts.ownerUserId, opts.projectName);
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "project");
      }
      throw makePublishError("UNKNOWN", "Couldn't delete the demo publishing space.");
    }
  }

  async attachDomain(opts: { ownerUserId: string; projectId: string; domain: string }) {
    try {
      return mock.mockAttachDomain(opts.ownerUserId, opts.projectId, opts.domain);
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "domain");
      }
      throw makePublishError("DOMAIN_ATTACH_FAILED", "The domain couldn't be added.");
    }
  }

  async getDomainStatus(opts: { ownerUserId: string; projectId: string; domain: string }) {
    try {
      return mock.mockGetDomainStatus(opts.ownerUserId, opts.projectId, opts.domain);
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "domain");
      }
      throw makePublishError("DOMAIN_VERIFICATION_FAILED", "Couldn't check the domain.");
    }
  }

  async listDomains(opts: { ownerUserId: string; projectId: string }) {
    try {
      const domains = mock.mockListDomains(opts.ownerUserId, opts.projectId);
      return {
        domains: domains.map((d) => ({
          domain: d.domain,
          status: d.status as "pending" | "verified",
          httpsReady: d.httpsReady,
          verification: [],
        })),
      };
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "domain");
      }
      throw makePublishError("UNKNOWN", "Couldn't list domains.");
    }
  }

  async removeDomain(opts: { ownerUserId: string; projectId: string; domain: string }) {
    try {
      mock.mockRemoveDomain(opts.ownerUserId, opts.projectId, opts.domain);
    } catch (err) {
      if (err instanceof mock.MockVercelError) {
        throw providerStatusError(err.status, "domain");
      }
      throw makePublishError("DOMAIN_ATTACH_FAILED", "The domain couldn't be removed.");
    }
  }
}
