// ---------------------------------------------------------------------------
// filterProjects and sortProjects tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { filterProjects } from "../utils/filter-projects";
import { sortProjects } from "../utils/sort-projects";
import type { DashboardProject } from "../types";

function makeProject(overrides: Partial<DashboardProject>): DashboardProject {
  return {
    id: "proj-1",
    name: "Test",
    revision: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    savedAt: "2026-06-01T00:00:00.000Z",
    isActive: false,
    isPinned: false,
    pageCount: 1,
    assetCount: 0,
    ...overrides,
  };
}

describe("filterProjects", () => {
  const projects = [
    makeProject({ id: "1", name: "Alpha Project" }),
    makeProject({ id: "2", name: "Beta Project" }),
    makeProject({ id: "3", name: "Gamma App" }),
  ];

  it("returns all projects for empty query", () => {
    expect(filterProjects(projects, "")).toHaveLength(3);
  });

  it("filters case-insensitively", () => {
    const result = filterProjects(projects, "alpha");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alpha Project");
  });

  it("filters with mixed case query", () => {
    const result = filterProjects(projects, "PROJECT");
    expect(result).toHaveLength(2);
  });

  it("trims query whitespace", () => {
    const result = filterProjects(projects, "  beta  ");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Beta Project");
  });

  it("returns empty array for no matches", () => {
    expect(filterProjects(projects, "nonexistent")).toHaveLength(0);
  });

  it("does not mutate input array", () => {
    const copy = [...projects];
    filterProjects(projects, "alpha");
    expect(projects).toEqual(copy);
  });
});

describe("sortProjects", () => {
  const now = "2026-07-31T12:00:00.000Z";
  const earlier = "2026-01-01T00:00:00.000Z";

  const projects = [
    makeProject({ id: "b", name: "Beta", updatedAt: now, createdAt: earlier }),
    makeProject({ id: "a", name: "Alpha", updatedAt: earlier, createdAt: now }),
  ];

  it("sorts by last-edited descending", () => {
    const sorted = sortProjects(projects, "last-edited");
    expect(sorted[0].name).toBe("Beta");
    expect(sorted[1].name).toBe("Alpha");
  });

  it("sorts by recently-created descending", () => {
    const sorted = sortProjects(projects, "recently-created");
    expect(sorted[0].name).toBe("Alpha");
    expect(sorted[1].name).toBe("Beta");
  });

  it("sorts by name A-Z", () => {
    const sorted = sortProjects(projects, "name-asc");
    expect(sorted[0].name).toBe("Alpha");
    expect(sorted[1].name).toBe("Beta");
  });

  it("sorts by name Z-A", () => {
    const sorted = sortProjects(projects, "name-desc");
    expect(sorted[0].name).toBe("Beta");
    expect(sorted[1].name).toBe("Alpha");
  });

  it("places pinned projects first", () => {
    const pinned = makeProject({ id: "p1", name: "Pinned Beta", updatedAt: earlier, isPinned: true });
    const all = [...projects, pinned];
    const sorted = sortProjects(all, "last-edited");
    expect(sorted[0].name).toBe("Pinned Beta");
  });

  it("uses deterministic tie-breaker (project ID)", () => {
    const a = makeProject({ id: "a", name: "Same Name" });
    const b = makeProject({ id: "b", name: "Same Name" });
    const sorted = sortProjects([b, a], "name-asc");
    expect(sorted[0].id).toBe("a");
    expect(sorted[1].id).toBe("b");
  });

  it("does not mutate input array", () => {
    const copy = [...projects];
    sortProjects(projects, "name-asc");
    expect(projects).toEqual(copy);
  });
});
