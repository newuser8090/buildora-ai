// ---------------------------------------------------------------------------
// Publishing — DomainService tests (Phase P8)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { DomainService } from "../domain-service";
import type { DomainStorageAdapter } from "../domain-storage";
import type { DeploymentStorageAdapter } from "../../storage/deployment-adapter";
import type {
  DeploymentDomainRecord,
  DomainProviderClient,
  DomainStatus,
  AttachDomainResult,
  DomainStatusResult,
} from "../types";
import type { DeploymentRecord } from "../../types";

const NOW = "2026-01-01T00:00:00.000Z";

class MemoryDomains implements DomainStorageAdapter {
  records = new Map<string, DeploymentDomainRecord>();
  async createDomain(r: DeploymentDomainRecord) { this.records.set(r.id, { ...r }); return r; }
  async updateDomain(id: string, patch: Partial<DeploymentDomainRecord>) {
    const existing = this.records.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id };
    this.records.set(id, next);
    return next;
  }
  async getDomain(id: string) { return this.records.get(id) ?? null; }
  async listDomains(projectId: string) {
    return [...this.records.values()].filter((r) => r.projectId === projectId);
  }
  async removeDomain(id: string) { this.records.delete(id); }
  async removeDomainsForProject(projectId: string) {
    for (const [id, r] of this.records) if (r.projectId === projectId) this.records.delete(id);
  }
  close() {}
}

class MemoryDeployments implements DeploymentStorageAdapter {
  records = new Map<string, DeploymentRecord>();
  async createDeployment(r: DeploymentRecord) { this.records.set(r.id, { ...r }); return r; }
  async updateDeployment(id: string, patch: Partial<DeploymentRecord>) {
    const existing = this.records.get(id);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id };
    this.records.set(id, next);
    return next;
  }
  async getDeployment(id: string) { return this.records.get(id) ?? null; }
  async listDeployments(projectId: string) {
    return [...this.records.values()].filter((r) => r.projectId === projectId);
  }
  async removeDeployment(id: string) { this.records.delete(id); }
  async removeDeploymentsForProject(projectId: string) {
    for (const [id, r] of this.records) if (r.projectId === projectId) this.records.delete(id);
  }
  close() {}
}

class FakeDomainProvider implements DomainProviderClient {
  attached: Array<{ projectId: string; domain: string }> = [];
  removed: Array<{ projectId: string; domain: string }> = [];
  statusResult: "pending" | "verified" | "failed" = "pending";
  failWith: { code: string; message: string } | null = null;

  async attachDomain(projectId: string, domain: string): Promise<AttachDomainResult> {
    if (this.failWith) throw this.failWith;
    this.attached.push({ projectId, domain });
    return {
      domain,
      status: (this.statusResult === "verified" ? "verified" : "pending") as DomainStatus,
      httpsReady: this.statusResult === "verified",
      verification: [
        { type: "CNAME" as const, name: domain, value: "cname.vercel-dns.com.", purpose: "Point this name at your site." },
      ],
    };
  }
  async getDomainStatus(projectId: string, domain: string): Promise<DomainStatusResult> {
    if (this.failWith) throw this.failWith;
    return {
      domain,
      status: this.statusResult as DomainStatus,
      httpsReady: this.statusResult === "verified",
      verification: this.statusResult === "verified" ? [] : [
        { type: "CNAME" as const, name: domain, value: "cname.vercel-dns.com.", purpose: "Point this name at your site." },
      ],
    };
  }
  async listDomains() { return { domains: [] }; }
  async removeDomain(projectId: string, domain: string) {
    if (this.failWith) throw this.failWith;
    this.removed.push({ projectId, domain });
  }
}

/** Rebuild the service with the given verification status for the provider. */
function setupWithVerification(status: "pending" | "verified" | "failed") {
  const domains = new MemoryDomains();
  const deployments = new MemoryDeployments();
  const provider = new FakeDomainProvider();
  provider.statusResult = status;
  const service = new DomainService({
    storage: domains,
    deployments,
    provider,
    providerId: "vercel",
    now: () => NOW,
  });
  return { domains, deployments, provider, service };
}

function setup() {
  const domains = new MemoryDomains();
  const deployments = new MemoryDeployments();
  const provider = new FakeDomainProvider();
  const service = new DomainService({
    storage: domains,
    deployments,
    provider,
    providerId: "vercel",
    now: () => NOW,
  });
  return { domains, deployments, provider, service };
}

function activeDeployment(id = "dpl-1"): DeploymentRecord {
  return {
    id,
    projectId: "proj-1",
    providerId: "vercel",
    status: "live",
    createdAt: NOW,
    completedAt: NOW,
    activatedAt: NOW,
    projectRevision: 1,
    exportHash: "e",
    contentHash: "c",
    url: "https://x.vercel.app",
    deploymentUrl: "https://x.vercel.app",
  };
}

