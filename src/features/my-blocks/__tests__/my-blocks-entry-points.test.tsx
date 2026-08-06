// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// My Blocks — entry-point integration tests (Phase P4)
//
// Every entry point must open the SAME canonical store/dialog/service:
//   - Block Browser "My blocks" tab (list + empty + insert)
//   - Build Tree "Save to My Blocks" for a custom-block section
//   - CustomBlockSection "Save as reusable block" hover action
//   - Guided Builder "My saved pieces"
//   - Command Palette My Blocks commands
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultSectionLibrary } from "@/features/editor/section-library/registry/register-default-section-library";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { useGuidedBuilderStore } from "@/features/guided-builder/store/guided-builder-store";
import { clearGuidedPrefs } from "@/features/guided-builder/prefs/guided-builder-prefs";
import { useMyBlocksUiStore } from "../store/my-blocks-ui-store";
import { setMyBlocksAdapterForTests } from "../storage/my-blocks-singleton";
import { InMemoryMyBlocksAdapter, makeProject, makeSectionRecord, makeTree } from "./helpers";
import { BlockBrowserDialog } from "@/features/blocks/components/BlockBrowserDialog";
import { BuildTreePanel } from "@/features/blocks/components/BuildTreePanel";
import { CustomBlockSection } from "@/features/editor/sections/CustomBlockSection";
import { GuidedStartScreen } from "@/features/guided-builder/components/GuidedStartScreen";
import { CommandPalette } from "@/features/guided-builder/components/CommandPalette";
import { InlineEditPageProvider } from "@/features/inline-editing/context/InlineEditPageContext";

let adapter: InMemoryMyBlocksAdapter;

function resetUi() {
  useMyBlocksUiStore.setState({
    libraryOpen: false,
    saveSource: null,
    detailsBlockId: null,
    renameBlockId: null,
    deleteBlockId: null,
    importOpen: false,
    toast: null,
    refreshTick: 0,
  });
}

/** A project with a hero section plus one custom-block (imported) section. */
function projectWithCustomBlock() {
  const project = makeProject();
  project.pages[0].sections.push(makeSectionRecord("Imported design", makeTree()));
  return project;
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultSectionLibrary();
  adapter = new InMemoryMyBlocksAdapter();
  setMyBlocksAdapterForTests(adapter);
  resetUi();
  useBlockEditorStore.getState().reset();
  useGuidedBuilderStore.getState().reset();
  clearGuidedPrefs();
});

describe("Block Browser — My Blocks tab", () => {
  function openBrowser() {
    act(() => {
      useBlockEditorStore.getState().openBrowser({ pageId: "page-1", sectionId: "s-hero" });
    });
    render(<BlockBrowserDialog />);
  }

  it("shows the empty state for a fresh library", async () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    openBrowser();
    fireEvent.click(screen.getByTestId("block-cat-my-blocks"));
    await waitFor(() => {
      expect(screen.getByTestId("my-blocks-browser-empty")).toBeTruthy();
    });
  });

  it("lists saved blocks and inserts one as a new section", async () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    const created = await adapter.createMyBlock({ name: "Saved hero", category: "layout", tree: makeTree() });
    if (!created.ok) return;
    openBrowser();
    fireEvent.click(screen.getByTestId("block-cat-my-blocks"));
    await waitFor(() => {
      expect(screen.getByTestId(`my-block-browser-card-${created.value.id}`)).toBeTruthy();
    });
    const before = useEditorStore.getState().project.pages[0].sections.length;
    fireEvent.click(screen.getByTestId(`my-block-browser-add-${created.value.id}`));
    await waitFor(() => {
      expect(useEditorStore.getState().project.pages[0].sections.length).toBe(before + 1);
    });
    // Browser closes and announces the insert.
    expect(useBlockEditorStore.getState().browserOpen).toBe(false);
    expect(useMyBlocksUiStore.getState().toast).toContain("added to your page");
  });
});

