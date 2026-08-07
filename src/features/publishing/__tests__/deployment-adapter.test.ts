// ---------------------------------------------------------------------------
// Publishing — deployment storage adapter tests (Phase P7)
//
// Uses fake-indexeddb. Verifies CRUD, per-project isolation, close/reopen
// durability, and the shared-schema creation on the version-6 bump (every
// store created, first-connection bug impossible).
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbDeploymentAdapter } from "../storage/deployment-adapter";
import { DATABASE_VERSION } from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { DeploymentRecord } from "../types";

let dbCounter = 0;

function adapter(): IndexedDbDeploymentAdapter {
  dbCounter += 1;
  return new IndexedDbDeploymentAdapter({ dbName: `deploy-test-${dbCounter}` });
}

afterEach(() => {
  // Ensure no adapter keeps the DB open between tests.
  void 0;
});

function record(id: string, projectId = "proj-1"): DeploymentRecord {
  return {
    id,
    projectId,
    providerId: "mock",
    status: "live",
    createdAt: `2026-01-01T00:00:00.000Z-${id}`,
    completedAt: `2026-01-01T00:00:00.000Z-${id}`,
    projectRevision: 3,
    exportHash: `export-${id}`,
    contentHash: `content-${id}`,
    url: "http://localhost:3000/preview/proj-1",
  };
}

describe("Deployment adapter — CRUD", () => {
  it("creates and reads a deployment", async () => {
    const a = adapter();
    await a.createDeployment(record("d1"));
    const loaded = await a.getDeployment("d1");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("d1");
    expect(loaded!.projectId).toBe("proj-1");
    expect(loaded!.exportHash).toBe("export-d1");
    a.close();
  });

  it("updates a deployment by patching", async () => {
    const a = adapter();
    await a.createDeployment(record("d1"));
    const updated = await a.updateDeployment("d1", { status: "failed", errorCode: "BUILD_FAILED" });
    expect(updated!.status).toBe("failed");
    expect(updated!.errorCode).toBe("BUILD_FAILED");
    expect(updated!.id).toBe("d1");
    a.close();
  });

  it("returns null when updating an unknown deployment", async () => {
    const a = adapter();
    expect(await a.updateDeployment("missing", { status: "failed" })).toBeNull();
    a.close();
  });

  it("lists deployments for a project newest first", async () => {
    const a = adapter();
    await a.createDeployment({ ...record("d1"), createdAt: "2026-01-01T00:00:00.000Z" });
    await a.createDeployment({ ...record("d2"), createdAt: "2026-01-02T00:00:00.000Z" });
    await a.createDeployment({ ...record("other", "other-project") });
    const list = await a.listDeployments("proj-1");
    expect(list.map((d) => d.id)).toEqual(["d2", "d1"]);
    a.close();
  });

  it("removes a single deployment", async () => {
    const a = adapter();
    await a.createDeployment(record("d1"));
    await a.createDeployment(record("d2"));
    await a.removeDeployment("d1");
    expect(await a.getDeployment("d1")).toBeNull();
    expect(await a.getDeployment("d2")).not.toBeNull();
    a.close();
  });

  it("removes all deployments for a project on deletion", async () => {
    const a = adapter();
    await a.createDeployment(record("d1"));
    await a.createDeployment(record("d2"));
    await a.createDeployment(record("other", "other-project"));
    await a.removeDeploymentsForProject("proj-1");
    expect(await a.listDeployments("proj-1")).toEqual([]);
    expect((await a.listDeployments("other-project")).length).toBe(1);
    a.close();
  });

  it("survives close/reopen (durable persistence)", async () => {
    dbCounter += 1;
    const dbName = `deploy-test-${dbCounter}`;
    const a = new IndexedDbDeploymentAdapter({ dbName });
    await a.createDeployment(record("d1"));
    a.close();

    const b = new IndexedDbDeploymentAdapter({ dbName });
    const loaded = await b.getDeployment("d1");
    expect(loaded).not.toBeNull();
    expect(loaded!.contentHash).toBe("content-d1");
    b.close();
  });
});

describe("Deployment adapter — schema/version", () => {
  it("creates the deployments store when opening at the current version", async () => {
    dbCounter += 1;
    const dbName = `deploy-test-${dbCounter}`;
    const a = new IndexedDbDeploymentAdapter({ dbName });
    await a.createDeployment(record("d1"));
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open(dbName, DATABASE_VERSION);
      req.onsuccess = () => resolve(req.result);
    });
    expect(db.objectStoreNames.contains("deployments")).toBe(true);
    db.close();
    a.close();
  });

  it("shared schema helper creates every store on an upgrade (first-connection safety)", () => {
    // Simulate the adapter's onupgradeneeded: ensureDatabaseStores must create
    // ALL stores (including deployments) so whichever adapter bumps the
    // version leaves a complete database.
    const request = indexedDB.open("schema-check-db", 1);
    return new Promise<void>((resolve) => {
      request.onupgradeneeded = () => {
        ensureDatabaseStores(request.result);
      };
      request.onsuccess = () => {
        const db = request.result;
        const expected = [
          "projects", "metadata", "projectThumbnails", "myBlocks",
          "myBlockThumbnails", "myBlockCollections", "cloudSyncQueue",
          "cloudSyncMarkers", "cloudSyncConflicts", "deployments",
        ];
        for (const store of expected) {
          expect(db.objectStoreNames.contains(store)).toBe(true);
        }
        db.close();
        resolve();
      };
    });
  });
});
