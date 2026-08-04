// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// BuildTreePanel — component tests (Phase O spec: TESTS → build tree)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../../registry/block-registry";
import { useBlockEditorStore } from "../../store/block-editor-store";
import { BuildTreePanel } from "../BuildTreePanel";
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
          {
            id: "s-footer",
            type: "footer",
            order: 2,
            visible: true,
            props: { text: "© 2026", links: [] },
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
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useBlockEditorStore.getState().reset();
});

function renderPanel() {
  return render(<BuildTreePanel />);
}

describe("BuildTreePanel rendering", () => {
  it("shows one root row per section", () => {
    renderPanel();
    expect(screen.getByTestId("block-row-s-hero")).toBeTruthy();
    expect(screen.getByTestId("block-row-s-footer")).toBeTruthy();
  });

  it("expands a section to reveal bound child blocks", () => {
    renderPanel();
    // Collapsed by default — no child rows yet.
    expect(screen.queryAllByTestId("block-row-s-hero")).toHaveLength(1);
    // Expand hero.
    const hero = screen.getByTestId("block-row-s-hero");
    fireEvent.click(hero.querySelector("button")!);
    // headline, subheadline, primary button bound children
    expect(screen.getByText("Main headline")).toBeTruthy();
    expect(screen.getByText("Subheadline")).toBeTruthy();
    expect(screen.getByText("Primary button")).toBeTruthy();
  });

  it("marks bound blocks with the saved chip data attribute", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("block-row-s-hero").querySelector("button")!);
    const boundRow = screen.getByText("Main headline").closest('[data-testid^="block-row-"]')!;
    expect(boundRow.getAttribute("data-bound")).toBe("true");
  });
});

describe("BuildTreePanel selection", () => {
  it("selecting a section row selects the section in the editor store", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("block-row-s-footer"));
    expect(useEditorStore.getState().selectedSectionId).toBe("s-footer");
    expect(useBlockEditorStore.getState().selectedBlockId).toBe("s-footer");
  });

  it("selecting a child block selects its owning section and keeps the child selected", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("block-row-s-hero").querySelector("button")!);
    const childRow = screen.getByText("Main headline").closest('[data-testid^="block-row-"]')!;
    fireEvent.click(childRow);
    expect(useEditorStore.getState().selectedSectionId).toBe("s-hero");
    // The selection-sync effect must NOT clobber the child selection back to
    // the section root (regression: build-tree selection was being overridden).
    const childId = childRow.getAttribute("data-testid")!.replace("block-row-", "");
    expect(useBlockEditorStore.getState().selectedBlockId).toBe(childId);
    expect(useBlockEditorStore.getState().selectedBlockId).not.toBe("s-hero");
  });

  it("external section selection still re-selects the root block when no inner block is selected", () => {
    renderPanel();
    act(() => {
      useBlockEditorStore.getState().selectBlock("s-hero");
    });
    act(() => {
      useEditorStore.getState().selectSection("s-footer");
    });
    expect(useBlockEditorStore.getState().selectedBlockId).toBe("s-footer");
  });

  it("external section selection syncs the tree", () => {
    renderPanel();
    act(() => {
      useEditorStore.getState().selectSection("s-footer");
    });
    expect(useBlockEditorStore.getState().selectedBlockId).toBe("s-footer");
  });

  it("keyboard navigation moves selection", () => {
    renderPanel();
    // Focus the tree container and press ArrowDown twice.
    const tree = screen.getByTestId("block-tree");
    tree.focus();
    act(() => {
      useBlockEditorStore.getState().selectBlock("s-hero");
    });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(useBlockEditorStore.getState().selectedBlockId).toBe("s-footer");
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    expect(useBlockEditorStore.getState().selectedBlockId).toBe("s-hero");
  });

  it("Escape clears block selection", () => {
    renderPanel();
    act(() => {
      useBlockEditorStore.getState().selectBlock("s-hero");
    });
    fireEvent.keyDown(screen.getByTestId("block-tree"), { key: "Escape" });
    expect(useBlockEditorStore.getState().selectedBlockId).toBeNull();
  });
});

describe("BuildTreePanel browser", () => {
  it("Add block opens the browser targeting the first section", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("open-block-browser"));
    const state = useBlockEditorStore.getState();
    expect(state.browserOpen).toBe(true);
    expect(state.browserTarget?.sectionId).toBe("s-hero");
  });
});

describe("BuildTreePanel feedback", () => {
  it("renders a structured error banner", () => {
    useBlockEditorStore.getState().setFeedback({ code: "LOCKED_BLOCK", message: "Locked blocks cannot be edited." });
    renderPanel();
    expect(screen.getByTestId("block-error").textContent).toContain("Locked blocks");
  });
});
