// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InspectorAssetField } from "@/features/assets/components/InspectorAssetField";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";
import type { Asset } from "@/features/assets/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: overrides?.id ?? "a1",
    name: overrides?.name ?? "logo.png",
    type: overrides?.type ?? "image",
    mimeType: overrides?.mimeType ?? "image/png",
    extension: overrides?.extension ?? ".png",
    size: 1024,
    source: { type: "data-url", value: "data:image/png;base64,iVBOR" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function setupStore() {
  const project: Project = {
    id: "proj-1",
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
    assets: [
      makeAsset({ id: "a1", name: "logo.png", type: "logo" }),
      makeAsset({ id: "a2", name: "hero.jpg", type: "image", width: 1200, height: 800 }),
    ],
    pages: [
      {
        id: "page-1", title: "Home", slug: "/",
        sections: [
          {
            id: "s-header", type: "header", order: 1, visible: true,
            props: { logoText: "Brand", navLinks: [] },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  useEditorStore.setState({
    project,
    selectedSectionId: null,
    selectedPageId: "page-1",
    viewport: "desktop",
    zoom: 100,
    isGenerating: false,
    generationProgress: 0,
    history: { past: [], present: JSON.parse(JSON.stringify(project)), future: [] },
    _editingSession: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InspectorAssetField — rendering", () => {
  beforeEach(() => setupStore());

  it("shows 'None selected' when no value", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("None selected")).toBeDefined();
  });

  it("shows asset name when an asset is referenced", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "a1" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("logo.png")).toBeDefined();
  });

  it("shows 'Missing' when referenced asset does not exist", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "nonexistent" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/Asset not found/i)).toBeDefined();
  });

  it("shows recommended dimensions hint when no asset selected", () => {
    render(
      <InspectorAssetField
        label="Hero image"
        value={undefined}
        onChange={() => {}}
        recommendedDimensions="1200×800px"
      />,
    );
    expect(screen.getByText("1200×800px")).toBeDefined();
  });

  it("shows Change button when asset is selected", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "a1" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Change")).toBeDefined();
  });

  it("shows Clear button when asset is selected", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "a1" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Clear")).toBeDefined();
  });

  it("shows Select button when no asset", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Select")).toBeDefined();
  });
});

