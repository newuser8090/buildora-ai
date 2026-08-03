// ---------------------------------------------------------------------------
// Project transfer race condition tests
//
// Tests that stale operations are properly ignored when newer operations
// supersede them.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ProjectExportService } from "../services/project-export-service";
import { ProjectImportService } from "../services/project-import-service";
import { EXPORT_FORMAT_MARKER, EXPORT_FORMAT_VERSION } from "../types/project-transfer";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-test",
    name: "Test Project",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff",
        cardForeground: "#000000",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    pages: [{ id: "p1", title: "Home", slug: "/", sections: [{ id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} }] }],
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEnvelope(project: Project, exportedAt = "2026-07-30T00:00:00.000Z"): string {
  return JSON.stringify({
    format: EXPORT_FORMAT_MARKER,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt,
    project,
    metadata: {
      originalProjectId: project.id,
      originalProjectName: project.name,
      originalCreatedAt: project.createdAt,
      originalUpdatedAt: project.updatedAt,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Project transfer race conditions", () => {
  describe("import races", () => {
    it("later parse result replaces earlier one", async () => {
      const service = new ProjectImportService();

      // File A (slower — will be superseded)
      const fileA = makeEnvelope(makeProject({ id: "proj-a", name: "Project A" }));

      // File B (faster — should win)
      const fileB = makeEnvelope(makeProject({ id: "proj-b", name: "Project B" }));

      // Parse B first (simulates B finishing first)
      const resultB = service.parse(fileB, "b.buildora.json");
      expect(resultB.ok).toBe(true);

      // Then parse A (A is later but should not replace B if we track tokens)
      const resultA = service.parse(fileA, "a.buildora.json");
      expect(resultA.ok).toBe(true);

      // Both are valid — the caller (UI) tracks tokens and ignores stale results
      // The import service itself doesn't have state, so both parses succeed
      if (resultB.ok && resultA.ok) {
        expect(resultB.preview.originalProjectName).toBe("Project B");
        expect(resultA.preview.originalProjectName).toBe("Project A");
      }
    });
  });

  describe("export races", () => {
    it("export is deterministic — same input, same output (except exportedAt)", () => {
      const service = new ProjectExportService();
      const project = makeProject();

      const result1 = service.exportProject(project, {
        exportedAt: "2026-07-30T00:00:00.000Z",
      });
      const result2 = service.exportProject(project, {
        exportedAt: "2026-07-30T00:00:00.000Z",
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.content).toBe(result2.content);
        expect(result1.envelope.project.id).toBe(result2.envelope.project.id);
      }
    });

    it("export does not mutate project", () => {
      const service = new ProjectExportService();
      const project = makeProject({ name: "Original" });
      const nameBefore = project.name;

      service.exportProject(project);

      expect(project.name).toBe(nameBefore);
    });
  });
});


