import { describe, it, expect } from "vitest";
import { migrateProjectEnvelope } from "../services/project-migrations";
import { CURRENT_FORMAT_VERSION } from "../constants";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeV1Project(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "proj-1",
    name: "Legacy",
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
// Tests
// ---------------------------------------------------------------------------

describe("Migrate — version detection", () => {
  function assertInvalid(input: unknown): void {
    const result = migrateProjectEnvelope(input);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("INVALID_FORMAT_VERSION");
  }

  it("treats null/undefined as undetectable", () => {
    assertInvalid(null);
    assertInvalid(undefined);
  });

  it("treats primitive values as undetectable", () => {
    assertInvalid("string");
    assertInvalid(42);
  });

  it("treats array root as undetectable", () => {
    assertInvalid([]);
  });

  it("treats empty array as undetectable", () => {
    assertInvalid([]);
  });
});

describe("Migrate — format version validation", () => {
  it("rejects unsupported future version", () => {
    const input = { formatVersion: 999, project: { name: "Future" } };
    const result = migrateProjectEnvelope(input);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("UNSUPPORTED_FUTURE_VERSION");
    expect(result.error!.message).toContain("supports up to version");
  });

  it("rejects negative version → INVALID_FORMAT_VERSION", () => {
    const input = { formatVersion: -1 };
    const result = migrateProjectEnvelope(input);
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe("INVALID_FORMAT_VERSION");
  });

  it("rejects fractional version → INVALID_FORMAT_VERSION", () => {
    const input = { formatVersion: 1.5 };
    const result = migrateProjectEnvelope(input);
    expect(result.error!.code).toBe("INVALID_FORMAT_VERSION");
  });

  it("rejects string version → INVALID_FORMAT_VERSION", () => {
    const input = { formatVersion: "2" };
    const result = migrateProjectEnvelope(input);
    expect(result.error!.code).toBe("INVALID_FORMAT_VERSION");
  });

  it("rejects NaN version → INVALID_FORMAT_VERSION", () => {
    const input = { formatVersion: NaN };
    const result = migrateProjectEnvelope(input);
    expect(result.error!.code).toBe("INVALID_FORMAT_VERSION");
  });
});

describe("Migrate — no migration needed", () => {
  it("returns data unchanged for current version", () => {
    const input = {
      formatVersion: CURRENT_FORMAT_VERSION,
      project: { id: "p1", name: "Current" },
    };
    const result = migrateProjectEnvelope(input);
    expect(result.applied).toEqual([]);
    expect(result.data).toBe(input); // Same reference when no migration needed
  });
});

describe("Migrate — V1 → V2", () => {
  it("wraps a raw legacy project without formatVersion inside an envelope", () => {
    const v1 = makeV1Project();
    const result = migrateProjectEnvelope(v1);
    expect(result.applied).toContain("v1→v2");
    const envelope = result.data as Record<string, unknown>;
    expect(envelope.formatVersion).toBe(2);
    expect(envelope.project).toBeDefined();
    const projectData = envelope.project as Record<string, unknown>;
    expect(projectData.id).toBe("proj-1");
    expect(projectData.name).toBe("Legacy");
  });

  it("normalizes missing assets to empty array", () => {
    const v1 = makeV1Project();
    // Ensure no assets field
    delete (v1 as Record<string, unknown>).assets;
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    expect(Array.isArray(projectData.assets)).toBe(true);
    expect(projectData.assets).toEqual([]);
  });

  it("normalizes non-array assets to empty array", () => {
    const v1 = makeV1Project({ assets: "not-an-array" });
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    expect(Array.isArray(projectData.assets)).toBe(true);
    expect(projectData.assets).toEqual([]);
  });

  it("preserves existing assets when valid", () => {
    const asset1 = { id: "a1", name: "logo.png", type: "image" as const, mimeType: "image/png", extension: ".png", size: 1024, source: { type: "data-url" as const, value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" };
    const asset2 = { id: "a2", name: "hero.jpg", type: "image" as const, mimeType: "image/jpeg", extension: ".jpg", size: 2048, source: { type: "data-url" as const, value: "data:image/jpeg;base64,/9j/4AAQ" }, createdAt: "2026-01-01T00:00:00.000Z" };
    const assets = [asset1, asset2];
    const v1 = makeV1Project({ assets });
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    const projectAssets = projectData.assets as unknown[];
    expect(projectAssets).toEqual(assets);
    expect(projectAssets.length).toBe(2);
  });

  it("preserves legacy Hero image URL", () => {
    const v1 = makeV1Project();
    const pages = v1.pages as Record<string, unknown>[];
    const sections = pages[0].sections as Record<string, unknown>[];
    const heroSection = sections[0];
    heroSection.props = {
      ...(heroSection.props as Record<string, unknown>),
      image: "https://legacy.example.com/hero.jpg",
    };
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    const page = (projectData.pages as Record<string, unknown>[])[0];
    const section = (page.sections as Record<string, unknown>[])[0];
    const props = section.props as Record<string, unknown>;
    expect(props.image).toBe("https://legacy.example.com/hero.jpg");
  });

  it("preserves AssetRef fields when present", () => {
    const v1 = makeV1Project();
    const asset = { id: "logo-1", name: "brand.png", type: "logo" as const, mimeType: "image/png", extension: ".png", size: 512, source: { type: "data-url" as const, value: "data:image/png;base64,aGVsbG8=" }, createdAt: "2026-01-01T00:00:00.000Z" };
    v1.assets = [asset];
    const pages = v1.pages as Record<string, unknown>[];
    const heroSection = pages[0].sections as Record<string, unknown>[];
    heroSection[0].props = {
      ...(heroSection[0].props as Record<string, unknown>),
      logoImage: { assetId: "logo-1" },
    };
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    const projectAssets = projectData.assets as unknown[];
    expect(projectAssets.length).toBe(1);
    const page = (projectData.pages as Record<string, unknown>[])[0];
    const section = (page.sections as Record<string, unknown>[])[0];
    const props = section.props as Record<string, unknown>;
    expect((props.logoImage as Record<string, unknown>).assetId).toBe("logo-1");
  });

  it("preserves IDs and timestamps", () => {
    const v1 = makeV1Project({
      id: "special-id",
      createdAt: "2025-06-15T12:00:00.000Z",
      updatedAt: "2025-06-15T12:00:00.000Z",
    });
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    expect(projectData.id).toBe("special-id");
    expect(projectData.createdAt).toBe("2025-06-15T12:00:00.000Z");
    expect(projectData.updatedAt).toBe("2025-06-15T12:00:00.000Z");
  });

  it("recovers both missing timestamps to epoch", () => {
    const v1 = makeV1Project();
    delete (v1 as Record<string, unknown>).createdAt;
    delete (v1 as Record<string, unknown>).updatedAt;
    const result = migrateProjectEnvelope(v1);
    const envelope = result.data as Record<string, unknown>;
    const projectData = envelope.project as Record<string, unknown>;
    expect(projectData.createdAt).toBe("1970-01-01T00:00:00.000Z");
    expect(projectData.updatedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("recoveries are deterministic — same input produces same timestamps", () => {
    const noTs = makeV1Project();
    delete (noTs as Record<string, unknown>).createdAt;
    delete (noTs as Record<string, unknown>).updatedAt;
    const result1 = migrateProjectEnvelope(noTs);
    const result2 = migrateProjectEnvelope(noTs);
    const p1 = (result1.data as Record<string, unknown>).project as Record<string, unknown>;
    const p2 = (result2.data as Record<string, unknown>).project as Record<string, unknown>;
    expect(p1.createdAt).toBe(p2.createdAt);
    expect(p1.updatedAt).toBe(p2.updatedAt);
  });

  it("does not mutate the input project", () => {
    const v1 = makeV1Project();
    const before = JSON.stringify(v1);
    migrateProjectEnvelope(v1);
    expect(JSON.stringify(v1)).toBe(before);
  });
});

describe("Migrate — sequential application", () => {
  it("reports applied migration list", () => {
    const v1 = makeV1Project();
    const result = migrateProjectEnvelope(v1);
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied[0]).toBe("v1→v2");
  });
});
