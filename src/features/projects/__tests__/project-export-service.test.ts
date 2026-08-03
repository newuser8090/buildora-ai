// ---------------------------------------------------------------------------
// ProjectExportService tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ProjectExportService } from "../services/project-export-service";
import type { Project } from "@/types/project";
import { EXPORT_FORMAT_VERSION, EXPORT_FORMAT_MARKER } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-test-1",
    name: "Test Project",
    theme: {
      palette: {
        background: "#ffffff",
        foreground: "#0a0a0a",
        primary: "#7c5cfc",
        primaryForeground: "#ffffff",
        secondary: "#f5f5f5",
        secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#7c5cfc",
        accentForeground: "#ffffff",
        border: "#e5e5e5",
        card: "#ffffff",
        cardForeground: "#000000",
      },
      typography: {
        fontFamily: "Geist, system-ui, sans-serif",
        headingFont: "Geist, system-ui, sans-serif",
        baseSize: "16px",
        scale: 1.25,
      },
      spacing: {
        sectionPadding: "6rem 0",
        containerMaxWidth: "1120px",
        gap: "1.5rem",
      },
      radius: {
        sm: "0.375rem",
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
        full: "9999px",
      },
      shadows: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.07)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
        xl: "0 20px 25px rgba(0,0,0,0.15)",
      },
    },
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          { id: "s1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        ],
      },
    ],
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectExportService", () => {
  describe("exportProject", () => {
    it("exports a valid project successfully", () => {
      const service = new ProjectExportService();
      const project = makeProject({ name: "Landing Page" });
      const result = service.exportProject(project);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.format).toBe(EXPORT_FORMAT_MARKER);
        expect(result.envelope.formatVersion).toBe(EXPORT_FORMAT_VERSION);
        expect(result.envelope.exportedAt).toBeTruthy();
        expect(result.envelope.project.name).toBe("Landing Page");
        expect(result.filename).toMatch(/\.buildora\.json$/);
      }
    });

    it("produces deterministic output with fixed exportedAt", () => {
      const service = new ProjectExportService();
      const project = makeProject();

      const result1 = service.exportProject(project, {
        exportedAt: "2026-01-01T00:00:00.000Z",
      });
      const result2 = service.exportProject(project, {
        exportedAt: "2026-01-01T00:00:00.000Z",
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result1.content).toBe(result2.content);
      }
    });

    it("includes correct format marker", () => {
      const service = new ProjectExportService();
      const result = service.exportProject(makeProject());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.format).toBe(EXPORT_FORMAT_MARKER);
        const parsed = JSON.parse(result.content);
        expect(parsed.format).toBe(EXPORT_FORMAT_MARKER);
      }
    });

    it("includes correct format version", () => {
      const service = new ProjectExportService();
      const result = service.exportProject(makeProject());

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.formatVersion).toBe(EXPORT_FORMAT_VERSION);
        const parsed = JSON.parse(result.content);
        expect(parsed.formatVersion).toBe(EXPORT_FORMAT_VERSION);
      }
    });

    it("includes exportedAt", () => {
      const service = new ProjectExportService();
      const result = service.exportProject(makeProject(), {
        exportedAt: "2026-06-15T12:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.exportedAt).toBe("2026-06-15T12:00:00.000Z");
      }
    });

    it("serializes project canonically", () => {
      const service = new ProjectExportService();
      const result = service.exportProject(makeProject());

      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.project.id).toBe("proj-test-1");
        expect(parsed.project.name).toBe("Test Project");
        expect(parsed.project.pages).toHaveLength(1);
      }
    });

    it("omits runtime-only state", () => {
      const service = new ProjectExportService();
      const project = makeProject();
      // Add some extra runtime property
      (project as unknown as Record<string, unknown>).dirtyState = "unsaved";
      (project as unknown as Record<string, unknown>)._runtimeCache = { foo: "bar" };

      const result = service.exportProject(project);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.content);
        expect(parsed.project.dirtyState).toBeUndefined();
        expect(parsed.project._runtimeCache).toBeUndefined();
      }
    });

    it("generates safe filename from project name", () => {
      const service = new ProjectExportService();

      const result1 = service.exportProject(makeProject({ name: "Landing Page" }));
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.filename).toBe("landing-page.buildora.json");
      }

      const result2 = service.exportProject(makeProject({ name: "My / Project?" }));
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.filename).toBe("my-project.buildora.json");
      }

      const result3 = service.exportProject(makeProject({ name: "" }));
      expect(result3.ok).toBe(false);
    });

    it("rejects invalid project", () => {
      const service = new ProjectExportService();
      const invalid = { id: "no-name" } as unknown as Project;

      const result = service.exportProject(invalid);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("EXPORT_SERIALIZATION_FAILED");
      }
    });

    it("includes metadata with origin info", () => {
      const service = new ProjectExportService();
      const project = makeProject({
        id: "orig-id-123",
        name: "Original Project",
      });

      const result = service.exportProject(project);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.metadata).toBeDefined();
        expect(result.envelope.metadata!.originalProjectId).toBe("orig-id-123");
        expect(result.envelope.metadata!.originalProjectName).toBe("Original Project");
        expect(result.envelope.metadata!.originalCreatedAt).toBe(project.createdAt);
        expect(result.envelope.metadata!.originalUpdatedAt).toBe(project.updatedAt);
      }
    });

    it("does not mutate the input project", () => {
      const service = new ProjectExportService();
      const project = makeProject({ name: "Original" });
      const nameBefore = project.name;

      service.exportProject(project);

      expect(project.name).toBe(nameBefore);
    });
  });
});
