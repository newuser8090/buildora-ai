// ---------------------------------------------------------------------------
// Publishing — DomainService (Phase P8)
//
// Client-side orchestration for custom domains:
//   - validates user input (beginner safe)
//   - attaches the domain through the provider adapter (server route)
//   - persists the DeploymentDomainRecord locally (provider = source of truth)
//   - re-checks verification and reflects "verified" onto the active
//     deployment (productionUrl / domainIds)
//   - removes domains (provider first, local record after)
//
// Never accepts DNS/registrar credentials; DNS management stays with the
// user. Never mutates ProjectSchema.
// ---------------------------------------------------------------------------

import type { DeploymentRecord } from "../types";
import type { DeploymentStorageAdapter } from "../storage/deployment-adapter";
import type {
  DeploymentDomainRecord,
  DomainProviderClient,
  DomainStatus,
} from "./types";
import { validateDomainInput } from "./domain-utils";
import type { DomainStorageAdapter } from "./domain-storage";
import type { PublishError } from "../errors";
import { makePublishError } from "../errors";

export type DomainServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PublishError };

export class DomainService {
  private storage: DomainStorageAdapter;
  private deployments: DeploymentStorageAdapter;
  private provider: DomainProviderClient;
  private providerId: string;
  private now: () => string;

  constructor(deps: {
    storage: DomainStorageAdapter;
    deployments: DeploymentStorageAdapter;
    provider: DomainProviderClient;
    providerId: string;
    now?: () => string;
  }) {
    this.storage = deps.storage;
    this.deployments = deps.deployments;
    this.provider = deps.provider;
    this.providerId = deps.providerId;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async listDomains(projectId: string): Promise<DeploymentDomainRecord[]> {
    return this.storage.listDomains(projectId);
  }

  /** The primary (first verified) domain for a project, if any. */
  async getPrimaryDomain(projectId: string): Promise<DeploymentDomainRecord | null> {
    const domains = await this.storage.listDomains(projectId);
    const verified = domains.filter((d) => d.status === "verified");
    if (verified.length === 0) return null;
    return verified.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  }

  /**
   * Attach a domain. Validates input, rejects duplicates, calls the
   * provider, then persists the local record.
   */
  async attach(
    projectId: string,
    input: string,
    deploymentId?: string,
  ): Promise<DomainServiceResult<DeploymentDomainRecord>> {
    const validation = validateDomainInput(input);
    if (!validation.valid || !validation.normalized) {
      return {
        ok: false,
        error: makePublishError("DOMAIN_INVALID", validation.error ?? "Invalid domain."),
      };
    }
    const domain = validation.normalized;

    const existing = await this.storage.getDomain(domain);
    if (existing && existing.projectId === projectId) {
      return {
        ok: false,
        error: makePublishError(
          "DOMAIN_ALREADY_IN_USE",
          "That domain is already connected to this project.",
        ),
      };
    }

    let result;
    try {
      result = await this.provider.attachDomain(projectId, domain);
    } catch (err) {
      return {
        ok: false,
        error: toDomainError(err, "DOMAIN_ATTACH_FAILED"),
      };
    }

    const now = this.now();
    const primary = (await this.storage.listDomains(projectId)).length === 0;
    const record: DeploymentDomainRecord = {
      id: domain,
      projectId,
      deploymentId,
      providerId: this.providerId,
      domain,
      status: result.status,
      createdAt: now,
      updatedAt: now,
      verification: result.verification,
      primary,
      httpsReady: result.httpsReady,
    };
    await this.storage.createDomain(record);

    // Reflect verification immediately when the provider already considers
    // the domain verified (very rare) — otherwise stay pending.
    if (result.status === "verified") {
      await this.markVerified(projectId, domain);
    }

    return { ok: true, value: record };
  }

  /**
   * Re-check verification state from the provider and update the local
   * record. Pending/misconfigured stay non-blocking; verified updates the
   * active deployment.
   */
  async refreshStatus(
    record: DeploymentDomainRecord,
  ): Promise<DomainServiceResult<DeploymentDomainRecord>> {
    let result;
    try {
      result = await this.provider.getDomainStatus(record.projectId, record.domain);
    } catch (err) {
      const error = toDomainError(err, "DOMAIN_VERIFICATION_FAILED");
      if (error.code === "DOMAIN_NOT_FOUND") {
        const updated = await this.storage.updateDomain(record.id, {
          status: "failed",
          updatedAt: this.now(),
          errorSummary: "This domain is no longer connected on the hosting side.",
        });
        return { ok: true, value: updated ?? record };
      }
      return { ok: false, error };
    }

    const status: DomainStatus =
      result.status === "verified" ? "verified" : result.status;

    const updated = await this.storage.updateDomain(record.id, {
      status,
      verification: result.verification.length > 0 ? result.verification : record.verification,
      httpsReady: result.httpsReady,
      updatedAt: this.now(),
      errorSummary:
        status === "failed" ? "We couldn't verify your domain. Check the records and try again." : undefined,
    });

    const finalRecord = updated ?? record;
    if (status === "verified") {
      await this.markVerified(record.projectId, record.domain);
    }
    return { ok: true, value: finalRecord };
  }

  /** Remove a domain: provider first, local record after. */
  async remove(record: DeploymentDomainRecord): Promise<DomainServiceResult<void>> {
    try {
      await this.provider.removeDomain(record.projectId, record.domain);
    } catch (err) {
      const error = toDomainError(err, "DOMAIN_ATTACH_FAILED");
      // A 404 means the provider already dropped it — still remove locally.
      if (error.code !== "DOMAIN_NOT_FOUND") {
        return { ok: false, error };
      }
    }
    await this.storage.removeDomain(record.id);
    // Clear the domain from the active deployment record.
    const active = await this.activeDeployment(record.projectId);
    if (active && (active.domainIds?.includes(record.domain) || active.productionUrl === `https://${record.domain}`)) {
      await this.deployments.updateDeployment(active.id, {
        domainIds: (active.domainIds ?? []).filter((d) => d !== record.domain),
        ...(active.productionUrl === `https://${record.domain}`
          ? { productionUrl: active.deploymentUrl }
          : {}),
      });
    }
    return { ok: true, value: undefined };
  }

  /** Remove all domain records for a project (on project deletion). */
  async removeDomainsForProject(projectId: string): Promise<void> {
    await this.storage.removeDomainsForProject(projectId);
  }

  // -------------------------------------------------------------------------

  private async markVerified(projectId: string, domain: string): Promise<void> {
    // Promote to primary if no verified domain yet.
    const domains = await this.storage.listDomains(projectId);
    const hasPrimary = domains.some((d) => d.status === "verified" && d.primary);
    if (!hasPrimary) {
      for (const d of domains) {
        if (d.id === domain) {
          await this.storage.updateDomain(d.id, { primary: true });
        } else {
          await this.storage.updateDomain(d.id, { primary: false });
        }
      }
    }
    // Reflect the custom domain on the active deployment.
    const active = await this.activeDeployment(projectId);
    if (active) {
      const domainIds = active.domainIds ?? [];
      await this.deployments.updateDeployment(active.id, {
        domainIds: domainIds.includes(domain) ? domainIds : [...domainIds, domain],
        productionUrl: `https://${domain}`,
      });
    }
  }

  private async activeDeployment(projectId: string): Promise<DeploymentRecord | null> {
    const all = await this.deployments.listDeployments(projectId);
    const live = all.filter((d) => d.status === "live");
    if (live.length === 0) return null;
    return live.sort((a, b) =>
      (b.activatedAt ?? b.completedAt ?? b.createdAt).localeCompare(
        a.activatedAt ?? a.completedAt ?? a.createdAt,
      ),
    )[0];
  }
}

function toDomainError(err: unknown, fallback: PublishError["code"]): PublishError {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    "message" in err
  ) {
    const e = err as { code: unknown; message: unknown };
    if (typeof e.code === "string" && typeof e.message === "string") {
      return { code: e.code as PublishError["code"], message: e.message };
    }
  }
  return makePublishError(fallback, "Something went wrong. Please try again.");
}
