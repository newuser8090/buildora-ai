// ---------------------------------------------------------------------------
// Template Packages (Phase P13) — importer tests
//
// Covers: valid round trip, version/type compatibility, every hostile archive
// and payload case, no-partial-install, name conflicts, fresh identity, and
// project independence.
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import "fake-indexeddb/auto";

import JSZip from "jszip";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PersonalTemplateRecord } from "@/features/personal-templates/types";
import type { Project } from "@/types/project";
import {
  buildTemplateImportPreview,
  installImportedTemplate,
  readTemplatePackageFile,
} from "../services/template-package-importer";
import { exportTemplatePackage } from "../services/template-package-exporter";
import {
  setPersonalTemplateServiceForTests,
  getPersonalTemplateService,
} from "@/features/personal-templates/services/personal-template-service";
import { setPersonalTemplateStorageForTests } from "@/features/personal-templates/storage/personal-template-storage";

// 1x1 transparent PNG — real magic bytes.
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const NOW = "2026-08-09T00:00:00.000Z";

function makeAssetSource(dataUrl: string) {
  return {
    id: "asset-a",
    name: "hero.png",
    type: "image" as const,
    mimeType: "image/png",
    extension: ".png",
    size: 68,
    source: { type: "data-url" as const, value: dataUrl },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeProject(assets: Project["assets"] = []): Project {
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

function makeRecord(): PersonalTemplateRecord {
  return {
    id: "personal-1",
    name: "Portfolio",
    description: "A clean portfolio start",
    category: "portfolio",
    tags: ["portfolio", "starter"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "personal",
    project: makeProject([makeAssetSource(PNG_DATA_URL)]),
  };
}

beforeEach(() => {
  setPersonalTemplateServiceForTests(null);
  setPersonalTemplateStorageForTests(null);
});

afterEach(() => {
  setPersonalTemplateServiceForTests(null);
  setPersonalTemplateStorageForTests(null);
});

// ---------------------------------------------------------------------------
// Package construction helpers
// ---------------------------------------------------------------------------

async function exportToFile(record: PersonalTemplateRecord): Promise<File> {
  const result = await exportTemplatePackage({ record, now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("fixture export failed");
  return new File([result.blob], "portable.buildora-template");
}

/** Build a raw package from explicit manifest/payload/files (hostile fixtures). */
async function rawPackage(input: {
  manifest: unknown;
  payload: unknown;
  files?: Record<string, string | Uint8Array>;
  omitManifest?: boolean;
  omitPayload?: boolean;
  extraEntries?: Record<string, string | Uint8Array>;
  name?: string;
}): Promise<File> {
  const zip = new JSZip();
  if (!input.omitManifest) zip.file("manifest.json", JSON.stringify(input.manifest, null, 2));
  if (!input.omitPayload) zip.file("template.json", JSON.stringify(input.payload, null, 2));
  for (const [path, content] of Object.entries(input.files ?? {})) zip.file(path, content);
  for (const [path, content] of Object.entries(input.extraEntries ?? {})) zip.file(path, content);
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], input.name ?? "hostile.buildora-template");
}

async function mutatePackage(
  file: File,
  mutate: (zip: InstanceType<typeof JSZip>) => void | Promise<void>,
): Promise<File> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  await mutate(zip);
  const blob = await zip.generateAsync({ type: "blob" });
  return new File([blob], file.name);
}

// Node-realm bytes (Buffer) — jsdom's TextEncoder yields cross-realm Uint8Array
// instances that fail JSZip's instanceof checks.
function utf8Bytes(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "utf8"));
}

// ---------------------------------------------------------------------------
// Valid round trip
// ---------------------------------------------------------------------------

describe("valid package round trip", () => {
  it("restores metadata, assets, provenance, and fresh identity", async () => {
    const file = await exportToFile(makeRecord());
    const result = await buildTemplateImportPreview(file, [], { id: "personal-imported", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.preview.name).toBe("Portfolio");
    expect(result.preview.pageCount).toBe(1);
    expect(result.preview.sectionCount).toBe(1);
    expect(result.preview.assetCount).toBe(1);
    expect(result.preview.formatVersion).toBe(1);
    expect(result.preview.packageSizeBytes).toBe(file.size);

    const record = result.record;
    expect(record.id).toBe("personal-imported");
    expect(record.name).toBe("Portfolio");
    expect(record.description).toBe("A clean portfolio start");
    expect(record.category).toBe("portfolio");
    expect(record.tags).toEqual(["portfolio", "starter"]);
    expect(record.createdAt).toBe(NOW);
    expect(record.updatedAt).toBe(NOW);
    expect(record.provenance).toEqual({
      source: "import",
      packageFormatVersion: 1,
      exportedAt: NOW,
      originalName: "Portfolio",
    });

    // Asset data URL restored and byte-identical to the original.
    const restored = record.project.assets[0];
    expect(restored.id).toBe("asset-a");
    expect(restored.source.type).toBe("data-url");
    expect(restored.source.value.startsWith("data:image/png;base64,")).toBe(true);
    expect(restored.source.value).toBe(PNG_DATA_URL);
    // Section reference preserved.
    expect(
      (record.project.pages[0].sections[0].props.heroImage as { assetId: string }).assetId,
    ).toBe("asset-a");
  });

  it("resolves name conflicts with the (2), (3) strategy and warns", async () => {
    const file = await exportToFile(makeRecord());
    const result = await buildTemplateImportPreview(file, ["Portfolio", "Portfolio (2)"], {
      id: "personal-2",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.name).toBe("Portfolio (3)");
    expect(result.preview.warnings.some((w) => w.includes("Portfolio (3)"))).toBe(true);
  });

  it("deduplicated assets restore per-asset data URLs", async () => {
    const record = makeRecord();
    record.project.assets = [
      makeAssetSource(PNG_DATA_URL),
      { ...makeAssetSource(PNG_DATA_URL), id: "asset-b", name: "copy.png" },
    ];
    // Both assets referenced so both are packaged.
    record.project.pages[0].sections[0].props.backgroundImage = {
      assetId: "asset-b",
      altText: "bg",
    };
    const file = await exportToFile(record);
    const result = await buildTemplateImportPreview(file, [], { id: "personal-3", now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.project.assets).toHaveLength(2);
    expect(result.record.project.assets[0].source.value).toBe(PNG_DATA_URL);
    expect(result.record.project.assets[1].source.value).toBe(PNG_DATA_URL);
    expect(result.preview.warnings.some((w) => w.includes("combined"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// File-level rejection
// ---------------------------------------------------------------------------

describe("file-level validation", () => {
  it("accepts any non-empty in-limit file at the read boundary (content decides later)", async () => {
    // Regression guard for the E2E finding: filenames may lose their extension
    // in transit (download managers, email). The read boundary only enforces
    // size/readability — archive + manifest + payload content is authoritative.
    const file = new File(["x"], "evil.zip");
    const result = await readTemplatePackageFile(file);
    expect(result.ok).toBe(true);
  });

  it("imports a valid package even when its filename lost the extension", async () => {
    const file = await exportToFile(makeRecord());
    const renamed = new File([await file.arrayBuffer()], "portable-template");
    const result = await buildTemplateImportPreview(renamed, [], {
      id: "personal-renamed",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.name).toBe("Portfolio");
    expect(result.record.project.assets[0].source.value).toBe(PNG_DATA_URL);
  });

  it("rejects an empty file", async () => {
    const file = new File([], "empty.buildora-template");
    const result = await readTemplatePackageFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ARCHIVE_INVALID");
  });

  it("rejects an oversized file", async () => {
    const file = new File([new Uint8Array(26 * 1024 * 1024)], "big.buildora-template");
    const result = await readTemplatePackageFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PACKAGE_TOO_LARGE");
  });
});

// ---------------------------------------------------------------------------
// Archive-level rejection
// ---------------------------------------------------------------------------

describe("archive-level rejection", () => {
  it("rejects a non-package file regardless of its name", async () => {
    // Names are never trusted alone — a wrong extension, no extension, or even
    // a fake `.buildora-template` name must all fail on content.
    for (const name of ["evil.zip", "notes.txt", "fake.buildora-template"]) {
      const file = new File(["this is not a zip archive at all"], name);
      const result = await buildTemplateImportPreview(file, []);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("ARCHIVE_INVALID");
    }
  });

  it("rejects traversal paths (../)", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      zip.file("../evil.js", "alert(1)");
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ARCHIVE_ENTRY_UNSAFE");
  });

  it("rejects absolute and drive-letter paths", async () => {
    for (const path of ["/etc/passwd", "C:/Windows/system32/x", "assets/../../../evil"]) {
      const file = await exportToFile(makeRecord());
      const hostile = await mutatePackage(file, (zip) => {
        zip.file(path, "x");
      });
      const result = await buildTemplateImportPreview(hostile, []);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(["ARCHIVE_ENTRY_UNSAFE", "ARCHIVE_INVALID"]).toContain(result.error.code);
    }
  });

  it("rejects too many entries", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      for (let i = 0; i < 2001; i++) {
        zip.file(`assets/zz-${String(i).padStart(4, "0")}.png`, new Uint8Array(4));
      }
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ARCHIVE_TOO_MANY_FILES");
  });

  it("rejects orphan entries not listed in the manifest", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      zip.file("assets/asset-9999.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ARCHIVE_ENTRY_UNSAFE");
  });
});

// ---------------------------------------------------------------------------
// Manifest / version rejection
// ---------------------------------------------------------------------------

describe("manifest and version rejection", () => {
  it("rejects a missing manifest", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      zip.remove("manifest.json");
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MANIFEST_MISSING");
  });

  it("rejects a malformed manifest JSON", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      zip.file("manifest.json", "{not json");
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MANIFEST_INVALID");
  });

  it("rejects a wrong format marker", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      zip.file("manifest.json", JSON.stringify({ ...manifest, format: "something-else" }));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MANIFEST_INVALID");
  });

  it("rejects a newer format version without parsing the payload", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      zip.file("manifest.json", JSON.stringify({ ...manifest, formatVersion: 99 }));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("FORMAT_TOO_NEW");
  });

  it("rejects the wrong package type", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      zip.file("manifest.json", JSON.stringify({ ...manifest, packageType: "project" }));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("WRONG_PACKAGE_TYPE");
  });

  it("rejects manifest prototype-pollution keys", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      // Inject via string surgery — `{ __proto__: … }` in an object literal
      // would set the prototype instead of creating an own key.
      const text = await zip.file("manifest.json")!.async("string");
      zip.file("manifest.json", text.replace(/\}\s*$/, ',"__proto__":{"pollute":true}}'));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MANIFEST_INVALID");
  });
});

// ---------------------------------------------------------------------------
// Payload rejection
// ---------------------------------------------------------------------------

describe("payload rejection", () => {
  it("rejects a missing payload", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      zip.remove("template.json");
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPLATE_INVALID");
  });

  it("rejects malformed payload JSON", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, (zip) => {
      zip.file("template.json", "{{{{");
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPLATE_INVALID");
  });

  it("rejects payload prototype-pollution keys", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const payload = JSON.parse(await zip.file("template.json")!.async("string"));
      zip.file("template.json", JSON.stringify({ ...payload, constructor: { evil: true } }));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPLATE_INVALID");
  });

  it("rejects unsafe javascript: URLs in content", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const payload = JSON.parse(await zip.file("template.json")!.async("string"));
      payload.project.pages[0].sections[0].props.ctaHref = "javascript:alert(1)";
      zip.file("template.json", JSON.stringify(payload));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPLATE_INVALID");
  });

  it("rejects vbscript: and data:text/html URLs", async () => {
    for (const evil of ["vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>"]) {
      const file = await exportToFile(makeRecord());
      const hostile = await mutatePackage(file, async (zip) => {
        const payload = JSON.parse(await zip.file("template.json")!.async("string"));
        payload.project.pages[0].sections[0].props.link = evil;
        zip.file("template.json", JSON.stringify(payload));
      });
      const result = await buildTemplateImportPreview(hostile, []);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe("TEMPLATE_INVALID");
    }
  });

  it("rejects a whitespace-only template name", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const payload = JSON.parse(await zip.file("template.json")!.async("string"));
      payload.template.name = "   ";
      zip.file("template.json", JSON.stringify(payload));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TEMPLATE_INVALID");
  });

  it("rejects a project asset whose source is not a packaged path", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const payload = JSON.parse(await zip.file("template.json")!.async("string"));
      payload.project.assets[0].source.value = "assets/asset-0002.png";
      zip.file("template.json", JSON.stringify(payload));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ASSET_MISSING");
  });
});

