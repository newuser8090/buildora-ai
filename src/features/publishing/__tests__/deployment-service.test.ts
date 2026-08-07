// ---------------------------------------------------------------------------
// Publishing — DeploymentService tests (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { DeploymentService } from "../services/deployment-service";
import { contentHashOfProject } from "../services/hash";
import type { DeploymentRecord } from "../types";
import type { DeploymentStorageAdapter } from "../storage/deployment-adapter";
import type { Project } from "@/types/project";

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

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test",
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
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello" }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function live(id: string, activatedAt: string, contentHash: string, revision = 2): DeploymentRecord {
  return {
    id, projectId: "proj-1", providerId: "mock", status: "live",
    createdAt: activatedAt, completedAt: activatedAt, activatedAt,
    projectRevision: revision, exportHash: `export-${id}`, contentHash,
  };
}

function service(store = new MemoryStore()) {
  return new DeploymentService(store, () => "2026-02-01T00:00:00.000Z");
}

describe("DeploymentService — history & active deployment", () => {
  it("lists deployments from storage", async () => {
    const store = new MemoryStore();
    await store.createDeployment(live("d1", "2026-01-01T00:00:00.000Z", "c1"));
    await store.createDeployment(live("d2", "2026-01-02T00:00:00.000Z", "c2"));
    const list = await service(store).listDeployments("proj-1");
    expect(list.map((d) => d.id)).toEqual(["d2", "d1"]);
  });

  it("returns the live deployment with the newest activatedAt as active", async () => {
    const store = new MemoryStore();
    await store.createDeployment(live("d1", "2026-01-01T00:00:00.000Z", "c1"));
    await store.createDeployment(live("d2", "2026-01-02T00:00:00.000Z", "c2"));
    const active = await service(store).getActiveDeployment("proj-1");
    expect(active!.id).toBe("d2");
  });

  it("ignores failed/cancelled deployments when picking the active one", async () => {
    const store = new MemoryStore();
    await store.createDeployment({ ...live("d1", "2026-01-02T00:00:00.000Z", "c1"), status: "failed" });
    await store.createDeployment(live("d2", "2026-01-01T00:00:00.000Z", "c2"));
    const active = await service(store).getActiveDeployment("proj-1");
    expect(active!.id).toBe("d2");
  });

  it("returns null when nothing is live", async () => {
    expect(await service().getActiveDeployment("proj-1")).toBeNull();
  });
});

describe("DeploymentService — publish status (unpublished changes)", () => {
  it("reports never-published when there is no live deployment", async () => {
    const project = makeProject();
    expect(await service().getPublishStatus(project, 1)).toBe("never-published");
  });

  it("reports published when content and revision match", async () => {
    const store = new MemoryStore();
    const project = makeProject();
    await store.createDeployment(
      live("d1", "2026-01-01T00:00:00.000Z", contentHashOfProject(project), 4),
    );
    expect(await service(store).getPublishStatus(project, 4)).toBe("published");
    expect(await service(store).hasUnpublishedChanges(project, 4)).toBe(false);
  });

  it("reports changes-unpublished when content changed", async () => {
    const store = new MemoryStore();
    const project = makeProject();
    await store.createDeployment(
      live("d1", "2026-01-01T00:00:00.000Z", contentHashOfProject(project), 4),
    );
    project.pages[0].sections[0].props.headline = "Edited";
    expect(await service(store).getPublishStatus(project, 4)).toBe("changes-unpublished");
    expect(await service(store).hasUnpublishedChanges(project, 4)).toBe(true);
  });

  it("reports changes-unpublished when the editor revision advanced", async () => {
    const store = new MemoryStore();
    const project = makeProject();
    await store.createDeployment(
      live("d1", "2026-01-01T00:00:00.000Z", contentHashOfProject(project), 4),
    );
    expect(await service(store).getPublishStatus(project, 5)).toBe("changes-unpublished");
  });
});

describe("DeploymentService — rollback", () => {
  it("rolls back a deployment via the provider without touching project content", async () => {
    const store = new MemoryStore();
    const target = live("d-old", "2026-01-01T00:00:00.000Z", "c1");
    await store.createDeployment(target);
    const project = makeProject();

    const result = await service(store).rollback("proj-1", "d-old", async (id) => ({
      ...target,
      id,
      activatedAt: "2026-02-01T00:00:00.000Z",
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deployment.id).toBe("d-old");
      expect(result.deployment.activatedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(result.deployment.status).toBe("live");
    }
    // The deployment record is refreshed, but the project itself is untouched
    // (rollback is about which deployment is active, never project content).
    expect(project.pages[0].sections[0].props.headline).toBe("Hello");
  });

  it("returns ROLLBACK_UNSUPPORTED when the provider has no rollback", async () => {
    const store = new MemoryStore();
    await store.createDeployment(live("d1", "2026-01-01T00:00:00.000Z", "c1"));
    const result = await service(store).rollback("proj-1", "d1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ROLLBACK_UNSUPPORTED");
  });

  it("returns DEPLOYMENT_NOT_FOUND for an unknown deployment", async () => {
    const result = await service().rollback("proj-1", "missing", async () => {
      throw new Error("unreachable");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DEPLOYMENT_NOT_FOUND");
  });

  it("surfaces provider rollback errors", async () => {
    const store = new MemoryStore();
    await store.createDeployment(live("d1", "2026-01-01T00:00:00.000Z", "c1"));
    const result = await service(store).rollback("proj-1", "d1", async () => {
      throw { code: "DEPLOY_FAILED", message: "Provider error" };
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DEPLOY_FAILED");
  });
});

describe("DeploymentService — delete & cleanup", () => {
  it("deletes a deployment and invokes the provider hook", async () => {
    const store = new MemoryStore();
    await store.createDeployment(live("d1", "2026-01-01T00:00:00.000Z", "c1"));
    let providerCalled = false;
    const result = await service(store).deleteDeployment("d1", async () => {
      providerCalled = true;
    });
    expect(result.ok).toBe(true);
    expect(providerCalled).toBe(true);
    expect(store.records.has("d1")).toBe(false);
  });

  it("removes all deployments for a project", async () => {
    const store = new MemoryStore();
    await store.createDeployment(live("d1", "2026-01-01T00:00:00.000Z", "c1"));
    await store.createDeployment(live("d2", "2026-01-02T00:00:00.000Z", "c2"));
    await store.createDeployment({ ...live("d3", "2026-01-01T00:00:00.000Z", "c3"), projectId: "other" });
    await service(store).removeDeploymentsForProject("proj-1");
    expect(store.records.size).toBe(1);
    expect(store.records.has("d3")).toBe(true);
  });
});
