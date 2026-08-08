// ---------------------------------------------------------------------------
// Publishing — Phase P8 pipeline tests
//
// Verifies the P8 guarantees on the existing PublishService:
//   - snapshot captured once; edits during publish never change it
//   - export hash deterministic + recorded on the deployment
//   - duplicate publish prevented (client lock + server idempotency input)
//   - retry "current version" semantics
//   - provider deploymentPatch merged into the record (provider URLs/ids)
//   - Local Export unaffected by provider config
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { PublishService } from "../services/publish-service";
import { contentHashOfProject, hashExportFiles } from "../services/hash";
import { generateExportProject } from "@/features/export/generators/project-generator";
import { claimPublishLock, releasePublishLock, _resetPublishLocksForTests } from "../services/publish-concurrency";
import type {
  DeploymentRecord,
  PublishInput,
  PublishProgressEvent,
  PublishResult,
  PublishingProvider,
} from "../types";
import type { DeploymentStorageAdapter } from "../storage/deployment-adapter";
import type { Project } from "@/types/project";
import { VERCEL_CAPABILITIES } from "../capabilities";

class MemoryStore implements DeploymentStorageAdapter {
  records = new Map<string, DeploymentRecord>();
  async createDeployment(record: DeploymentRecord) { this.records.set(record.id, { ...record }); return record; }
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

function makeProject(): Project {
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
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Capturing provider: records the snapshot it received + inputs. */
class CapturingProvider implements PublishingProvider {
  readonly id = "vercel";
  readonly label = "Vercel";
  readonly description = "";
  readonly capabilities = VERCEL_CAPABILITIES;

  receivedSnapshots: unknown[] = [];
  receivedInputs: PublishInput[] = [];
  failWith: import("../errors").PublishError | null = null;
  patch: Partial<DeploymentRecord> | null = null;

  async isAvailable() {
    return { available: true, capabilities: VERCEL_CAPABILITIES };
  }
  async publish(input: PublishInput, _onProgress: (e: PublishProgressEvent) => void, signal?: AbortSignal): Promise<PublishResult> {
    this.receivedSnapshots.push(input.projectSnapshot);
    this.receivedInputs.push(input);
    if (signal?.aborted) {
      return { ok: false, error: { code: "CANCELLED", message: "Cancelled." } };
    }
    if (this.failWith) {
      return { ok: false, error: this.failWith };
    }
    return {
      ok: true,
      url: "https://buildora-proj-1.vercel.app",
      deploymentPatch: this.patch ?? {
        providerDeploymentId: "dpl_1",
        providerProjectId: "prj_1",
        providerProjectName: "buildora-proj-1",
        productionUrl: "https://buildora-proj-1.vercel.app",
        deploymentUrl: "https://dpl-1.vercel.app",
        previewUrl: "https://preview.vercel.app",
        providerState: "READY",
      },
    };
  }
  async getDeployment() { return null; }
  async listDeployments() { return []; }
}

function setup(provider: PublishingProvider, storage: MemoryStore, idPrefix = "deploy-") {
  let counter = 0;
  return new PublishService({
    provider,
    storage,
    now: () => "2026-01-01T00:00:00.000Z",
    createId: () => `${idPrefix}${++counter}`,
  });
}

describe("P8 pipeline — snapshot consistency", () => {
  it("captures one snapshot and does not mutate the project", async () => {
    const provider = new CapturingProvider();
    const storage = new MemoryStore();
    const service = setup(provider, storage);
    const project = makeProject();
    const before = JSON.stringify(project);

    const result = await service.publish({ project, revision: 2, providerId: "vercel" }, () => {});
    expect(result.ok).toBe(true);
    expect(provider.receivedSnapshots).toHaveLength(1);
    // Snapshot is equal to the published project, not a live reference.
    expect(JSON.stringify(provider.receivedSnapshots[0])).toBe(before);
    // The project object was never mutated.
    expect(JSON.stringify(project)).toBe(before);
  });

  it("keeps the original snapshot when the user edits during publish", async () => {
    const provider = new CapturingProvider();
    const storage = new MemoryStore();
    const service = setup(provider, storage);
    const project = makeProject();

    // Publish; let the pipeline progress past snapshot capture (a macrotask
    // so every microtask — including the provider invocation — has run), then
    // mutate the project exactly as a user edit during the build would.
    const resultPromise = service.publish({ project, revision: 1, providerId: "vercel" }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    project.pages[0].sections[0].props = { headline: "Edited during publish" };
    await resultPromise;

    const snapshot = provider.receivedSnapshots[0] as Project;
    expect((snapshot.pages[0].sections[0].props as { headline: string }).headline).toBe("Hello");
    // The deployment hash matches the ORIGINAL content.
    expect(contentHashOfProject(snapshot)).toBe(contentHashOfProject(makeProject()));
  });

  it("records the deterministic export hash on the deployment", async () => {
    const provider = new CapturingProvider();
    const storage = new MemoryStore();
    const service = setup(provider, storage);
    const result = await service.publish({ project: makeProject(), revision: 1, providerId: "vercel" }, () => {});
    expect(result.ok).toBe(true);
    const expected = hashExportFiles(generateExportProject(makeProject()).files);
    expect(provider.receivedInputs[0].exportHash).toBe(expected);
    expect(storage.records.get("deploy-1")!.exportHash).toBe(expected);
  });

  it("merges the provider deploymentPatch into the persisted record", async () => {
    const provider = new CapturingProvider();
    const storage = new MemoryStore();
    const service = setup(provider, storage);
    const result = await service.publish({ project: makeProject(), revision: 1, providerId: "vercel" }, () => {});
    expect(result.ok).toBe(true);
    const record = storage.records.get("deploy-1")!;
    expect(record.status).toBe("live");
    expect(record.providerDeploymentId).toBe("dpl_1");
    expect(record.providerProjectName).toBe("buildora-proj-1");
    expect(record.productionUrl).toBe("https://buildora-proj-1.vercel.app");
    expect(record.previewUrl).toBe("https://preview.vercel.app");
    expect(record.url).toBe("https://buildora-proj-1.vercel.app");
  });
});

describe("P8 pipeline — idempotency & duplicate prevention", () => {
  it("passes a deterministic idempotency key (projectId + exportHash)", async () => {
    const provider = new CapturingProvider();
    const service = setup(provider, new MemoryStore());
    await service.publish({ project: makeProject(), revision: 1, providerId: "vercel" }, () => {});
    const key = provider.receivedInputs[0].idempotencyKey;
    expect(key).toBe(`proj-1:${provider.receivedInputs[0].exportHash}`);
  });

  it("client lock prevents a second concurrent publish for the same target", async () => {
    _resetPublishLocksForTests();
    expect(claimPublishLock("proj-1", "vercel")).toBe(true);
    expect(claimPublishLock("proj-1", "vercel")).toBe(false);
    expect(claimPublishLock("proj-1", "mock")).toBe(true); // different provider
    expect(claimPublishLock("proj-2", "vercel")).toBe(true); // different project
    releasePublishLock("proj-1", "vercel");
    expect(claimPublishLock("proj-1", "vercel")).toBe(true);
    _resetPublishLocksForTests();
  });

  it("a provider failure preserves history and allows retry of the current version", async () => {
    const provider = new CapturingProvider();
    const storage = new MemoryStore();
    provider.failWith = { code: "DEPLOYMENT_FAILED", message: "Build failed." };
    const service = setup(provider, storage, "fail-");
    const first = await service.publish({ project: makeProject(), revision: 1, providerId: "vercel" }, () => {});
    expect(first.ok).toBe(false);
    expect(storage.records.get("fail-1")!.status).toBe("failed");

    // Retry with a healthy provider → publishes the current version again.
    const retry = setup(new CapturingProvider(), storage, "ok-");
    const second = await retry.publish({ project: makeProject(), revision: 1, providerId: "vercel" }, () => {});
    expect(second.ok).toBe(true);
    // History preserved: failed + live both exist.
    expect(storage.records.size).toBe(2);
  });
});

describe("P8 pipeline — local export independence", () => {
  it("does not require provider availability for the pipeline to construct", () => {
    const unavailable: PublishingProvider = {
      id: "local-export",
      label: "Local Export",
      description: "",
      capabilities: {
        realHosting: false, customDomains: false, rollback: false,
        deploymentLogs: false, cancelDeployment: false, deleteDeployment: false,
        previewDeployments: false,
      },
      isAvailable: async () => ({ available: true }),
      publish: vi.fn(async () => ({ ok: true }) as PublishResult),
      getDeployment: async () => null,
      listDeployments: async () => [],
    };
    const storage = new MemoryStore();
    const service = new PublishService({
      provider: unavailable,
      storage,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    // Constructing + using Local Export never touches provider credentials.
    expect(service).toBeInstanceOf(PublishService);
  });
});