// ---------------------------------------------------------------------------
// Asset rejection
// ---------------------------------------------------------------------------

describe("asset rejection", () => {
  it("rejects a manifest path missing from the archive", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      const payload = JSON.parse(await zip.file("template.json")!.async("string"));
      payload.project.assets[0].source.value = "assets/asset-0002.png";
      manifest.assets.push({ ...manifest.assets[0], path: "assets/asset-0002.png" });
      manifest.assetCount += 1;
      manifest.totalAssetBytes += manifest.assets[0].size;
      zip.file("manifest.json", JSON.stringify(manifest));
      zip.file("template.json", JSON.stringify(payload));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ASSET_MISSING");
  });

  it("rejects an asset size mismatch", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      manifest.assets[0].size += 100;
      manifest.totalAssetBytes += 100;
      zip.file("manifest.json", JSON.stringify(manifest));
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ASSET_INVALID");
  });

  it("rejects an HTML payload disguised as a PNG", async () => {
    const file = await exportToFile(makeRecord());
    const hostile = await mutatePackage(file, async (zip) => {
      const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
      const payload = JSON.parse(await zip.file("template.json")!.async("string"));
      const html = "<html><script>alert(1)</script></html>";
      const bytes = utf8Bytes(html);
      manifest.assets[0].size = bytes.length;
      manifest.totalAssetBytes = bytes.length;
      payload.project.assets[0].size = bytes.length;
      zip.file("manifest.json", JSON.stringify(manifest));
      zip.file("template.json", JSON.stringify(payload));
      zip.file("assets/asset-0001.png", bytes);
    });
    const result = await buildTemplateImportPreview(hostile, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ASSET_INVALID");
  });

  it("rejects an SVG containing a script", async () => {
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
    const bytes = utf8Bytes(svg);
    const manifest = {
      format: "buildora-template",
      formatVersion: 1,
      packageType: "template",
      exportedAt: NOW,
      assetCount: 1,
      totalAssetBytes: bytes.length,
      assets: [
        {
          path: "assets/asset-0001.svg",
          assetId: "asset-svg",
          name: "evil.svg",
          mimeType: "image/svg+xml",
          extension: ".svg",
          size: bytes.length,
        },
      ],
    };
    const payload = {
      template: {
        name: "Evil",
        description: "",
        category: "personal",
        tags: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      project: makeProject([
        {
          id: "asset-svg",
          name: "evil.svg",
          type: "image",
          mimeType: "image/svg+xml",
          extension: ".svg",
          size: bytes.length,
          source: { type: "data-url", value: "assets/asset-0001.svg" },
          createdAt: NOW,
        },
      ]),
    };
    const file = await rawPackage({ manifest, payload, files: { "assets/asset-0001.svg": bytes } });
    const result = await buildTemplateImportPreview(file, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ASSET_INVALID");
  });

  it("rejects a spoofed MIME claim (PNG magic bytes under an SVG name)", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const manifest = {
      format: "buildora-template",
      formatVersion: 1,
      packageType: "template",
      exportedAt: NOW,
      assetCount: 1,
      totalAssetBytes: pngBytes.length,
      assets: [
        {
          path: "assets/asset-0001.svg",
          assetId: "asset-svg",
          name: "fake.svg",
          mimeType: "image/svg+xml",
          extension: ".svg",
          size: pngBytes.length,
        },
      ],
    };
    const payload = {
      template: { name: "Spoof", description: "", category: "personal", tags: [], createdAt: NOW, updatedAt: NOW },
      project: makeProject([
        {
          id: "asset-svg",
          name: "fake.svg",
          type: "image",
          mimeType: "image/svg+xml",
          extension: ".svg",
          size: pngBytes.length,
          source: { type: "data-url", value: "assets/asset-0001.svg" },
          createdAt: NOW,
        },
      ]),
    };
    const file = await rawPackage({ manifest, payload, files: { "assets/asset-0001.svg": pngBytes } });
    const result = await buildTemplateImportPreview(file, []);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ASSET_INVALID");
  });
});

