// ---------------------------------------------------------------------------
// ProjectImportService tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ProjectImportService } from "../services/project-import-service";
import { EXPORT_FORMAT_VERSION, EXPORT_FORMAT_MARKER } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExportEnvelope(overrides?: Record<string, unknown>): string {
  const envelope = {
    format: EXPORT_FORMAT_MARKER,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: "2026-06-15T12:00:00.000Z",
    project: {
      id: "proj-original",
      name: "Imported Project",
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
    },
    metadata: {
      originalProjectId: "proj-original",
      originalProjectName: "Imported Project",
      originalCreatedAt: "2026-01-01T00:00:00.000Z",
      originalUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    ...overrides,
  };
  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectImportService", () => {
  const service = new ProjectImportService();

  describe("parse", () => {
    it("parses a valid current export", () => {
      const json = makeExportEnvelope();
      const result = service.parse(json, "test.buildora.json");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.preview.originalProjectName).toBe("Imported Project");
        expect(result.preview.project.name).toBe("Imported Project");
        expect(result.preview.schemaVersion).toBeGreaterThanOrEqual(1);
        // Migration may add a warning (e.g., PROJECT_WRAPPED_IN_ENVELOPE)
        expect(result.preview.warnings.length).toBeLessThanOrEqual(1);
      }
    });

    it("rejects invalid JSON", () => {
      const result = service.parse("not json", "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_JSON");
      }
    });

    it("rejects empty JSON", () => {
      const result = service.parse("", "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("EMPTY_FILE");
      }
    });

    it("rejects whitespace-only text", () => {
      const result = service.parse("   \n  ", "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("EMPTY_FILE");
      }
    });

    it("rejects array root", () => {
      const result = service.parse("[]", "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_EXPORT_ENVELOPE");
      }
    });

    it("rejects null root", () => {
      const result = service.parse("null", "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_EXPORT_ENVELOPE");
      }
    });

    it("rejects wrong format", () => {
      const json = makeExportEnvelope({ format: "some-other-format" });
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_FORMAT");
      }
    });

    it("rejects missing format", () => {
      const envelope = {
        formatVersion: 1,
        project: { name: "Test" },
      };
      const result = service.parse(JSON.stringify(envelope), "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_FORMAT");
      }
    });

    it("rejects unsupported format version", () => {
      const json = makeExportEnvelope({ formatVersion: 999 });
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("UNSUPPORTED_FORMAT_VERSION");
      }
    });

    it("rejects missing project field", () => {
      const json = makeExportEnvelope({ project: undefined });
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_EXPORT_ENVELOPE");
      }
    });

    it("rejects dangerous keys (__proto__)", () => {
      // Manually construct JSON with __proto__ at the project level.
      // Object spread {...obj} for __proto__ sets the prototype instead of
      // creating an own property, so we inject it directly in the string.
      const json = `{
        "format": "buildora-project",
        "formatVersion": 1,
        "exportedAt": "2026-06-15T12:00:00.000Z",
        "project": {
          "id": "proj-test",
          "name": "Test",
          "theme": { "palette": {}, "typography": {}, "spacing": {}, "radius": {}, "shadows": {} },
          "pages": [{ "id": "p1", "title": "Home", "slug": "/", "sections": [] }],
          "assets": [],
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        },
        "__proto__": { "admin": true }
      }`;
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
    });

    it("warns about non-buildora extension", () => {
      const json = makeExportEnvelope();
      const result = service.parse(json, "project.json");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.preview.warnings.some((w) => w.code === "FILE_EXTENSION_NOT_BUILDORA")).toBe(true);
      }
    });

    it("does not mutate source text", () => {
      const json = makeExportEnvelope();
      const original = json;
      service.parse(json, "test.buildora.json");
      expect(json).toBe(original);
    });
  });


  describe("generateUniqueImportName", () => {
    it("generates base imported name when no conflict", () => {
      const name = service.generateUniqueImportName("My Project", ["Other"]);
      expect(name).toBe("My Project (Imported)");
    });

    it("increments counter when base name conflicts", () => {
      const name = service.generateUniqueImportName(
        "My Project",
        ["My Project (Imported)"],
      );
      expect(name).toBe("My Project (Imported 2)");
    });

    it("increments further when multiple conflicts exist", () => {
      const name = service.generateUniqueImportName(
        "My Project",
        ["My Project (Imported)", "My Project (Imported 2)"],
      );
      expect(name).toBe("My Project (Imported 3)");
    });
  });
});
