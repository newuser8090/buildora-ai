// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// BlockBrowserDialog — component tests (Phase O spec: TESTS → block browser)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../../registry/block-registry";
import { useBlockEditorStore } from "../../store/block-editor-store";
import { clearBlockPrefs } from "../../prefs/block-builder-prefs";
import { BlockBrowserDialog } from "../BlockBrowserDialog";
import type { Project } from "@/types/project";

function makeProject(): Project {
  return {
    id: "proj",
    name: "Test",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: {
              headline: "Build anything",
              subheadline: "A subheadline.",
              primaryCta: { text: "Get started", href: "/start" },
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

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  clearBlockPrefs();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useBlockEditorStore.getState().reset();
});

function renderOpen() {
  useBlockEditorStore.getState().openBrowser({ pageId: "page-1", sectionId: "s-hero" });
  return render(<BlockBrowserDialog />);
}

describe("BlockBrowserDialog", () => {
  it("renders when open with a target", () => {
    renderOpen();
    expect(screen.getByTestId("block-browser-dialog")).toBeTruthy();
    expect(screen.getByTestId("block-browser-search")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(<BlockBrowserDialog />);
    expect(screen.queryByTestId("block-browser-dialog")).toBeNull();
  });

  it("recommends the block types bound by the target section", () => {
    renderOpen();
    expect(screen.getByTestId("block-recommended")).toBeTruthy();
    // heading + button are the hero's bound types.
    expect(screen.getByTestId("block-card-heading")).toBeTruthy();
    expect(screen.getByTestId("block-card-button")).toBeTruthy();
  });

  it("filters by search with synonyms", () => {
    renderOpen();
    fireEvent.change(screen.getByTestId("block-browser-search"), {
      target: { value: "reviews" },
    });
    expect(screen.getByTestId("block-card-review-card")).toBeTruthy();
    // Heading is hidden.
    expect(screen.queryByTestId("block-card-heading")).toBeNull();
  });

  it("filters by category", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("block-cat-layout"));
    expect(screen.getByTestId("block-card-container")).toBeTruthy();
    expect(screen.queryByTestId("block-card-heading")).toBeNull();
  });

  it("toggles favorites and keeps the chip visible", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("block-fav-heading"));
    expect(screen.getByTestId("block-fav-heading").classList.contains("text-amber-300")).toBe(true);
  });

  it("closes on the close button", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("block-browser-close"));
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
  });

  it("closes on Escape", () => {
    renderOpen();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
  });

  it("adding a block inserts into the section tree and closes", () => {
    renderOpen();
    fireEvent.click(screen.getByTestId("block-add-heading"));
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
    // The insert was a session preview — the section tree now carries it.
    expect(Object.keys(useBlockEditorStore.getState().sessionTrees)).toContain("s-hero");
    expect(useBlockEditorStore.getState().recentBlockTypes).toContain("heading");
  });

  it("shows recent chips after an insert", () => {
    renderOpen();
    // Inserting closes the dialog by design; reopening surfaces the recents.
    fireEvent.click(screen.getByTestId("block-add-badge"));
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
    act(() => {
      useBlockEditorStore.getState().openBrowser({ pageId: "page-1", sectionId: "s-hero" });
    });
    expect(screen.queryByTestId("block-recent-badge")).toBeTruthy();
  });

  it("shows a friendly empty state for unknown search terms", () => {
    renderOpen();
    fireEvent.change(screen.getByTestId("block-browser-search"), {
      target: { value: "zzzzzz" },
    });
    expect(screen.getByText(/No blocks match/)).toBeTruthy();
  });
});
