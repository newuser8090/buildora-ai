// ---------------------------------------------------------------------------
// Editor store — site settings mutations (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./editor-store";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import type { Project } from "@/types/project";

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "test-proj",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
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
          { id: "hero-1", type: "hero", order: 1, visible: true, props: {}, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function init(overrides?: Partial<Project>) {
  useEditorStore.getState().initProject(makeProject(overrides));
}

beforeEach(() => {
  init();
});

describe("updateSiteSettings", () => {
  it("stores trimmed site settings on the project", () => {
    const result = useEditorStore
      .getState()
      .updateSiteSettings({ siteName: "  My Site  ", siteDescription: "  A great site  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    const settings = useEditorStore.getState().project.siteSettings;
    expect(settings).toEqual({
      siteName: "My Site",
      siteDescription: "A great site",
    });
  });

  it("merges patches over existing settings", () => {
    useEditorStore.getState().updateSiteSettings({ siteName: "My Site" });
    useEditorStore.getState().updateSiteSettings({ language: "fr" });
    const settings = useEditorStore.getState().project.siteSettings;
    expect(settings).toEqual({ siteName: "My Site", language: "fr" });
  });

  it("keeps the project schema-valid", () => {
    useEditorStore.getState().updateSiteSettings({
      siteName: "My Site",
      seo: { title: "Google Title", description: "Desc", robotsIndex: true },
      social: { title: "Share", image: { assetId: "a1" } },
      appearance: { themeColor: "#123456" },
    });
    const validation = ProjectSchema.safeParse(useEditorStore.getState().project);
    expect(validation.success).toBe(true);
  });

  it("creates one history entry; undo and redo round-trip", () => {
    useEditorStore.getState().updateSiteSettings({ siteName: "My Site" });
    expect(useEditorStore.getState().history.past).toHaveLength(1);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.siteSettings).toBeUndefined();

    useEditorStore.getState().redo();
    expect(useEditorStore.getState().project.siteSettings?.siteName).toBe("My Site");
  });

  it("is a no-op when nothing changed", () => {
    useEditorStore.getState().updateSiteSettings({ siteName: "My Site" });
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().updateSiteSettings({ siteName: "My Site" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("drops empty strings during sanitization", () => {
    useEditorStore.getState().updateSiteSettings({ siteName: "My Site" });
    useEditorStore.getState().updateSiteSettings({
      siteName: "My Site",
      siteDescription: "   ",
      language: "",
    });
    const settings = useEditorStore.getState().project.siteSettings;
    expect(settings).toEqual({ siteName: "My Site" });
  });

  it("removes siteSettings entirely when siteName is cleared", () => {
    useEditorStore.getState().updateSiteSettings({ siteName: "My Site" });
    const result = useEditorStore.getState().updateSiteSettings({ siteName: "" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(useEditorStore.getState().project.siteSettings).toBeUndefined();
  });
});
