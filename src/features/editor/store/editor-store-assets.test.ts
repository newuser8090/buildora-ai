import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import type { Project } from "@/types/project";
import type { Asset, AssetType } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: overrides?.id ?? "asset-test-1",
    name: overrides?.name ?? "test.png",
    type: (overrides?.type ?? "image") as AssetType,
    mimeType: overrides?.mimeType ?? "image/png",
    extension: overrides?.extension ?? ".png",
    size: overrides?.size ?? 1024,
    source: overrides?.source ?? { type: "data-url", value: "data:image/png;base64,abc" },
    createdAt: overrides?.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "test-proj",
    name: "Test",
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
        id: "page-1", title: "Home", slug: "/",
        sections: [
          {
            id: "s-hero", type: "hero", order: 1, visible: true,
            props: {
              headline: "Hello", subheadline: "",
              primaryCta: { text: "Start", href: "#" },
              heroImage: { assetId: "asset-used" },
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function resetStore(project?: Project) {
  const p = project ?? makeProject();
  useEditorStore.setState({
    project: p,
    selectedSectionId: null,
    selectedPageId: "page-1",
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: { past: [], present: JSON.parse(JSON.stringify(p)), future: [] },
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests: getAsset
// ---------------------------------------------------------------------------

describe("EditorStore — getAsset", () => {
  beforeEach(() => {
    const project = makeProject({
      assets: [makeAsset({ id: "asset-1", name: "logo.png" })],
    });
    resetStore(project);
  });

  it("returns the asset by ID", () => {
    const asset = useEditorStore.getState().getAsset("asset-1");
    expect(asset).toBeDefined();
    expect(asset!.name).toBe("logo.png");
  });

  it("returns undefined for non-existent asset", () => {
    const asset = useEditorStore.getState().getAsset("nonexistent");
    expect(asset).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: addAsset
// ---------------------------------------------------------------------------

describe("EditorStore — addAsset", () => {
  beforeEach(() => resetStore());

  it("adds an asset to the project", () => {
    const asset = makeAsset({ id: "asset-new" });
    useEditorStore.getState().addAsset(asset);

    const project = useEditorStore.getState().project;
    expect(project.assets).toHaveLength(1);
    expect(project.assets[0].id).toBe("asset-new");
  });

  it("creates one history entry", () => {
    const asset = makeAsset({ id: "asset-new" });
    useEditorStore.getState().addAsset(asset);

    expect(useEditorStore.getState().history.past.length).toBe(1);
  });

  it("addAsset → undo removes asset", () => {
    const asset = makeAsset({ id: "asset-new" });
    useEditorStore.getState().addAsset(asset);
    useEditorStore.getState().undo();

    expect(useEditorStore.getState().project.assets).toHaveLength(0);
  });

  it("addAsset → undo → redo restores asset", () => {
    const asset = makeAsset({ id: "asset-new" });
    useEditorStore.getState().addAsset(asset);
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();

    expect(useEditorStore.getState().project.assets).toHaveLength(1);
    expect(useEditorStore.getState().project.assets[0].id).toBe("asset-new");
  });
});

// ---------------------------------------------------------------------------
// Tests: removeAsset
// ---------------------------------------------------------------------------

describe("EditorStore — removeAsset", () => {
  beforeEach(() => {
    const project = makeProject({
      assets: [makeAsset({ id: "asset-unused" })],
    });
    resetStore(project);
  });

  it("removes an unused asset", () => {
    useEditorStore.getState().removeAsset("asset-unused");

    expect(useEditorStore.getState().project.assets).toHaveLength(0);
  });

  it("creates one history entry", () => {
    useEditorStore.getState().removeAsset("asset-unused");

    expect(useEditorStore.getState().history.past.length).toBe(1);
  });

  it("removes an asset and clears references by default", () => {
    const project = makeProject({
      assets: [
        makeAsset({ id: "asset-used" }),
        makeAsset({ id: "asset-unused" }),
      ],
    });
    resetStore(project);

    useEditorStore.getState().removeAsset("asset-used");

    expect(useEditorStore.getState().project.assets).toHaveLength(1);
    expect(useEditorStore.getState().project.assets[0].id).toBe("asset-unused");

    // Hero's heroImage reference should be cleared
    const heroSection = useEditorStore.getState().project.pages[0].sections[0];
    expect(heroSection.props.heroImage).toBeUndefined();
  });

  it("removeAsset → undo restores asset and references", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "asset-used" })],
    });
    resetStore(project);

    useEditorStore.getState().removeAsset("asset-used");
    expect(useEditorStore.getState().project.assets).toHaveLength(0);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.assets).toHaveLength(1);
    const heroSection = useEditorStore.getState().project.pages[0].sections[0];
    expect(heroSection.props.heroImage).toBeDefined();
    expect((heroSection.props.heroImage as { assetId: string }).assetId).toBe("asset-used");
  });
});

// ---------------------------------------------------------------------------
// Tests: replaceAsset
// ---------------------------------------------------------------------------

describe("EditorStore — replaceAsset", () => {
  beforeEach(() => {
    const original = makeAsset({
      id: "asset-orig",
      name: "original.png",
      mimeType: "image/png",
      extension: ".png",
      size: 1000,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const project = makeProject({ assets: [original] });
    resetStore(project);
  });

  it("preserves the original asset ID", () => {
    const replacement = makeAsset({
      id: "replacement-id", // should be overridden
      name: "new.png",
      mimeType: "image/webp",
      extension: ".webp",
      size: 2000,
    });
    useEditorStore.getState().replaceAsset("asset-orig", replacement);

    const asset = useEditorStore.getState().project.assets[0];
    expect(asset.id).toBe("asset-orig");
  });

  it("preserves the original createdAt timestamp", () => {
    const replacement = makeAsset({ name: "new.png" });
    useEditorStore.getState().replaceAsset("asset-orig", replacement);

    const asset = useEditorStore.getState().project.assets[0];
    expect(asset.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("updates metadata from replacement", () => {
    const replacement = makeAsset({
      name: "new.png",
      mimeType: "image/webp",
      extension: ".webp",
      size: 2000,
    });
    useEditorStore.getState().replaceAsset("asset-orig", replacement);

    const asset = useEditorStore.getState().project.assets[0];
    expect(asset.name).toBe("new.png");
    expect(asset.mimeType).toBe("image/webp");
    expect(asset.extension).toBe(".webp");
    expect(asset.size).toBe(2000);
  });

  it("section references are preserved (ID unchanged)", () => {
    const project = makeProject({
      assets: [makeAsset({ id: "asset-used" })],
    });
    resetStore(project);

    const replacement = makeAsset({ id: "replacement", name: "new.png" });
    useEditorStore.getState().replaceAsset("asset-used", replacement);

    // Hero reference should still point to the same asset ID
    const heroSection = useEditorStore.getState().project.pages[0].sections[0];
    expect(heroSection.props.heroImage).toBeDefined();
    expect((heroSection.props.heroImage as { assetId: string }).assetId).toBe("asset-used");
  });

  it("replaceAsset → undo restores original values", () => {
    const replacement = makeAsset({ name: "new.png", mimeType: "image/webp" });
    useEditorStore.getState().replaceAsset("asset-orig", replacement);
    useEditorStore.getState().undo();

    const asset = useEditorStore.getState().project.assets[0];
    expect(asset.name).toBe("original.png");
    expect(asset.mimeType).toBe("image/png");
  });
});

// ---------------------------------------------------------------------------
// Tests: renameAsset
// ---------------------------------------------------------------------------

describe("EditorStore — renameAsset", () => {
  beforeEach(() => {
    const project = makeProject({
      assets: [makeAsset({ id: "asset-r", name: "old.png" })],
    });
    resetStore(project);
  });

  it("renames an asset", () => {
    const result = useEditorStore.getState().renameAsset("asset-r", "new.png");
    expect(result.success).toBe(true);

    const asset = useEditorStore.getState().project.assets[0];
    expect(asset.name).toBe("new.png");
  });

  it("creates one history entry", () => {
    useEditorStore.getState().renameAsset("asset-r", "new.png");
    expect(useEditorStore.getState().history.past.length).toBe(1);
  });

  it("rejects empty name", () => {
    const result = useEditorStore.getState().renameAsset("asset-r", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("rejects whitespace-only name", () => {
    const result = useEditorStore.getState().renameAsset("asset-r", "   ");
    expect(result.success).toBe(false);
  });

  it("rejects non-string name", () => {
    const result = useEditorStore.getState().renameAsset("asset-r", null as unknown as string);
    expect(result.success).toBe(false);
  });

  it("accepts same extension rename", () => {
    const result = useEditorStore.getState().renameAsset("asset-r", "new-name.png");
    expect(result.success).toBe(true);
  });

  it("rejects extension that conflicts with MIME type", () => {
    // asset-r is image/png, .png extension
    const result = useEditorStore.getState().renameAsset("asset-r", "new.jpg");
    expect(result.success).toBe(false);
    expect(result.error).toContain("jpg");
  });

  it("renameAsset → undo → redo", () => {
    useEditorStore.getState().renameAsset("asset-r", "new.png");
    useEditorStore.getState().undo();

    expect(useEditorStore.getState().project.assets[0].name).toBe("old.png");

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().project.assets[0].name).toBe("new.png");
  });
});

// ---------------------------------------------------------------------------
// Tests: sequential operations
// ---------------------------------------------------------------------------

describe("EditorStore — sequential asset operations", () => {
  beforeEach(() => resetStore());

  it("adding multiple assets creates multiple history entries", () => {
    useEditorStore.getState().addAsset(makeAsset({ id: "a1", name: "a1.png" }));
    useEditorStore.getState().addAsset(makeAsset({ id: "a2", name: "a2.png" }));
    useEditorStore.getState().addAsset(makeAsset({ id: "a3", name: "a3.png" }));

    expect(useEditorStore.getState().project.assets).toHaveLength(3);
    expect(useEditorStore.getState().history.past.length).toBe(3);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.assets).toHaveLength(2);
  });

  it("edit sessions remain unaffected by asset operations (asset ops create their own entries)", () => {
    useEditorStore.getState().beginEditSession();
    useEditorStore.getState().updateSectionProps("s-hero", { headline: "Changed" });
    useEditorStore.getState().addAsset(makeAsset({ id: "a1" }));
    useEditorStore.getState().commitEditSession();

    // The section edit was in the edit session (no history entry yet).
    // addAsset creates its own history entry (it uses withHistory directly).
    // commitEditSession creates another entry for the edit session changes.
    // Total: 2 entries — one for addAsset, one for commitEditSession.
    expect(useEditorStore.getState().history.past.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Tests: backwards compatibility
// ---------------------------------------------------------------------------

describe("EditorStore — backwards compatibility", () => {
  it("setProject with no assets field normalizes to empty array", () => {
    const project = makeProject();
    // Simulate legacy project without assets
    delete (project as unknown as Record<string, unknown>).assets;

    // initProject should normalize it
    useEditorStore.getState().initProject(project as unknown as Project);
    expect(Array.isArray(useEditorStore.getState().project.assets)).toBe(true);
    expect(useEditorStore.getState().project.assets).toHaveLength(0);
  });

  it("section data without asset fields works correctly", () => {
    const project = makeProject();
    // Remove heroImage from hero section — simulate old project
    delete project.pages[0].sections[0].props.heroImage;

    useEditorStore.getState().initProject(project);
    // Should not crash, heroImage should be undefined
    const section = useEditorStore.getState().project.pages[0].sections[0];
    expect(section.props.heroImage).toBeUndefined();
  });
});
