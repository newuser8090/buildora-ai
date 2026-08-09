// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — exporter tests
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import JSZip from "jszip";
import { describe, it, expect } from "vitest";
import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import type { Project } from "@/types/project";
import { exportTemplatePackage, sanitizeTemplatePackageFilename } from "../services/template-package-exporter";
import { BUILDORA_TEMPLATE_EXTENSION } from "../constants";

// 1x1 transparent PNG — real magic bytes so the importer round-trip passes.
const PNG_A =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_B =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const NOW = "2026-08-09T00:00:00.000Z";

function makeProject(assets: Project["assets"]): Project {
  return {
    id: "proj-x",
    name: "Portfolio Base",
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
    assets,
    pages: [
      {
        id: "p1", title: "Home", slug: "/",
        sections: [
          {
            id: "s1", type: "hero", order: 1, visible: true,
            props: {
              headline: "Hello",
              heroImage: assets.length > 0 ? { assetId: assets[0].id, altText: "hero" } : undefined,
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeAsset(id: string, dataUrl: string, overrides?: Partial<Project["assets"][number]>): Project["assets"][number] {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    mimeType: "image/png",
    extension: ".png",
    size: 68,
    source: { type: "data-url", value: dataUrl },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRecord(project: Project): PersonalTemplateRecord {
  return {
    id: "personal-1",
    name: "My / Portfolio?",
    description: "A clean portfolio start",
    category: "portfolio",
    tags: ["portfolio"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "personal",
    project,
  };
}

async function extractZip(blob: Blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const entries: Record<string, string | Uint8Array> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    entries[name] = name.endsWith(".json")
      ? await entry.async("string")
      : new Uint8Array(await entry.async("uint8array"));
  }
  return entries;
}

describe("exportTemplatePackage", () => {
  it("exports a valid package with manifest, payload, and referenced asset only", async () => {
    const referenced = makeAsset("asset-a", PNG_A);
    const unreferenced = makeAsset("asset-b", PNG_B);
    const record = makeRecord(makeProject([referenced, unreferenced]));

    const result = await exportTemplatePackage({ record, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.filename).toBe(`my-portfolio${BUILDORA_TEMPLATE_EXTENSION}`);
    expect(result.manifest.assetCount).toBe(1);
    expect(result.manifest.assets[0].assetId).toBe("asset-a");

    const entries = await extractZip(result.blob);
    const names = Object.keys(entries).sort();
    expect(names).toEqual(["assets/asset-0001.png", "manifest.json", "template.json"]);

    const manifest = JSON.parse(entries["manifest.json"] as string);
    expect(manifest.format).toBe("buildora-template");
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.packageType).toBe("template");
    expect(manifest.assets).toHaveLength(1);

    const payload = JSON.parse(entries["template.json"] as string);
    // Asset sources are externalized to package paths (no data URLs in JSON).
    expect(payload.project.assets).toHaveLength(1);
    expect(payload.project.assets[0].source.value).toBe("assets/asset-0001.png");
    expect(payload.project.assets[0].source.value).not.toContain("data:");
    // The unreferenced asset is absent entirely.
    expect(payload.project.assets.find((a: { id: string }) => a.id === "asset-b")).toBeUndefined();
    // Section refs intact.
    expect(payload.project.pages[0].sections[0].props.heroImage.assetId).toBe("asset-a");
  });

  it("deduplicates identical asset content into one package file", async () => {
    const a = makeAsset("asset-a", PNG_A);
    const b = makeAsset("asset-b", PNG_A, { name: "copy.png" }); // same content
    const record = makeRecord(makeProject([a, b]));
    // Both assets must be referenced to be packaged.
    record.project.pages[0].sections[0].props.backgroundImage = {
      assetId: "asset-b",
      altText: "bg",
    };

    const result = await exportTemplatePackage({ record, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.assetCount).toBe(2);
    const paths = new Set(result.manifest.assets.map((e) => e.path));
    expect(paths.size).toBe(1);

    const entries = await extractZip(result.blob);
    expect(Object.keys(entries).filter((n) => n.startsWith("assets/"))).toHaveLength(1);
    const payload = JSON.parse(entries["template.json"] as string);
    expect(payload.project.assets[0].source.value).toBe("assets/asset-0001.png");
    expect(payload.project.assets[1].source.value).toBe("assets/asset-0001.png");
  });

  it("is deterministic for identical input and injected clock", async () => {
    const record = makeRecord(makeProject([makeAsset("asset-a", PNG_A)]));
    const first = await exportTemplatePackage({ record, now: NOW });
    const second = await exportTemplatePackage({ record, now: NOW });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const a = await extractZip(first.blob);
    const b = await extractZip(second.blob);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    for (const key of Object.keys(a)) {
      if (typeof a[key] === "string" && typeof b[key] === "string") {
        expect(a[key] as string).toBe(b[key] as string);
      } else {
        expect(Buffer.from(a[key] as Uint8Array).equals(Buffer.from(b[key] as Uint8Array))).toBe(true);
      }
    }
  });

  it("never leaks private runtime state into the package", async () => {
    const record = makeRecord(makeProject([makeAsset("asset-a", PNG_A)]));
    // Simulate private state that must NEVER be exported (it lives outside the
    // record in the real app; this proves the exporter cannot dump it).
    const contaminated = record as PersonalTemplateRecord & {
      shareTokens: string[];
      copilotMemory: unknown;
      deploymentRecords: unknown;
      recoverySnapshots: unknown;
      cloudSyncQueue: unknown;
    };
    contaminated.shareTokens = ["tok-abc123"];
    contaminated.copilotMemory = { conversations: ["secret"] };
    contaminated.deploymentRecords = [{ url: "https://secret.example" }];
    contaminated.recoverySnapshots = ["snapshot-1"];
    contaminated.cloudSyncQueue = [{ entity: "x" }];

    const result = await exportTemplatePackage({ record: contaminated, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = await extractZip(result.blob);
    const allText = Object.entries(entries)
      .filter(([, v]) => typeof v === "string")
      .map(([, v]) => v as string)
      .join("\n");
    expect(allText).not.toContain("tok-abc123");
    expect(allText).not.toContain("secret");
    expect(allText).not.toContain("recoverySnapshot");
    expect(allText).not.toContain("cloudSync");
    expect(allText).not.toContain("copilot");
    // Only the three canonical files + the single asset.
    expect(Object.keys(entries).sort()).toEqual(["assets/asset-0001.png", "manifest.json", "template.json"]);
  });

  it("rejects assets larger than the package cap", async () => {
    const bigBase64 = "A".repeat(7_000_000); // ~5.25 MB decoded
    const big = makeAsset("asset-big", `data:image/png;base64,${bigBase64}`);
    const record = makeRecord(makeProject([big]));

    const result = await exportTemplatePackage({ record, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXPORT_FAILED");
  });

  it("rejects an invalid stored project", async () => {
    const record = makeRecord(makeProject([makeAsset("asset-a", PNG_A)]));
    record.project.pages[0].sections[0].props = "not-an-object" as unknown as Record<string, unknown>;
    const result = await exportTemplatePackage({ record, now: NOW });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EXPORT_FAILED");
  });
});

describe("sanitizeTemplatePackageFilename", () => {
  it("sanitizes and appends the extension exactly once", () => {
    expect(sanitizeTemplatePackageFilename("My / Portfolio?")).toBe(`my-portfolio${BUILDORA_TEMPLATE_EXTENSION}`);
    expect(sanitizeTemplatePackageFilename("Hello World")).toBe(`hello-world${BUILDORA_TEMPLATE_EXTENSION}`);
    expect(sanitizeTemplatePackageFilename("")).toBe(`buildora-template${BUILDORA_TEMPLATE_EXTENSION}`);
  });
});
