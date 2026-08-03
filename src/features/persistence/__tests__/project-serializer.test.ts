import { describe, it, expect, vi } from "vitest";
import { serializeProject, deserializeProject } from "../services/project-serializer";
import { migrateProjectEnvelope } from "../services/project-migrations";
import { CURRENT_FORMAT_VERSION } from "../constants";
import type { Project } from "@/types/project";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "proj-1",
    name: "Test Project",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#000000",
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Serialization tests
// ---------------------------------------------------------------------------

describe("Serialize — output structure", () => {
  it("produces valid JSON string", () => {
    const project = makeProject();
    const json = serializeProject(project);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(parsed.project).toBeDefined();
    expect(parsed.project.id).toBe("proj-1");
  });

  it("includes formatVersion in envelope", () => {
    const json = serializeProject(makeProject());
    const parsed = JSON.parse(json);
    expect(parsed.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it("supports compact output (default)", () => {
    const json = serializeProject(makeProject());
    // Compact JSON has no newlines
    expect(json).not.toContain("\n");
  });

  it("supports pretty output", () => {
    const json = serializeProject(makeProject(), { pretty: true });
    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });

  it("includes optional appVersion", () => {
    const json = serializeProject(makeProject(), { appVersion: "1.0.0" });
    const parsed = JSON.parse(json);
    expect(parsed.appVersion).toBe("1.0.0");
  });

  it("includes optional exportedAt", () => {
    const ts = "2026-07-30T12:00:00.000Z";
    const json = serializeProject(makeProject(), { exportedAt: ts });
    const parsed = JSON.parse(json);
    expect(parsed.exportedAt).toBe(ts);
  });
});

describe("Serialize — field preservation", () => {
  it("preserves asset data URL contents exactly", () => {
    const project = makeProject({
      assets: [
        {
          id: "a1", name: "logo.png", type: "image", mimeType: "image/png", extension: ".png", size: 1024,
          source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const json = serializeProject(project);
    const parsed = JSON.parse(json);
    expect(parsed.project.assets[0].source.value).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("does not mutate the input project", () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    serializeProject(project);
    expect(JSON.stringify(project)).toBe(before);
  });

  it("excludes transient editor/store state", () => {
    // Simulate a project with leaked transient state
    const project = makeProject() as unknown as Record<string, unknown>;
    project._editingSession = { snapshot: {} };
    project.selectedSectionId = "s1";

    const json = serializeProject(project as unknown as Project);
    const parsed = JSON.parse(json);
    expect(parsed.project._editingSession).toBeUndefined();
    expect(parsed.project.selectedSectionId).toBeUndefined();
  });

  it("does not modify project timestamps", () => {
    const project = makeProject({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const json = serializeProject(project);
    const parsed = JSON.parse(json);
    expect(parsed.project.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed.project.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Deserialization tests
// ---------------------------------------------------------------------------

describe("Deserialize — success path", () => {
  it("round-trips a project with assets", () => {
    const original = makeProject({
      assets: [
        {
          id: "a1", name: "logo.png", type: "image", mimeType: "image/png", extension: ".png", size: 1024,
          source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const json = serializeProject(original);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.id).toBe(original.id);
      expect(result.project.name).toBe(original.name);
      expect(result.project.assets).toHaveLength(1);
      expect(result.project.assets[0].id).toBe("a1");
      expect(result.project.assets[0].source.value).toBe("data:image/png;base64,iVBORw0KGgo=");
    }
  });

  it("round-trips a project with multiple asset formats", () => {
    const original = makeProject({
      assets: [
        {
          id: "a1", name: "logo.png", type: "image", mimeType: "image/png", extension: ".png", size: 1024,
          source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a2", name: "hero.webp", type: "image", mimeType: "image/webp", extension: ".webp", size: 2048,
          source: { type: "data-url", value: "data:image/webp;base64,UklGRiQ=" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "a3", name: "icon.svg", type: "icon", mimeType: "image/svg+xml", extension: ".svg", size: 512,
          source: { type: "data-url", value: "data:image/svg+xml;base64,PHN2Zy8+" },
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const json = serializeProject(original);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.assets).toHaveLength(3);
    }
  });

  it("works with empty assets array", () => {
    const original = makeProject({ assets: [] });
    const json = serializeProject(original);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.assets).toEqual([]);
    }
  });

  it("reports migrations applied for legacy projects", () => {
    // Create a raw V1 project (no formatVersion)
    const v1 = makeProject() as unknown as Record<string, unknown>;
    delete (v1 as Record<string, unknown>).assets;
    const json = JSON.stringify(v1);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.migrationsApplied.length).toBeGreaterThan(0);
      expect(result.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    }
  });
});

describe("Deserialize — error handling", () => {
  it("rejects malformed JSON", () => {
    const result = deserializeProject("{invalid json");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_JSON");
    }
  });

  it("rejects null input", () => {
    const result = deserializeProject(null as unknown as string);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects array root", () => {
    const result = deserializeProject("[]");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects primitive root", () => {
    const result = deserializeProject('"string"');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("rejects unsupported future version → UNSUPPORTED_FUTURE_VERSION", () => {
    const input = JSON.stringify({ formatVersion: 999, project: { id: "p1", name: "Future" } });
    const result = deserializeProject(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNSUPPORTED_FUTURE_VERSION");
    }
  });

  it("malformed version → INVALID_FORMAT_VERSION through deserializeProject", () => {
    const result = deserializeProject(JSON.stringify({ formatVersion: -1 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_FORMAT_VERSION");
    }
  });

  it("fractional version → INVALID_FORMAT_VERSION through deserializeProject", () => {
    const result = deserializeProject(JSON.stringify({ formatVersion: 2.5 }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_FORMAT_VERSION");
    }
  });

  it("string version → INVALID_FORMAT_VERSION through deserializeProject", () => {
    const result = deserializeProject(JSON.stringify({ formatVersion: "abc" }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_FORMAT_VERSION");
    }
  });

  it("future version → UNSUPPORTED_FUTURE_VERSION through deserializeProject", () => {
    const result = deserializeProject(JSON.stringify({ formatVersion: 999, project: { name: "F" } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNSUPPORTED_FUTURE_VERSION");
    }
  });

  it("rejects missing project object in version-2 envelope", () => {
    const input = JSON.stringify({ formatVersion: 2 });
    const result = deserializeProject(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_ENVELOPE");
    }
  });

  it("passes deserialized enum types correctly", () => {
    // Verify that the schema validation passes for a deserialized project
    const original = makeProject();
    const json = serializeProject(original);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
  });

  it("deliberately thrown unexpected migration exception becomes MIGRATION_FAILED", async () => {
    // Spy on migrateProjectEnvelope to throw an unexpected exception
    const spy = vi.spyOn(
      await import("../services/project-migrations"),
      "migrateProjectEnvelope",
    );
    spy.mockImplementation(() => {
      throw new Error("Unexpected internal error");
    });

    const result = deserializeProject(JSON.stringify({ formatVersion: 2, project: { name: "test" } }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("MIGRATION_FAILED");
    }

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Deserialize — determinism", () => {
  it("deserializing same legacy input twice produces deeply equal projects", () => {
    const oldProject = makeProject() as unknown as Record<string, unknown>;
    delete (oldProject as Record<string, unknown>).assets;
    const json = JSON.stringify(oldProject);

    const r1 = deserializeProject(json);
    const r2 = deserializeProject(json);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    if (r1.success && r2.success) {
      expect(JSON.stringify(r1.project)).toBe(JSON.stringify(r2.project));
    }
  });

  it("migrating same V1 input twice produces deeply equal envelopes", () => {
    const v1 = makeProject() as unknown as Record<string, unknown>;
    delete (v1 as Record<string, unknown>).assets;
    delete (v1 as Record<string, unknown>).createdAt;
    delete (v1 as Record<string, unknown>).updatedAt;

    const r1 = migrateProjectEnvelope(v1);
    const r2 = migrateProjectEnvelope(v1);
    expect(JSON.stringify(r1.data)).toBe(JSON.stringify(r2.data));
  });

  it("serializing same project twice with identical options produces identical output", () => {
    const project = makeProject();
    const a = serializeProject(project, { pretty: true });
    const b = serializeProject(project, { pretty: true });
    expect(a).toBe(b);
  });

  it("no timestamp changes occur during deserialize/serialize round trips", () => {
    const original = makeProject({
      createdAt: "2025-06-15T12:00:00.000Z",
      updatedAt: "2025-06-15T12:30:00.000Z",
    });
    const json = serializeProject(original);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.createdAt).toBe("2025-06-15T12:00:00.000Z");
      expect(result.project.updatedAt).toBe("2025-06-15T12:30:00.000Z");
    }
  });

  it("missing updatedAt is recovered from createdAt deterministically via V1→V2", () => {
    // This test goes through the V1→V2 migration path (no envelope)
    const v1 = makeProject() as unknown as Record<string, unknown>;
    delete (v1 as Record<string, unknown>).updatedAt;
    const json = JSON.stringify(v1);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.updatedAt).toBe(result.project.createdAt);
    }
  });

  it("missing both timestamps recovers to epoch via V1→V2", () => {
    // This test goes through the V1→V2 migration path (no envelope)
    const v1 = makeProject() as unknown as Record<string, unknown>;
    delete (v1 as Record<string, unknown>).createdAt;
    delete (v1 as Record<string, unknown>).updatedAt;
    const json = JSON.stringify(v1);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.createdAt).toBe("1970-01-01T00:00:00.000Z");
      expect(result.project.updatedAt).toBe("1970-01-01T00:00:00.000Z");
    }
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------

describe("Deserialize — backward compatibility", () => {
  it("deserializes old project without assets", () => {
    const oldProject = makeProject() as unknown as Record<string, unknown>;
    delete (oldProject as Record<string, unknown>).assets;
    const json = JSON.stringify(oldProject);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.project.assets)).toBe(true);
      expect(result.project.assets).toEqual([]);
    }
  });

  it("preserves legacy Hero image URL after round trip", () => {
    const project = makeProject();
    const heroSection = project.pages[0].sections[0];
    (heroSection.props as Record<string, unknown>).image = "https://legacy.example.com/hero.jpg";
    const json = serializeProject(project);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      const props = result.project.pages[0].sections[0].props;
      expect(props.image).toBe("https://legacy.example.com/hero.jpg");
    }
  });

  it("handles Unicode project names", () => {
    const project = makeProject({ name: "🚀 プロジェクト" });
    const json = serializeProject(project);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.name).toBe("🚀 プロジェクト");
    }
  });

  it("derives non-root slugs for legacy non-home pages missing a slug", () => {
    const project = makeProject() as unknown as Record<string, unknown>;
    (project.pages as Array<Record<string, unknown>>).push({
      id: "p2",
      title: "About",
      sections: [
        { id: "s2", type: "hero", order: 1, visible: true, props: {}, styles: {} },
      ],
    });
    const json = JSON.stringify(project);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      // First page keeps the root slug
      expect(result.project.pages[0].slug).toBe("/");
      // Non-first page gets a slug derived from its title, never "/"
      expect(result.project.pages[1].slug).toBe("/about");
    }
  });

  it("never defaults a non-home legacy page to the root slug", () => {
    const project = makeProject() as unknown as Record<string, unknown>;
    (project.pages as Array<Record<string, unknown>>).push({
      id: "p2",
      title: "Home",
      sections: [
        { id: "s2", type: "hero", order: 1, visible: true, props: {}, styles: {} },
      ],
    });
    const json = JSON.stringify(project);
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.project.pages[1].slug).toBe("/home");
      expect(result.project.pages[1].slug).not.toBe("/");
    }
  });
});