describe("DomainService — attach", () => {
  it("validates input and rejects unsafe domains", async () => {
    const { service } = setup();
    const bad = await service.attach("proj-1", "https://example.com/page");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("DOMAIN_INVALID");
  });

  it("attaches, persists, and returns DNS instructions", async () => {
    const { service, domains, provider } = setup();
    const result = await service.attach("proj-1", " example.com ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.domain).toBe("example.com");
      expect(result.value.status).toBe("pending");
      expect(result.value.primary).toBe(true);
      expect(result.value.verification?.[0].type).toBe("CNAME");
    }
    expect(provider.attached).toHaveLength(1);
    expect(domains.records.get("example.com")).toBeDefined();
  });

  it("rejects duplicate domains for the same project", async () => {
    const { service } = setup();
    await service.attach("proj-1", "example.com");
    const dup = await service.attach("proj-1", "example.com");
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("DOMAIN_ALREADY_IN_USE");
  });

  it("maps provider attach failure to a structured error", async () => {
    const { service, provider } = setup();
    provider.failWith = { code: "PROVIDER_RATE_LIMITED", message: "busy" };
    const result = await service.attach("proj-1", "example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_RATE_LIMITED");
  });
});

describe("DomainService — verification", () => {
  it("promotes to primary + reflects verified domain onto the active deployment", async () => {
    // Provider already considers the domain verified → attach returns verified.
    const { service, deployments } = setupWithVerification("verified");
    await deployments.createDeployment(activeDeployment());
    const attach = await service.attach("proj-1", "example.com");
    expect(attach.ok).toBe(true);
    if (attach.ok) {
      expect(attach.value.status).toBe("verified");
      expect(attach.value.primary).toBe(true);
    }
    const active = await deployments.getDeployment("dpl-1");
    expect(active!.domainIds).toContain("example.com");
    expect(active!.productionUrl).toBe("https://example.com");
  });

  it("re-checks pending → verified and reflects the change", async () => {
    // Start pending, then flip the provider to verified and refresh.
    const { service, deployments, provider } = setup();
    await deployments.createDeployment(activeDeployment());
    const attach = await service.attach("proj-1", "example.com");
    expect(attach.ok).toBe(true);

    provider.statusResult = "verified";
    const refreshed = await service.refreshStatus(
      (attach as { ok: true; value: DeploymentDomainRecord }).value,
    );
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      expect(refreshed.value.status).toBe("verified");
      expect(refreshed.value.primary).toBe(true);
    }
    const active = await deployments.getDeployment("dpl-1");
    expect(active!.domainIds).toContain("example.com");
    expect(active!.productionUrl).toBe("https://example.com");
  });

  it("keeps pending state non-blocking", async () => {
    const { service } = setup();
    const attach = await service.attach("proj-1", "example.com");
    const refreshed = await service.refreshStatus(
      (attach as { ok: true; value: DeploymentDomainRecord }).value,
    );
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) expect(refreshed.value.status).toBe("pending");
  });

  it("marks a provider-detached domain as failed", async () => {
    const { service, provider } = setup();
    const attach = await service.attach("proj-1", "example.com");
    provider.failWith = { code: "DOMAIN_NOT_FOUND", message: "gone" };
    const refreshed = await service.refreshStatus(
      (attach as { ok: true; value: DeploymentDomainRecord }).value,
    );
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) expect(refreshed.value.status).toBe("failed");
  });
});

describe("DomainService — remove & cleanup", () => {
  it("removes from the provider first, then locally", async () => {
    const { service, domains, provider } = setup();
    await service.attach("proj-1", "example.com");
    const record = domains.records.get("example.com")!;
    const result = await service.remove(record);
    expect(result.ok).toBe(true);
    expect(provider.removed).toHaveLength(1);
    expect(domains.records.get("example.com")).toBeUndefined();
  });

  it("still removes locally when the provider already dropped the domain", async () => {
    const { service, domains, provider } = setup();
    await service.attach("proj-1", "example.com");
    provider.failWith = { code: "DOMAIN_NOT_FOUND", message: "gone" };
    const result = await service.remove(domains.records.get("example.com")!);
    expect(result.ok).toBe(true);
    expect(domains.records.get("example.com")).toBeUndefined();
  });

  it("surfaces non-404 provider failures", async () => {
    const { service, domains, provider } = setup();
    await service.attach("proj-1", "example.com");
    provider.failWith = { code: "PROVIDER_AUTH_FAILED", message: "no" };
    const result = await service.remove(domains.records.get("example.com")!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_AUTH_FAILED");
  });

  it("clears all domain records for a project on deletion", async () => {
    const { service, domains } = setup();
    await service.attach("proj-1", "example.com");
    await service.attach("proj-1", "example.org");
    await service.removeDomainsForProject("proj-1");
    expect(domains.records.size).toBe(0);
  });
});


