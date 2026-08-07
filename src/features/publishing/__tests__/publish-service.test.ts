// ---------------------------------------------------------------------------
// Publishing — PublishService pipeline tests (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { PublishService } from "../services/publish-service";
import { MockPublishingProvider } from "../providers/mock-provider";
import type { DeploymentRecord, PublishProgressEvent, PublishingProvider } from "../types";
import type { DeploymentStorageAdapter } from "../storage/deployment-adapter";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// In-memory deployment storage (mirrors the adapter contract)
// ---------------------------------------------------------------------------

class MemoryStore implements DeploymentStorageAdapter {
  records = new Map<string, DeploymentRecord>();

  async createDeployment(record: DeploymentRecord): Promise<DeploymentRecord> {
    this.records.set(record.id, { ...record });
    return record;
  }

  async updateDeployment(
    deploymentId: string,
    patch: Partial<DeploymentRecord>,
  ): Promise<DeploymentRecord | null> {
    const existing = this.records.get(deploymentId);
    if (!existing) return null;
    const next = { ...existing, ...patch, id: existing.id };
    this.records.set(deploymentId, next);
    return next;
  }

  async getDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    return this.records.get(deploymentId) ?? null;
  }

  async listDeployments(projectId: string): Promise<DeploymentRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async removeDeployment(deploymentId: string): Promise<void> {
    this.records.delete(deploymentId);
  }

  async removeDeploymentsForProject(projectId: string): Promise<void> {
    for (const [id, r] of this.records) {
      if (r.projectId === projectId) this.records.delete(id);
    }
  }

  close(): void {}
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test Site",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#000",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          {
            id: "s1", type: "hero", order: 1, visible: true,
            props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fastProvider(): PublishingProvider {
  return new MockPublishingProvider({
    durations: { checking: 0, preparing: 0, building: 0, publishing: 0, live: 0 },
  });
}

function setup(provider: PublishingProvider, storage: MemoryStore) {
  return new PublishService({
    provider,
    storage,
    now: () => "2026-01-01T00:00:00.000Z",
    createId: () => "deploy-1",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PublishService — validation gates", () => {
  it("returns PROVIDER_UNAVAILABLE when the provider is unavailable", async () => {
    const unavailable: PublishingProvider = {
      id: "off", label: "Off", description: "",
      isAvailable: async () => ({ available: false, reason: "Not configured." }),
      publish: async () => ({ ok: false, error: { code: "DEPLOY_FAILED", message: "x" } }),
      getDeployment: async () => null,
      listDeployments: async () => [],
    };
    const service = setup(unavailable, new MemoryStore());
    const result = await service.publish(
      { project: makeProject(), revision: 1, providerId: "off" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("returns PROJECT_INVALID for a structurally broken project", async () => {
    const service = setup(fastProvider(), new MemoryStore());
    const result = await service.publish(
      { project: { id: "x" } as unknown as Project, revision: 1, providerId: "mock" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROJECT_INVALID");
  });

  it("returns EXPORT_INVALID when export validation fails", async () => {
    // Passes ProjectSchema but fails export validation (missing referenced asset).
    const broken = makeProject({
      assets: [],
      pages: [
        {
          id: "p1", title: "Home", slug: "/",
          sections: [
            { id: "s1", type: "header", order: 1, visible: true, props: { logoText: "X", logoImage: { assetId: "missing" }, navLinks: [] }, styles: {} },
            { id: "s2", type: "hero", order: 2, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
          ],
        },
      ],
    });
    const service = setup(fastProvider(), new MemoryStore());
    const result = await service.publish(
      { project: broken, revision: 1, providerId: "mock" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EXPORT_INVALID");
    // No deployment record is created when validation fails.
    const storage = new MemoryStore();
    await setup(fastProvider(), storage).publish(
      { project: broken, revision: 1, providerId: "mock" },
      () => {},
    );
    expect(storage.records.size).toBe(0);
  });
});

describe("PublishService — success path", () => {
  it("publishes, persists a live deployment, and reports progress", async () => {
    const storage = new MemoryStore();
    const service = setup(fastProvider(), storage);
    const project = makeProject();
    const before = JSON.stringify(project);
    const events: PublishProgressEvent[] = [];

    const result = await service.publish(
      { project, revision: 3, providerId: "mock" },
      (e) => events.push(e),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deployment.id).toBe("deploy-1");
      expect(result.deployment.status).toBe("live");
      expect(result.deployment.providerId).toBe("mock");
      expect(result.deployment.projectRevision).toBe(3);
      expect(result.deployment.exportHash).toMatch(/^[0-9a-f]{16}$/);
      expect(result.deployment.url).toContain("/preview/proj-1");
    }
    expect(events.length).toBeGreaterThan(0);
    expect(storage.records.get("deploy-1")!.status).toBe("live");
    // Publishing never mutates the project.
    expect(JSON.stringify(project)).toBe(before);
  });

  it("creates one deployment record per request with unique ids", async () => {
    const storage = new MemoryStore();
    let counter = 0;
    const service = new PublishService({
      provider: fastProvider(),
      storage,
      now: () => "2026-01-01T00:00:00.000Z",
      createId: () => `deploy-${++counter}`,
    });
    const project = makeProject();
    await service.publish({ project, revision: 1, providerId: "mock" }, () => {});
    await service.publish({ project, revision: 1, providerId: "mock" }, () => {});
    expect(storage.records.size).toBe(2);
    expect(new Set(storage.records.keys())).toEqual(new Set(["deploy-1", "deploy-2"]));
    for (const record of storage.records.values()) {
      expect(record.status).toBe("live");
    }
  });
});

describe("PublishService — failure & cancel", () => {
  it("persists a failed deployment when the provider fails", async () => {
    const storage = new MemoryStore();
    const failing = new MockPublishingProvider({
      durations: { checking: 0, preparing: 0, building: 0, publishing: 0, live: 0 },
      failAt: "building",
      failCode: "BUILD_FAILED",
    });
    const service = setup(failing, storage);
    const result = await service.publish(
      { project: makeProject(), revision: 1, providerId: "mock" },
      () => {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BUILD_FAILED");
    const record = storage.records.get("deploy-1");
    expect(record!.status).toBe("failed");
    expect(record!.errorCode).toBe("BUILD_FAILED");
    expect(record!.completedAt).toBeDefined();
  });

  it("persists a cancelled deployment when aborted", async () => {
    const storage = new MemoryStore();
    const provider = new MockPublishingProvider({
      durations: { checking: 0, preparing: 0, building: 50, publishing: 0, live: 0 },
    });
    const service = setup(provider, storage);
    const controller = new AbortController();
    const promise = service.publish(
      { project: makeProject(), revision: 1, providerId: "mock" },
      () => {},
      controller.signal,
    );
    setTimeout(() => controller.abort(), 5);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("CANCELLED");
    expect(storage.records.get("deploy-1")!.status).toBe("cancelled");
  });

  it("provides a retryable failure without side effects on the project", async () => {
    const storage = new MemoryStore();
    const flaky = new MockPublishingProvider({
      durations: { checking: 0, preparing: 0, building: 0, publishing: 0, live: 0 },
      failAt: "publishing",
      failCode: "UPLOAD_FAILED",
    });
    const service = setup(flaky, storage);
    const project = makeProject();
    const first = await service.publish({ project, revision: 1, providerId: "mock" }, () => {});
    expect(first.ok).toBe(false);

    // Retry with a healthy provider succeeds.
    let counter = 1;
    const retry = new PublishService({
      provider: fastProvider(),
      storage,
      now: () => "2026-01-01T00:00:00.000Z",
      createId: () => `deploy-${++counter}`,
    });
    const second = await retry.publish({ project, revision: 1, providerId: "mock" }, () => {});
    expect(second.ok).toBe(true);
    expect(storage.records.size).toBe(2);
  });
});