describe("Build Tree — Save to My Blocks", () => {
  it("offers Save to My Blocks for the selected custom-block section", async () => {
    useEditorStore.getState().hydrateProject(projectWithCustomBlock(), 1);
    const customSection = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.type === "custom-block",
    );
    act(() => {
      useEditorStore.getState().selectSection(customSection!.id);
    });
    render(<BuildTreePanel />);
    const saveButton = screen.getByTestId("build-tree-save-to-my-blocks");
    fireEvent.click(saveButton);
    const source = useMyBlocksUiStore.getState().saveSource;
    expect(source?.kind).toBe("section");
  });

  it("hides Save to My Blocks when a built-in section is selected", () => {
    useEditorStore.getState().hydrateProject(projectWithCustomBlock(), 1);
    act(() => {
      useEditorStore.getState().selectSection("s-hero");
    });
    render(<BuildTreePanel />);
    expect(screen.queryByTestId("build-tree-save-to-my-blocks")).toBeNull();
  });
});

describe("CustomBlockSection — Save as reusable block", () => {
  it("opens the shared save dialog from the canvas hover action", () => {
    useEditorStore.getState().hydrateProject(projectWithCustomBlock(), 1);
    const section = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.type === "custom-block",
    )!;
    render(
      <InlineEditPageProvider pageId="page-1">
        <CustomBlockSection section={section} />
      </InlineEditPageProvider>,
    );
    fireEvent.click(screen.getByTestId("custom-block-save-to-my-blocks"));
    const source = useMyBlocksUiStore.getState().saveSource;
    expect(source?.kind).toBe("section");
  });
});

describe("Guided Builder — My saved pieces", () => {
  it("opens the shared library", () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    render(
      <GuidedStartScreen
        pageId="page-1"
        existingSectionIds={new Set(["s-hero"])}
      />,
    );
    fireEvent.click(screen.getByTestId("guided-start-my-blocks"));
    expect(useMyBlocksUiStore.getState().libraryOpen).toBe(true);
  });

  it("the compact variant opens the same library", () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    render(
      <GuidedStartScreen
        pageId="page-1"
        existingSectionIds={new Set(["s-hero"])}
        compact
      />,
    );
    fireEvent.click(screen.getByTestId("guided-start-my-blocks-compact"));
    expect(useMyBlocksUiStore.getState().libraryOpen).toBe(true);
  });
});

describe("Command Palette — My Blocks commands", () => {
  function openPalette() {
    act(() => {
      useGuidedBuilderStore.getState().setCommandPaletteOpen(true);
    });
    render(<CommandPalette />);
  }

  it("Open my saved blocks opens the shared library", () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    openPalette();
    fireEvent.click(screen.getByTestId("command-open-my-blocks"));
    expect(useMyBlocksUiStore.getState().libraryOpen).toBe(true);
  });

  it("Import a saved block file opens the shared import dialog", () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    openPalette();
    fireEvent.click(screen.getByTestId("command-import-saved-block"));
    expect(useMyBlocksUiStore.getState().importOpen).toBe(true);
  });

  it("Save this design opens the save dialog for a selected custom-block section", () => {
    useEditorStore.getState().hydrateProject(projectWithCustomBlock(), 1);
    const customSection = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.type === "custom-block",
    )!;
    act(() => {
      useEditorStore.getState().selectSection(customSection.id);
    });
    openPalette();
    fireEvent.click(screen.getByTestId("command-save-this-block"));
    const source = useMyBlocksUiStore.getState().saveSource;
    expect(source?.kind).toBe("section");
  });

  it("Save this design explains when nothing saveable is selected", () => {
    useEditorStore.getState().hydrateProject(makeProject(), 1);
    act(() => {
      useEditorStore.getState().selectSection("s-hero");
    });
    openPalette();
    fireEvent.click(screen.getByTestId("command-save-this-block"));
    expect(useMyBlocksUiStore.getState().toast).toContain("Select an imported design");
    expect(useMyBlocksUiStore.getState().saveSource).toBeNull();
  });
});
