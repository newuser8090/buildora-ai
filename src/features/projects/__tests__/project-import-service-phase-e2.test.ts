// ---------------------------------------------------------------------------
// ProjectImportService — Phase E.2 tests
//
// Covers:
//   - Complete limit enforcement (pages 100, total sections 2000, assets 2000,
//     canonical project name 80, text field 5000, structural depth 20) with
//     structured { limit, actual, max, path } details — never truncated
//   - Unknown-field policy: UNKNOWN_OPTIONAL_FIELD_IGNORED warnings,
//     deterministic ordering, dedup, runtime project contains no unknown fields
//   - Dangerous-key policy: own __proto__ / prototype / constructor rejected,
//     nested + array members rejected, values and near-keys accepted
//   - Extension policy (parse level): case-insensitive .BUILDORA.JSON accepted
//     without warning; .json warns; .txt/.buildora/.backup warn at parse level
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { ProjectImportService } from "../services/project-import-service";
import { EXPORT_FORMAT_VERSION, EXPORT_FORMAT_MARKER } from "../types/project-transfer";
import { MAX_PROJECT_NAME_LENGTH } from "../utils/validate-project-name";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTheme() {
  return {
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
  };
}

/** Tiny valid data URL payload ("AA==" is 1 byte). */
const TINY_DATA_URL = "data:image/png;base64,AA==";

function makeSection(id: string, props: Record<string, unknown> = {}, styles: Record<string, unknown> = {}) {
  return { id, type: "hero", order: 1, visible: true, props, styles };
}

function makePage(id: string, sections: unknown[]) {
  return { id, title: "Home", slug: "/", sections };
}

