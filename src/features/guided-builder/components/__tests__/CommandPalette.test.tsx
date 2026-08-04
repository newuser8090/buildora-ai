// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// CommandPalette — tests (Phase N, spec §28)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CommandPalette } from "../CommandPalette";
import { useGuidedBuilderStore } from "../../store/guided-builder-store";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { clearGuidedPrefs } from "../../prefs/guided-builder-prefs";

function seedProject() {
  useEditorStore.getState().initProject({
    id: "p1",
    name: "Test",
    theme: {
      palette: {
        background: "#fff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#0a0a0a",
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
          { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hi", subheadline: "", primaryCta: { text: "Go", href: "#" } }, styles: {} },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
}

function openPalette() {
  act(() => {
    useGuidedBuilderStore.getState().setCommandPaletteOpen(true);
  });
}

beforeEach(() => {
  clearGuidedPrefs();
  useGuidedBuilderStore.getState().reset();
  seedProject();
});

describe("CommandPalette", () => {
  it("lists plain-language commands when open", () => {
    openPalette();
    render(<CommandPalette />);
    expect(screen.getByTestId("command-add-something")).toBeTruthy();
    expect(screen.getByTestId("command-export-website")).toBeTruthy();
  });

  it("filters by synonym search", () => {
    openPalette();
    render(<CommandPalette />);
    const input = screen.getByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "phone" } });
    expect(screen.getByTestId("command-preview-phone")).toBeTruthy();
    expect(screen.queryByTestId("command-export-website")).toBeNull();
  });

  it("runs 'Preview on phone' and sets the mobile viewport", () => {
    openPalette();
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId("command-preview-phone"));
    expect(useEditorStore.getState().viewport).toBe("mobile");
    expect(useGuidedBuilderStore.getState().hasPreviewedMobile).toBe(true);
    // Palette closes after running
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("runs 'Add a new page' through the real store", () => {
    const before = useEditorStore.getState().project.pages.length;
    openPalette();
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId("command-add-page"));
    expect(useEditorStore.getState().project.pages.length).toBe(before + 1);
  });

  it("runs undo", () => {
    // Make a change so undo has something to do
    useEditorStore.getState().addPage();
    const afterAdd = useEditorStore.getState().project.pages.length;
    openPalette();
    render(<CommandPalette />);
    fireEvent.click(screen.getByTestId("command-undo"));
    expect(useEditorStore.getState().project.pages.length).toBe(afterAdd - 1);
  });

  it("closes on Escape", () => {
    openPalette();
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("opens with Ctrl/Cmd+K", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("command-palette")).toBeTruthy();
    void vi;
  });
});
