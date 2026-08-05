// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Phase P3 — Import Studio entry points
//   - Block Browser: "Import code"
//   - Build Tree: "Import into selected block"
//   - Guided Builder: "Bring your own design"
//   - Command palette: "Import copied code"
// All open the same shared CodeImportDialog — no duplicate implementations.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { useCodeImportStore } from "@/features/code-import/store/code-import-store";
import { BlockBrowserDialog } from "@/features/blocks/components/BlockBrowserDialog";
import { BuildTreePanel } from "@/features/blocks/components/BuildTreePanel";
import { GuidedStartScreen } from "@/features/guided-builder/components/GuidedStartScreen";
import { CommandPalette } from "@/features/guided-builder/components/CommandPalette";
import { CodeImportDialog } from "../CodeImportDialog";
import type { Project } from "@/types/project";

function makeProject(): Project {
  return {
    id: "proj-ep",
    name: "Entry points",
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
            props: { headline: "Build anything", subheadline: "Sub", primaryCta: { text: "Go", href: "/start" } },
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
  useCodeImportStore.getState().closeDialog();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().selectPage("page-1");
  useEditorStore.getState().selectSection("s-hero");
  useBlockEditorStore.getState().reset();
  useGuidedBuilderStore.getState().setCommandPaletteOpen(false);
});

describe("Block Browser entry point", () => {
  it("\"Import code\" opens the Import Studio with the current target", () => {
    act(() => {
      useBlockEditorStore.getState().openBrowser({ pageId: "page-1", sectionId: "s-hero" });
    });
    render(<BlockBrowserDialog />);
    render(<CodeImportDialog />);

    fireEvent.click(screen.getByTestId("browser-import-code"));
    // The browser closes and the Import Studio opens.
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
    expect(useCodeImportStore.getState().open).toBe(true);
    expect(screen.getByTestId("code-import-dialog")).toBeTruthy();
    expect(useCodeImportStore.getState().insertionTarget).toEqual({
      pageId: "page-1",
      sectionId: "s-hero",
    });
  });

  it("Import code does not count as a BlockType", () => {
    expect(useBlockEditorStore.getState().recentBlockTypes).not.toContain("import-code");
  });
});

describe("Build Tree entry point", () => {
  it("\"Import code\" opens the Import Studio with the selected block", () => {
    render(<BuildTreePanel />);
    render(<CodeImportDialog />);
    fireEvent.click(screen.getByTestId("build-tree-import-code"));
    expect(useCodeImportStore.getState().open).toBe(true);
    expect(screen.getByTestId("code-import-dialog")).toBeTruthy();
  });
});

describe("Guided Builder entry point", () => {
  it("\"Bring your own design\" opens the Import Studio", () => {
    render(
      <GuidedStartScreen pageId="page-1" existingSectionIds={new Set(["s-hero"])} compact />,
    );
    render(<CodeImportDialog />);
    fireEvent.click(screen.getByTestId("guided-start-import"));
    expect(useCodeImportStore.getState().open).toBe(true);
    expect(useCodeImportStore.getState().insertionTarget).toEqual({ pageId: "page-1" });
  });
});

describe("Command palette entry point", () => {
  it("\"Import copied code\" opens the Import Studio", () => {
    render(<CommandPalette />);
    render(<CodeImportDialog />);
    act(() => {
      useGuidedBuilderStore.getState().setCommandPaletteOpen(true);
    });
    fireEvent.click(screen.getByTestId("command-import-code"));
    expect(useGuidedBuilderStore.getState().commandPaletteOpen).toBe(false);
    expect(useCodeImportStore.getState().open).toBe(true);
    expect(screen.getByTestId("code-import-dialog")).toBeTruthy();
  });

  it("palette synonyms surface the import command", () => {
    render(<CommandPalette />);
    act(() => {
      useGuidedBuilderStore.getState().setCommandPaletteOpen(true);
    });
    const input = screen.getByLabelText("Search commands");
    fireEvent.change(input, { target: { value: "paste component" } });
    expect(screen.getByTestId("command-import-code")).toBeTruthy();
    fireEvent.change(input, { target: { value: "import tailwind" } });
    expect(screen.getByTestId("command-import-code")).toBeTruthy();
    fireEvent.change(input, { target: { value: "copied design" } });
    expect(screen.getByTestId("command-import-code")).toBeTruthy();
  });
});