// ---------------------------------------------------------------------------
// Persistence: no partial install + independence
// ---------------------------------------------------------------------------

describe("persistence lifecycle", () => {
  it("failed imports never mutate persisted templates", async () => {
    const evil = new File(["not a zip"], "bad.buildora-template");
    const failed = await buildTemplateImportPreview(evil, []);
    expect(failed.ok).toBe(false);

    const list = await getPersonalTemplateService().listTemplates();
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.templates).toHaveLength(0);
  });

  it("install persists exactly one record through the canonical service", async () => {
    const file = await exportToFile(makeRecord());
    const preview = await buildTemplateImportPreview(file, [], { id: "personal-installed", now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const installed = await installImportedTemplate(preview.record);
    expect(installed.ok).toBe(true);

    const list = await getPersonalTemplateService().listTemplates();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.templates).toHaveLength(1);
    expect(list.templates[0].id).toBe("personal-installed");
    expect(list.templates[0].provenance?.source).toBe("import");
  });

  it("two projects from one imported template are fully independent", async () => {
    const file = await exportToFile(makeRecord());
    const preview = await buildTemplateImportPreview(file, [], { id: "personal-indep", now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    await installImportedTemplate(preview.record);

    const service = getPersonalTemplateService();
    const a = await service.createProjectFromPersonalTemplate("personal-indep", "Project A");
    const b = await service.createProjectFromPersonalTemplate("personal-indep", "Project B");
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Fresh project/page/section ids.
    expect(a.project.id).not.toBe(b.project.id);
    expect(a.project.pages[0].id).not.toBe(b.project.pages[0].id);
    expect(a.project.pages[0].sections[0].id).not.toBe(b.project.pages[0].sections[0].id);

    // Editing one project never mutates the other or the template.
    a.project.pages[0].sections[0].props.headline = "Changed";
    const stored = await service.getTemplate("personal-indep");
    expect(stored.ok && stored.template).toBeTruthy();
    if (!stored.ok || !stored.template) return;
    expect(stored.template.project.pages[0].sections[0].props.headline).toBe("Hello");
    expect(b.project.pages[0].sections[0].props.headline).toBe("Hello");
  });

  it("imported templates reuse the personal-template creation path (ids stay personal)", async () => {
    const file = await exportToFile(makeRecord());
    const preview = await buildTemplateImportPreview(file, [], { id: "personal-path", now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.record.id.startsWith("personal-")).toBe(true);
  });
});
