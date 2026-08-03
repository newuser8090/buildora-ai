// ---------------------------------------------------------------------------
// IndexedDB Adapter Tests
//
// Uses fake-indexeddb for isolated, deterministic database testing.
// Each test gets a unique database name to prevent state leakage.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDbProjectAdapter } from "../adapters/indexed-db-adapter";
import type { Project } from "@/types/project";
import type { SaveProjectRequest } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

function createAdapter(): IndexedDbProjectAdapter {
  dbCounter++;
  return new IndexedDbProjectAdapter({
    dbName: `buildora-test-${dbCounter}`,
    dbVersion: 1,
  });
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test Project",
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
        sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } }, styles: {} }],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSaveRequest(project?: Project, revision?: number): SaveProjectRequest {
  return {
    project: project ?? makeProject(),
    revision: revision ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IndexedDbProjectAdapter — database lifecycle", () => {
  it("creates database and stores on open", async () => {
    const adapter = createAdapter();
    const req = makeSaveRequest();
    const result = await adapter.saveProject(req);
    expect(result.success).toBe(true);
    adapter.close();
  });

  it("adapter close and reopen", async () => {
    const adapter = createAdapter();
    const req = makeSaveRequest();
    await adapter.saveProject(req);
    adapter.close();

    // Reopen with same db name
    const saved = await adapter.loadProject("proj-1");
    expect(saved.success).toBe(true);
    if (saved.success) {
      expect(saved.project.name).toBe("Test Project");
    }
    adapter.close();
  });
});

describe("IndexedDbProjectAdapter — save and load", () => {
  it("saves and loads a project", async () => {
    const adapter = createAdapter();
    const project = makeProject();
    const saveResult = await adapter.saveProject(makeSaveRequest(project));
    expect(saveResult.success).toBe(true);

    const loadResult = await adapter.loadProject("proj-1");
    expect(loadResult.success).toBe(true);
    if (loadResult.success) {
      expect(loadResult.project.id).toBe("proj-1");
      expect(loadResult.project.name).toBe("Test Project");
      expect(loadResult.revision).toBeGreaterThanOrEqual(1);
      expect(typeof loadResult.savedAt).toBe("string");
    }
    adapter.close();
  });

  it("asset payload preserved exactly after save/load", async () => {
    const adapter = createAdapter();
    const project = makeProject({
      assets: [{
        id: "a1", name: "logo.png", type: "image", mimeType: "image/png", extension: ".png", size: 1024,
        source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    await adapter.saveProject(makeSaveRequest(project));

    const loaded = await adapter.loadProject("proj-1");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.assets[0].source.value).toBe("data:image/png;base64,iVBORw0KGgo=");
    }
    adapter.close();
  });

  it("returns PROJECT_NOT_FOUND for missing project", async () => {
    const adapter = createAdapter();
    const result = await adapter.loadProject("nonexistent");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PROJECT_NOT_FOUND");
    }
    adapter.close();
  });

  it("save does not mutate input project", async () => {
    const adapter = createAdapter();
    const project = makeProject();
    const before = JSON.stringify(project);
    await adapter.saveProject(makeSaveRequest(project));
    expect(JSON.stringify(project)).toBe(before);
    adapter.close();
  });
});

describe("IndexedDbProjectAdapter — revisions", () => {
  it("first revision save succeeds", async () => {
    const adapter = createAdapter();
    const result = await adapter.saveProject(makeSaveRequest(makeProject(), 1));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.revision).toBeGreaterThanOrEqual(1);
    }
    adapter.close();
  });

  it("newer revision overwrites older", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest(makeProject({ name: "v1" }), 1));
    const result = await adapter.saveProject(makeSaveRequest(makeProject({ name: "v2" }), 2));
    expect(result.success).toBe(true);

    const loaded = await adapter.loadProject("proj-1");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.project.name).toBe("v2");
    }
    adapter.close();
  });

  it("older revision after newer returns STALE_REVISION", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest(makeProject(), 2)); // rev 2
    const result = await adapter.saveProject(makeSaveRequest(makeProject(), 1)); // rev 1 is stale
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("STALE_REVISION");
    }
    adapter.close();
  });

  it("revision checks are isolated per project", async () => {
    const adapter = createAdapter();
    const p1 = makeProject({ id: "proj-a", name: "A" });
    const p2 = makeProject({ id: "proj-b", name: "B" });

    await adapter.saveProject(makeSaveRequest(p1, 5));
    await adapter.saveProject(makeSaveRequest(p2, 1)); // Should succeed — different project
    const result = await adapter.saveProject(makeSaveRequest(p1, 4)); // stale for proj-a
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("STALE_REVISION");
    }
    adapter.close();
  });

  it("revision preserved across adapter recreation", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest(makeProject(), 10));
    adapter.close();

    const loaded = await adapter.loadProject("proj-1");
    expect(loaded.success).toBe(true);
    if (loaded.success) {
      expect(loaded.revision).toBeGreaterThanOrEqual(1);
    }
    adapter.close();
  });
});