function makeAsset(id: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    mimeType: "image/png",
    extension: ".png",
    size: 100,
    source: { type: "data-url", value: TINY_DATA_URL },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

function makeProjectData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "proj-original",
    name: "Imported Project",
    theme: makeTheme(),
    pages: [makePage("p1", [makeSection("s1")])],
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Build an export envelope string from root-level overrides. */
function makeEnvelope(projectData?: Record<string, unknown>, rootOverrides: Record<string, unknown> = {}): string {
  const envelope: Record<string, unknown> = {
    format: EXPORT_FORMAT_MARKER,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: "2026-06-15T12:00:00.000Z",
    project: projectData ?? makeProjectData(),
    metadata: {
      originalProjectId: "proj-original",
      originalProjectName: "Imported Project",
      originalCreatedAt: "2026-01-01T00:00:00.000Z",
      originalUpdatedAt: "2026-06-01T00:00:00.000Z",
    },
    ...rootOverrides,
  };
  return JSON.stringify(envelope, null, 2);
}

function buildSections(count: number, props: Record<string, unknown> = {}): unknown[] {
  return Array.from({ length: count }, (_, i) => makeSection(`s${i}`, props));
}

function buildPages(count: number, sectionsPerPage: number): unknown[] {
  return Array.from({ length: count }, (_, i) =>
    makePage(`p${i}`, buildSections(sectionsPerPage)),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectImportService — Phase E.2 limits", () => {
  const service = new ProjectImportService();

  describe("pages limit (100)", () => {
    it("accepts exactly 100 pages", () => {
      const json = makeEnvelope(makeProjectData({ pages: buildPages(100, 1) }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(true);
    });

    it("rejects 101 pages with structured details", () => {
      const json = makeEnvelope(makeProjectData({ pages: buildPages(101, 1) }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROJECT_VALIDATION_FAILED");
        expect(result.error.details).toMatchObject({
          limit: "PAGES",
          actual: 101,
          max: 100,
        });
      }
    });
  });

  describe("total sections limit (2000 across all pages)", () => {
    it("accepts exactly 2000 sections spread across pages", () => {
      // 100 pages × 20 sections = 2000 total (count is total across all pages)
      const json = makeEnvelope(makeProjectData({ pages: buildPages(100, 20) }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(true);
    });

    it("rejects 2001 total sections even when no single page exceeds the per-page cap", () => {
      // 99 pages × 20 + 1 page × 21 = 2001 total; per-page (2000) never violated
      const pages = [
        ...buildPages(99, 20),
        makePage("p99", buildSections(21)),
      ];
      const json = makeEnvelope(makeProjectData({ pages }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.details).toMatchObject({
          limit: "SECTIONS",
          actual: 2001,
          max: 2000,
          path: "project.pages[].sections",
        });
      }
    });
  });

  describe("assets limit (2000)", () => {
    it("accepts exactly 2000 assets", () => {
      const assets = Array.from({ length: 2000 }, (_, i) => makeAsset(`a${i}`));
      const json = makeEnvelope(makeProjectData({ assets }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(true);
    });

    it("rejects 2001 assets with structured details", () => {
      const assets = Array.from({ length: 2001 }, (_, i) => makeAsset(`a${i}`));
      const json = makeEnvelope(makeProjectData({ assets }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.details).toMatchObject({
          limit: "ASSETS",
          actual: 2001,
          max: 2000,
        });
      }
    });
  });

  describe("canonical project-name limit (80 chars)", () => {
    it("accepts a name of exactly 80 characters", () => {
      const json = makeEnvelope(makeProjectData({ name: "a".repeat(MAX_PROJECT_NAME_LENGTH) }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(true);
    });

    it("rejects a name of 81 characters with structured details", () => {
      const json = makeEnvelope(makeProjectData({ name: "a".repeat(MAX_PROJECT_NAME_LENGTH + 1) }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROJECT_VALIDATION_FAILED");
        expect(result.error.details).toMatchObject({
          limit: "PROJECT_NAME",
          actual: MAX_PROJECT_NAME_LENGTH + 1,
          max: MAX_PROJECT_NAME_LENGTH,
          path: "project.name",
        });
      }
    });
  });

  describe("text-field limit (5000 chars)", () => {
    it("accepts a text field of exactly 5000 characters", () => {
      const page = makePage("p1", [makeSection("s1", { headline: "a".repeat(5000) })]);
      const json = makeEnvelope(makeProjectData({ pages: [page] }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(true);
    });

    it("rejects a text field of 5001 characters with structured details", () => {
      const page = makePage("p1", [makeSection("s1", { headline: "a".repeat(5001) })]);
      const json = makeEnvelope(makeProjectData({ pages: [page] }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROJECT_VALIDATION_FAILED");
        expect(result.error.details).toMatchObject({
          limit: "TEXT_FIELD",
          actual: 5001,
          max: 5000,
        });
      }
    });

    it("rejects nested text fields consistently (inside arrays)", () => {
      const page = makePage("p1", [
        makeSection("s1", { features: [{ title: "a".repeat(5001) }] }),
      ]);
      const json = makeEnvelope(makeProjectData({ pages: [page] }));
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.details).toMatchObject({ limit: "TEXT_FIELD", max: 5000 });
      }
    });
  });

  describe("structural depth limit (20)", () => {
    it("accepts valid supported nesting", () => {
      const result = service.parse(makeEnvelope(), "test.buildora.json");
      expect(result.ok).toBe(true);
    });

    it("rejects excessive nesting with structured details", () => {
      // Build a deeply nested value (25 levels) inside metadata.
      let deep: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < 25; i++) deep = { child: deep };
      const json = makeEnvelope(undefined, { metadata: { deep } });
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PROJECT_VALIDATION_FAILED");
        expect(result.error.details).toMatchObject({
          limit: "STRUCTURAL_DEPTH",
          max: 20,
        });
        expect((result.error.details as Record<string, unknown>).path).toContain("deep");
      }
    });

    it("rejects impossible nesting inside arrays", () => {
      let deep: unknown[] = [1];
      for (let i = 0; i < 25; i++) deep = [deep];
      const json = makeEnvelope(undefined, { metadata: { deep } });
      const result = service.parse(json, "test.buildora.json");
      expect(result.ok).toBe(false);
    });
  });
});

describe("ProjectImportService — Phase E.2 unknown-field policy", () => {
  const service = new ProjectImportService();

  function envelopeWithUnknownFields(): string {
    const projectData = makeProjectData({
      projectExtra: "custom",                                   // $.project.projectExtra
      theme: { ...makeTheme(), themeExtra: "custom" },          // $.project.theme.themeExtra
      pages: [makePage("p1", [makeSection("s1", {}, {})],) as unknown], // placeholder below
      assets: [makeAsset("a1", { assetExtra: "custom" })],
    });
    // Rebuild pages with per-level unknown fields (page + section).
    projectData.pages = [{
      id: "p1",
      title: "Home",
      slug: "/",
      pageExtra: "custom", // $.project.pages[0].pageExtra
      sections: [{
        id: "s1",
        type: "hero",
        order: 1,
        visible: true,
        props: {},
        styles: {},
        sectionExtra: "custom", // $.project.pages[0].sections[0].sectionExtra
      }],
    }];
    return makeEnvelope(projectData, {
      rootExtra: "custom", // $.rootExtra
      metadata: {
        originalProjectId: "proj-original",
        originalProjectName: "Imported Project",
        originalCreatedAt: "2026-01-01T00:00:00.000Z",
        originalUpdatedAt: "2026-06-01T00:00:00.000Z",
        metadataExtra: "custom", // $.metadata.metadataExtra
      },
    });
  }

  it("adds a UNKNOWN_OPTIONAL_FIELD_IGNORED warning per unknown field", () => {
    const result = service.parse(envelopeWithUnknownFields(), "test.buildora.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const unknownWarnings = result.preview.warnings.filter(
        (w) => w.code === "UNKNOWN_OPTIONAL_FIELD_IGNORED",
      );
      expect(unknownWarnings.map((w) => w.message)).toEqual(expect.arrayContaining([
        'Unknown field "$.rootExtra" was ignored.',
        'Unknown field "$.metadata.metadataExtra" was ignored.',
        'Unknown field "$.project.projectExtra" was ignored.',
        'Unknown field "$.project.theme.themeExtra" was ignored.',
        'Unknown field "$.project.pages[0].pageExtra" was ignored.',
        'Unknown field "$.project.pages[0].sections[0].sectionExtra" was ignored.',
        'Unknown field "$.project.assets[0].assetExtra" was ignored.',
      ]));
    }
  });

  it("produces deterministic warning ordering (document order)", () => {
    const result = service.parse(envelopeWithUnknownFields(), "test.buildora.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.preview.warnings
        .filter((w) => w.code === "UNKNOWN_OPTIONAL_FIELD_IGNORED")
        .map((w) => w.message);
      expect(paths).toEqual([
        'Unknown field "$.rootExtra" was ignored.',
        'Unknown field "$.metadata.metadataExtra" was ignored.',
        'Unknown field "$.project.projectExtra" was ignored.',
        'Unknown field "$.project.theme.themeExtra" was ignored.',
        'Unknown field "$.project.pages[0].pageExtra" was ignored.',
        'Unknown field "$.project.pages[0].sections[0].sectionExtra" was ignored.',
        'Unknown field "$.project.assets[0].assetExtra" was ignored.',
      ]);
    }
  });

  it("deduplicates unknown-field warnings (each path once)", () => {
    const result = service.parse(envelopeWithUnknownFields(), "test.buildora.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const paths = result.preview.warnings
        .filter((w) => w.code === "UNKNOWN_OPTIONAL_FIELD_IGNORED")
        .map((w) => w.message);
      expect(new Set(paths).size).toBe(paths.length);
    }
  });

  it("runtime project contains no unknown fields", () => {
    const result = service.parse(envelopeWithUnknownFields(), "test.buildora.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const project = result.preview.project as Project;
      const serialized = JSON.stringify(project);
      expect(serialized).not.toContain("projectExtra");
      expect(serialized).not.toContain("themeExtra");
      expect(serialized).not.toContain("pageExtra");
      expect(serialized).not.toContain("sectionExtra");
      expect(serialized).not.toContain("assetExtra");
      expect(serialized).not.toContain("rootExtra");
      expect(serialized).not.toContain("metadataExtra");
    }
  });

  it("malformed required fields remain fatal despite unknown optional fields", () => {
    const projectData = makeProjectData({ pages: "not-an-array" as unknown });
    const json = makeEnvelope(projectData, { rootExtra: "x" });
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(false);
  });

  it("does not mutate the source text", () => {
    const json = envelopeWithUnknownFields();
    const snapshot = json;
    service.parse(json, "test.buildora.json");
    expect(json).toBe(snapshot);
  });
});

describe("ProjectImportService — Phase E.2 dangerous-keys policy", () => {
  const service = new ProjectImportService();

  function envelopeWithRawKey(keyName: string, container = "root"): string {
    const keyLiteral = `"${keyName}": { "admin": true }`;
    if (container === "root") {
      return `{
        "format": "${EXPORT_FORMAT_MARKER}",
        "formatVersion": ${EXPORT_FORMAT_VERSION},
        "exportedAt": "2026-06-15T12:00:00.000Z",
        ${keyLiteral},
        "project": ${JSON.stringify(makeProjectData())},
        "metadata": {
          "originalProjectId": "proj-original",
          "originalProjectName": "Imported Project",
          "originalCreatedAt": "2026-01-01T00:00:00.000Z",
          "originalUpdatedAt": "2026-06-01T00:00:00.000Z"
        }
      }`;
    }
    if (container === "project") {
      return `{
        "format": "${EXPORT_FORMAT_MARKER}",
        "formatVersion": ${EXPORT_FORMAT_VERSION},
        "exportedAt": "2026-06-15T12:00:00.000Z",
        "project": {
          ${keyLiteral},
          ${JSON.stringify(makeProjectData()).slice(1, -1).replace(/^\{/, "")}
        }
      }`;
    }
    throw new Error("unknown container");
  }

  it("rejects an own __proto__ key at the root", () => {
    const result = service.parse(envelopeWithRawKey("__proto__"), "test.buildora.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_PROJECT_DATA");
  });

  it("rejects an own prototype key at the root", () => {
    const result = service.parse(envelopeWithRawKey("prototype"), "test.buildora.json");
    expect(result.ok).toBe(false);
  });

  it("rejects an own constructor key at the root", () => {
    const result = service.parse(envelopeWithRawKey("constructor"), "test.buildora.json");
    expect(result.ok).toBe(false);
  });

  it("rejects a nested dangerous key", () => {
    const json = `{
      "format": "${EXPORT_FORMAT_MARKER}",
      "formatVersion": ${EXPORT_FORMAT_VERSION},
      "exportedAt": "2026-06-15T12:00:00.000Z",
      "project": ${JSON.stringify(makeProjectData())},
      "metadata": { "nested": { "__proto__": { "polluted": true } } }
    }`;
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(false);
  });

  it("rejects a dangerous key inside an array element", () => {
    const json = `{
      "format": "${EXPORT_FORMAT_MARKER}",
      "formatVersion": ${EXPORT_FORMAT_VERSION},
      "exportedAt": "2026-06-15T12:00:00.000Z",
      "project": ${JSON.stringify(makeProjectData())},
      "metadata": { "list": [ { "constructor": 1 } ] }
    }`;
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(false);
  });

  it("accepts text values equal to 'constructor'", () => {
    const page = makePage("p1", [makeSection("s1", { title: "constructor" })]);
    const json = makeEnvelope(makeProjectData({ pages: [page] }));
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(true);
  });

  it("accepts a project name equal to 'Constructor'", () => {
    const json = makeEnvelope(makeProjectData({ name: "Constructor" }));
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(true);
  });

  it("accepts text containing '__proto__'", () => {
    const page = makePage("p1", [makeSection("s1", { note: "see __proto__ docs" })]);
    const json = makeEnvelope(makeProjectData({ pages: [page] }));
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(true);
  });

  it("does not reject inherited constructor properties", () => {
    // A normal JSON object's prototype chain includes Object.prototype.constructor.
    // Only own enumerable keys are inspected, so a plain envelope parses fine.
    const result = service.parse(makeEnvelope(), "test.buildora.json");
    expect(result.ok).toBe(true);
  });

  it("accepts near-miss keys constructorLabel and prototypeName", () => {
    const projectData = makeProjectData({
      constructorLabel: "ok",
      prototypeName: "ok",
    }) as unknown as Project;
    const json = makeEnvelope(projectData as unknown as Record<string, unknown>);
    const result = service.parse(json, "test.buildora.json");
    expect(result.ok).toBe(true);
  });
});

describe("ProjectImportService — Phase E.2 extension policy", () => {
  const service = new ProjectImportService();
  const json = makeEnvelope();

  it("accepts .buildora.json without a warning", () => {
    const result = service.parse(json, "project.buildora.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.warnings.some((w) => w.code === "FILE_EXTENSION_NOT_BUILDORA")).toBe(false);
    }
  });

  it("accepts .BUILDORA.JSON without a warning (case-insensitive)", () => {
    const result = service.parse(json, "PROJECT.BUILDORA.JSON");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.warnings.some((w) => w.code === "FILE_EXTENSION_NOT_BUILDORA")).toBe(false);
    }
  });

  it("warns for .json", () => {
    const result = service.parse(json, "project.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.warnings.some((w) => w.code === "FILE_EXTENSION_NOT_BUILDORA")).toBe(true);
    }
  });

  it("warns for .txt, .buildora and .backup at parse level", () => {
    for (const name of ["project.txt", "project.buildora", "project.buildora.json.backup", "project"]) {
      const result = service.parse(json, name);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(
          result.preview.warnings.some((w) => w.code === "FILE_EXTENSION_NOT_BUILDORA"),
          `expected warning for ${name}`,
        ).toBe(true);
      }
    }
  });

  it("handles multiple dots correctly", () => {
    const result = service.parse(json, "archive.v1.buildora.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.warnings.some((w) => w.code === "FILE_EXTENSION_NOT_BUILDORA")).toBe(false);
    }
  });
});
