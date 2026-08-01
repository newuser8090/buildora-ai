// ---------------------------------------------------------------------------
// Dashboard operation tests — pin metadata and service validation tests
//
// Adapter-level save/load tests exist in indexed-db-adapter.test.ts.
// This file covers dashboard-specific operations (pin, validation, service).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbProjectAdapter } from "@/features/persistence/adapters/indexed-db-adapter";
import { DashboardMetadataService } from "../services/dashboard-metadata-service";
import { ProjectService } from "../services/project-service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

function createAdapter(): IndexedDbProjectAdapter {
  dbCounter++;
  return new IndexedDbProjectAdapter({
    dbName: `test-dash-ops-${dbCounter}`,
    dbVersion: 1,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dashboard operations", () => {
  describe("pin metadata", () => {
    it("persists pin state", async () => {
      const adapter = createAdapter();
      const metaService = new DashboardMetadataService(adapter);
      await metaService.setPinned("proj-pin-1", true);
      const pinned = await metaService.isPinned("proj-pin-1");
      expect(pinned).toBe(true);
      adapter.close();
    });

    it("pin state survives through same adapter", async () => {
      const adapter = createAdapter();
      const metaService1 = new DashboardMetadataService(adapter);
      await metaService1.setPinned("proj-pin-2", true);

      const metaService2 = new DashboardMetadataService(adapter);
      const pinned = await metaService2.isPinned("proj-pin-2");
      expect(pinned).toBe(true);
      adapter.close();
    });

    it("unpins a pinned project", async () => {
      const adapter = createAdapter();
      const metaService = new DashboardMetadataService(adapter);
      await metaService.setPinned("proj-pin-3", true);
      await metaService.setPinned("proj-pin-3", false);

      const pinned = await metaService.isPinned("proj-pin-3");
      expect(pinned).toBe(false);
      adapter.close();
    });

    it("getPinMap returns only pinned projects", async () => {
      const adapter = createAdapter();
      const metaService = new DashboardMetadataService(adapter);
      await metaService.setPinned("proj-a", true);
      await metaService.setPinned("proj-b", false);
      await metaService.setPinned("proj-c", true);

      const pinMap = await metaService.getPinMap(["proj-a", "proj-b", "proj-c"]);
      expect(pinMap.get("proj-a")).toBe(true);
      expect(pinMap.has("proj-b")).toBe(false);
      expect(pinMap.get("proj-c")).toBe(true);
      adapter.close();
    });

    it("removes metadata on project delete", async () => {
      const adapter = createAdapter();
      const metaService = new DashboardMetadataService(adapter);
      await metaService.setPinned("proj-del-meta", true);
      await metaService.removeMetadata("proj-del-meta");

      const pinned = await metaService.isPinned("proj-del-meta");
      expect(pinned).toBe(false);
      adapter.close();
    });
  });

  describe("validation", () => {
    it("rejects empty name through shared validator", async () => {
      const adapter = createAdapter();
      const service = new ProjectService(adapter);
      const result = await service.renameProject("proj-x", "  ");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe("INVALID_PROJECT_NAME");
      }
      adapter.close();
    });

    it("rejects name over 80 characters", async () => {
      const adapter = createAdapter();
      const service = new ProjectService(adapter);
      const result = await service.renameProject("proj-x", "a".repeat(81));
      expect(result.success).toBe(false);
      adapter.close();
    });
  });
});