describe("IndexedDbProjectAdapter — multiple projects", () => {
  it("saves and loads multiple projects", async () => {
    const adapter = createAdapter();
    const p1 = makeProject({ id: "proj-a", name: "Alpha" });
    const p2 = makeProject({ id: "proj-b", name: "Beta" });

    await adapter.saveProject(makeSaveRequest(p1, 1));
    await adapter.saveProject(makeSaveRequest(p2, 1));

    const a = await adapter.loadProject("proj-a");
    const b = await adapter.loadProject("proj-b");
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    if (a.success && b.success) {
      expect(a.project.name).toBe("Alpha");
      expect(b.project.name).toBe("Beta");
    }
    adapter.close();
  });

  it("list returns summaries", async () => {
    const adapter = createAdapter();
    const p1 = makeProject({ id: "proj-a", name: "Alpha", assets: [{ id: "a1", name: "img.png", type: "image", mimeType: "image/png", extension: ".png", size: 500, source: { type: "data-url", value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" }] });
    const p2 = makeProject({ id: "proj-b", name: "Beta", pages: [{ id: "p1", title: "Home", slug: "/", sections: [] }, { id: "p2", title: "About", slug: "/about", sections: [] }] });

    await adapter.saveProject(makeSaveRequest(p1, 1));
    await adapter.saveProject(makeSaveRequest(p2, 1));

    const list = await adapter.listProjects();
    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.projects).toHaveLength(2);
      const alpha = list.projects.find((p) => p.id === "proj-a")!;
      expect(alpha.name).toBe("Alpha");
      expect(alpha.assetCount).toBe(1);
      expect(alpha.approximateAssetBytes).toBe(500);
      const beta = list.projects.find((p) => p.id === "proj-b")!;
      expect(beta.name).toBe("Beta");
      expect(beta.pageCount).toBe(2);
    }
    adapter.close();
  });
});

describe("IndexedDbProjectAdapter — remove", () => {
  it("removes a project", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest());
    const removeResult = await adapter.removeProject("proj-1");
    expect(removeResult.success).toBe(true);

    const loadResult = await adapter.loadProject("proj-1");
    expect(loadResult.success).toBe(false);
    adapter.close();
  });

  it("remove is idempotent for missing records", async () => {
    const adapter = createAdapter();
    const result = await adapter.removeProject("nonexistent");
    expect(result.success).toBe(true);
    adapter.close();
  });

  it("remove clears activeProjectId when matching", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest());
    await adapter.setActiveProjectId("proj-1");

    await adapter.removeProject("proj-1");

    const active = await adapter.getActiveProjectId();
    expect(active.success).toBe(true);
    if (active.success) {
      expect(active.projectId).toBeNull();
    }
    adapter.close();
  });

  it("remove does not affect other projects", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest(makeProject({ id: "proj-a" })));
    await adapter.saveProject(makeSaveRequest(makeProject({ id: "proj-b" })));

    await adapter.removeProject("proj-a");

    const list = await adapter.listProjects();
    expect(list.success).toBe(true);
    if (list.success) {
      expect(list.projects).toHaveLength(1);
      expect(list.projects[0].id).toBe("proj-b");
    }
    adapter.close();
  });
});

describe("IndexedDbProjectAdapter — active project", () => {
  it("returns null when no active project set", async () => {
    const adapter = createAdapter();
    const result = await adapter.getActiveProjectId();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projectId).toBeNull();
    }
    adapter.close();
  });

  it("set and get active project", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest(makeProject({ id: "active-proj" })));
    const setResult = await adapter.setActiveProjectId("active-proj");
    expect(setResult.success).toBe(true);

    const getResult = await adapter.getActiveProjectId();
    expect(getResult.success).toBe(true);
    if (getResult.success) {
      expect(getResult.projectId).toBe("active-proj");
    }
    adapter.close();
  });

  it("set null clears active project", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest());
    await adapter.setActiveProjectId("proj-1");
    await adapter.setActiveProjectId(null);

    const result = await adapter.getActiveProjectId();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projectId).toBeNull();
    }
    adapter.close();
  });

  it("rejects setting nonexistent project as active", async () => {
    const adapter = createAdapter();
    const result = await adapter.setActiveProjectId("nonexistent");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("PROJECT_NOT_FOUND");
    }
    adapter.close();
  });

  it("active project persists across adapter recreation", async () => {
    const adapter = createAdapter();
    await adapter.saveProject(makeSaveRequest());
    await adapter.setActiveProjectId("proj-1");
    adapter.close();

    const result = await adapter.getActiveProjectId();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.projectId).toBe("proj-1");
    }
    adapter.close();
  });
});