describe("InspectorAssetField — interactions", () => {
  beforeEach(() => setupStore());

  it("calls onChange with undefined when Clear is clicked", () => {
    const onChange = vi.fn();
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "a1" }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("opens AssetPicker when Select/Change is clicked", () => {
    const onChange = vi.fn();
    render(
      <InspectorAssetField
        label="Logo image"
        value={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Select"));
    // AssetPicker should open with "Select Logo image" title
    expect(screen.getByText("Select Logo image")).toBeDefined();
  });

  it("calls onChange with AssetRef when an asset is selected via picker", () => {
    const onChange = vi.fn();
    render(
      <InspectorAssetField
        label="Logo image"
        value={undefined}
        onChange={onChange}
      />,
    );
    // Open picker
    fireEvent.click(screen.getByText("Select"));
    // Click asset in picker
    fireEvent.click(screen.getByText("logo.png"));
    expect(onChange).toHaveBeenCalledWith({ assetId: "a1" });
  });

  it("shows alt text input when allowAltText and value set", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "a1", altText: "Company Logo" }}
        onChange={() => {}}
        allowAltText
      />,
    );
    const altInput = screen.getByLabelText(/Alt text for Logo image/i);
    expect(altInput).toBeDefined();
    expect((altInput as HTMLInputElement).value).toBe("Company Logo");
  });

  it("does not show alt text input when allowAltText is false", () => {
    render(
      <InspectorAssetField
        label="Logo image"
        value={{ assetId: "a1" }}
        onChange={() => {}}
        allowAltText={false}
      />,
    );
    expect(() => screen.getByLabelText(/Alt text/)).toThrow();
  });

  it("picker cancel does not call onChange", () => {
    const onChange = vi.fn();
    render(
      <InspectorAssetField
        label="Logo image"
        value={undefined}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Select"));
    // Close picker via backdrop
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    // onChange should NOT have been called
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Undo/redo integration tests
// ---------------------------------------------------------------------------

describe("InspectorAssetField — undo/redo integration", () => {
  beforeEach(() => {
    setupStore();
    vi.clearAllMocks();
  });

  function findSection() {
    const state = useEditorStore.getState();
    return state.project.pages[0].sections[0];
  }

  it("selecting an asset creates a history entry (undo then redo)", () => {
    const store = useEditorStore.getState();
    const section = findSection();

    // Simulate asset selection via updateSectionProps
    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      logoImage: { assetId: "a1" },
    } as Record<string, unknown>);
    store.commitEditSession();

    expect(store.canUndo()).toBe(true);

    // Undo — should remove the AssetRef
    store.undo();
    expect(findSection().props.logoImage).toBeUndefined();

    // Redo — should restore it
    store.redo();
    expect(findSection().props.logoImage).toStrictEqual({ assetId: "a1" });
  });

  it("clearing an asset creates a history entry", () => {
    const store = useEditorStore.getState();
    const section = findSection();

    // First, set an asset ref
    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      logoImage: { assetId: "a1" },
    } as Record<string, unknown>);
    store.commitEditSession();

    // Now clear it
    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      logoImage: undefined,
    } as Record<string, unknown>);
    store.commitEditSession();

    // Undo — should restore the AssetRef
    store.undo();
    expect(findSection().props.logoImage).toStrictEqual({ assetId: "a1" });

    // Redo — should clear it again
    store.redo();
    expect(findSection().props.logoImage).toBeUndefined();
  });

  it("Hero image selection preserves legacy image URL", () => {
    const store = useEditorStore.getState();

    // Set up a section with legacy image URL
    const sectionId = "s-header";
    store.beginEditSession();
    store.updateSectionProps(sectionId, {
      ...findSection().props,
      type: "hero",
      image: "https://example.com/legacy.jpg",
      heroImage: undefined,
    } as Record<string, unknown>);
    store.commitEditSession();

    // Now set heroImage AssetRef
    store.beginEditSession();
    store.updateSectionProps(sectionId, {
      ...findSection().props,
      heroImage: { assetId: "a2" },
    } as Record<string, unknown>);
    store.commitEditSession();

    // Legacy URL should still be there
    // (need to update section type properly — test the principle)
    const sec = findSection();
    expect(sec.props.image).toBe("https://example.com/legacy.jpg");
    expect(sec.props.heroImage).toStrictEqual({ assetId: "a2" });
  });

  it("picking an asset creates exactly one history entry", () => {
    const store = useEditorStore.getState();
    const initialPastLength = store.history.past.length;

    store.beginEditSession();
    store.updateSectionProps("s-header", {
      ...findSection().props,
      logoImage: { assetId: "a1" },
    } as Record<string, unknown>);
    store.commitEditSession();

    // Use a fresh getState() call for the assertion
    expect(useEditorStore.getState().history.past.length).toBe(initialPastLength + 1);
  });

  it("CTA background asset select → undo → redo", () => {
    const store = useEditorStore.getState();
    const section = findSection();

    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      backgroundImage: { assetId: "a1" },
    } as Record<string, unknown>);
    store.commitEditSession();

    expect(findSection().props.backgroundImage).toStrictEqual({ assetId: "a1" });

    store.undo();
    expect(findSection().props.backgroundImage).toBeUndefined();

    store.redo();
    expect(findSection().props.backgroundImage).toStrictEqual({ assetId: "a1" });
  });

  it("Footer logo select → undo → redo", () => {
    const store = useEditorStore.getState();
    const section = findSection();

    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      logoImage: { assetId: "a2" },
    } as Record<string, unknown>);
    store.commitEditSession();

    expect(findSection().props.logoImage).toStrictEqual({ assetId: "a2" });

    store.undo();
    expect(findSection().props.logoImage).toBeUndefined();

    store.redo();
    expect(findSection().props.logoImage).toStrictEqual({ assetId: "a2" });
  });

  it("Feature asset assigned to one item only", () => {
    const store = useEditorStore.getState();

    // Set up features array with two items
    const section = findSection();
    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      features: [
        { title: "Fast", description: "Lightning speed", icon: "Zap" },
        { title: "Secure", description: "Bank-grade", icon: "Shield" },
      ],
    } as Record<string, unknown>);
    store.commitEditSession();

    // Assign iconImage to first feature only
    store.beginEditSession();
    const updated = findSection();
    const features = [...(updated.props.features as Array<Record<string, unknown>>)];
    features[0] = { ...features[0], iconImage: { assetId: "a2" } };
    store.updateSectionProps(section.id, {
      ...updated.props,
      features,
    } as Record<string, unknown>);
    store.commitEditSession();

    const feats = findSection().props.features as Array<Record<string, unknown>>;
    expect(feats[0].iconImage).toStrictEqual({ assetId: "a2" });
    expect(feats[1].iconImage).toBeUndefined();
  });

  it("alt text editing commits via edit session", () => {
    const store = useEditorStore.getState();

    // Set asset ref
    store.beginEditSession();
    store.updateSectionProps("s-header", {
      ...findSection().props,
      logoImage: { assetId: "a1", altText: "Old alt" },
    } as Record<string, unknown>);
    store.commitEditSession();

    // Now update alt text
    store.beginEditSession();
    store.updateSectionProps("s-header", {
      ...findSection().props,
      logoImage: { assetId: "a1", altText: "Updated alt" },
    } as Record<string, unknown>);
    store.commitEditSession();

    // Undo — should restore old alt
    store.undo();
    expect(findSection().props.logoImage).toStrictEqual({ assetId: "a1", altText: "Old alt" });

    // Redo — should apply new alt
    store.redo();
    expect(findSection().props.logoImage).toStrictEqual({ assetId: "a1", altText: "Updated alt" });
  });

  it("feature asset preserved after unrelated feature edits", () => {
    const store = useEditorStore.getState();

    // Set up features with iconImage on first item
    const section = findSection();
    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      features: [
        { title: "Fast", description: "Lightning", icon: "Zap", iconImage: { assetId: "a2" } },
        { title: "Secure", description: "Bank-grade", icon: "Shield" },
      ],
    } as Record<string, unknown>);
    store.commitEditSession();

    // Edit the second feature's title (unrelated edit)
    store.beginEditSession();
    const sec = findSection();
    const feats = [...(sec.props.features as Array<Record<string, unknown>>)];
    feats[1] = { ...feats[1], title: "Super Secure" };
    store.updateSectionProps(section.id, {
      ...sec.props,
      features: feats,
    } as Record<string, unknown>);
    store.commitEditSession();

    // First feature's iconImage should still be intact
    const after = findSection().props.features as Array<Record<string, unknown>>;
    expect(after[0].iconImage).toStrictEqual({ assetId: "a2" });
    expect(after[1].title).toBe("Super Secure");
  });

  it("feature asset reorder preserves references", () => {
    const store = useEditorStore.getState();

    // Set up features with iconImage on first item
    const section = findSection();
    store.beginEditSession();
    store.updateSectionProps(section.id, {
      ...section.props,
      features: [
        { title: "Fast", description: "Lightning", icon: "Zap", iconImage: { assetId: "a2" } },
        { title: "Secure", description: "Bank-grade", icon: "Shield" },
      ],
    } as Record<string, unknown>);
    store.commitEditSession();

    // Reorder: swap the features
    store.beginEditSession();
    const sec = findSection();
    const feats = [...(sec.props.features as Array<Record<string, unknown>>)];
    feats.reverse();
    store.updateSectionProps(section.id, {
      ...sec.props,
      features: feats,
    } as Record<string, unknown>);
    store.commitEditSession();

    // After reorder, the asset should be on the second item (was first, now second after reverse)
    const after = findSection().props.features as Array<Record<string, unknown>>;
    expect(after[1].iconImage).toStrictEqual({ assetId: "a2" });
    expect(after[0].iconImage).toBeUndefined();
  });

  it("missing asset reference does not crash inspector", () => {
    // Set asset ref pointing to nonexistent asset
    const store = useEditorStore.getState();
    store.beginEditSession();
    store.updateSectionProps("s-header", {
      ...findSection().props,
      logoImage: { assetId: "nonexistent" },
    } as Record<string, unknown>);
    store.commitEditSession();

    // Should not crash when rendering InspectorAssetField
    expect(() => {
      render(
        <InspectorAssetField
          label="Logo image"
          value={{ assetId: "nonexistent" }}
          onChange={() => {}}
        />,
      );
    }).not.toThrow();

    expect(screen.getByText(/Asset not found/i)).toBeDefined();
  });
});
