// ---------------------------------------------------------------------------
// Publishing — domain storage adapter tests (Phase P8)
//
// Uses fake-indexeddb. Verifies CRUD, per-project isolation, durability and
// that the v7 schema bump creates the deploymentDomains store through the
// shared ensureDatabaseStores helper (first-connection safety).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbDomainAdapter } from "../domain-storage";
import { DATABASE_VERSION } from "@/features/persistence/constants";
import { ensureDatabaseStores } from "@/features/persistence/services/db-schema";
import type { DeploymentDomainRecord } from "../types";

let dbCounter = 0;

function adapter(): IndexedDbDomainAdapter {
  dbCounter += 1;
  return new IndexedDbDomainAdapter({ dbName: `domain-test-${dbCounter}` });
}

function record(id: string, projectId = "proj-1", status: DeploymentDomainRecord["status"] = "pending"): DeploymentDomainRecord {
  return {
    id,
    projectId,
    providerId: "vercel",
    domain: id,
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    verification: [
      { type: "CNAME", name: id, value: "cname.vercel-dns.com.", purpose: "Point this name at your site." },
    ],
  };
}

describe("Domain adapter — CRUD", () => {
  it("creates and reads a domain record", async () => {
    const a = adapter();
    await a.createDomain(record("example.com"));
    const loaded = await a.getDomain("example.com");
    expect(loaded).not.toBeNull();
    expect(loaded!.domain).toBe("example.com");
    expect(loaded!.verification?.[0].type).toBe("CNAME");
    a.close();
  });

  it("updates verification status by patching", async () => {
    const a = adapter();
    await a.createDomain(record("example.com"));
    const updated = await a.updateDomain("example.com", { status: "verified", primary: true });
    expect(updated!.status).toBe("verified");
    expect(updated!.primary).toBe(true);
    expect(updated!.id).toBe("example.com");
    a.close();
  });

  it("returns null when updating an unknown domain", async () => {
    const a = adapter();
    expect(await a.updateDomain("missing.com", { status: "verified" })).toBeNull();
    a.close();
  });

  it("lists domains for a project, newest updated first", async () => {
    const a = adapter();
    await a.createDomain({ ...record("b.com"), updatedAt: "2026-01-01T00:00:00.000Z" });
    await a.createDomain({ ...record("a.com"), updatedAt: "2026-01-02T00:00:00.000Z" });
    await a.createDomain(record("other.com", "other-project"));
    const list = await a.listDomains("proj-1");
    expect(list.map((d) => d.id)).toEqual(["a.com", "b.com"]);
    a.close();
  });

  it("removes a single domain", async () => {
    const a = adapter();
    await a.createDomain(record("example.com"));
    await a.createDomain(record("example.org"));
    await a.removeDomain("example.com");
    expect(await a.getDomain("example.com")).toBeNull();
    expect(await a.getDomain("example.org")).not.toBeNull();
    a.close();
  });

  it("removes all domains for a project on deletion", async () => {
    const a = adapter();
    await a.createDomain(record("example.com"));
    await a.createDomain(record("example.org"));
    await a.createDomain(record("other.com", "other-project"));
    await a.removeDomainsForProject("proj-1");
    expect(await a.listDomains("proj-1")).toEqual([]);
    expect((await a.listDomains("other-project")).length).toBe(1);
    a.close();
  });

  it("survives close/reopen (durable persistence)", async () => {
    dbCounter += 1;
    const dbName = `domain-test-${dbCounter}`;
    const a = new IndexedDbDomainAdapter({ dbName });
    await a.createDomain(record("example.com"));
    a.close();

    const b = new IndexedDbDomainAdapter({ dbName });
    const loaded = await b.getDomain("example.com");
    expect(loaded).not.toBeNull();
    expect(loaded!.status).toBe("pending");
    b.close();
  });
});

describe("Domain adapter — schema/version", () => {
  it("creates the deploymentDomains store when opening at the current version", async () => {
    dbCounter += 1;
    const dbName = `domain-test-${dbCounter}`;
    const a = new IndexedDbDomainAdapter({ dbName });
    await a.createDomain(record("example.com"));
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open(dbName, DATABASE_VERSION);
      req.onsuccess = () => resolve(req.result);
    });
    expect(db.objectStoreNames.contains("deploymentDomains")).toBe(true);
    // Previous stores remain readable (backward compatibility).
    expect(db.objectStoreNames.contains("deployments")).toBe(true);
    expect(db.objectStoreNames.contains("projects")).toBe(true);
    db.close();
    a.close();
  });

  it("shared schema helper creates every store including deploymentDomains", () => {
    const request = indexedDB.open("domain-schema-check", 1);
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
          "deploymentDomains",
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
