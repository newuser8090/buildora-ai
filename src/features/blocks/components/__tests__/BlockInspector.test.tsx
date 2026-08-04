// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// BlockInspector — component tests (Phase O spec: TESTS → inspector)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "../../registry/block-registry";
import { useBlockEditorStore } from "../../store/block-editor-store";
import { BlockInspector } from "../BlockInspector";
import { sectionToBlockTree } from "../../adapters/section-block-adapter";
import { allNodes } from "../../engine/tree-traversal";
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

let headlineNodeId: string;

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useBlockEditorStore.getState().reset();
  const tree = sectionToBlockTree(useEditorStore.getState().project.pages[0].sections[0]);
  const node = allNodes(tree).find((n) => (n.props._bindLabel as string) === "Main headline")!;
  headlineNodeId = node.id;
});

function renderInspector() {
  return render(<BlockInspector />);
}

function headlineValue(): string {
  return useEditorStore.getState().project.pages[0].sections[0].props.headline as string;
}

describe("BlockInspector", () => {
  it("shows an empty hint when no block is selected", () => {
    renderInspector();
    expect(screen.getByTestId("block-inspector-empty")).toBeTruthy();
  });

  it("shows the bound field label and value for a selected bound block", () => {
    useBlockEditorStore.getState().selectBlock(headlineNodeId);
    renderInspector();
    expect(screen.getByTestId("block-inspector-text")).toBeTruthy();
    expect((screen.getByTestId("block-inspector-text") as HTMLTextAreaElement).value).toBe(
      "Build anything",
    );
    expect(screen.getByTestId("block-bound-badge")).toBeTruthy();
  });

  it("saving a changed text folds back to the section (one history entry)", () => {
    useBlockEditorStore.getState().selectBlock(headlineNodeId);
    renderInspector();
    const textarea = screen.getByTestId("block-inspector-text");
    fireEvent.change(textarea, { target: { value: "Edited headline" } });
    const pastBefore = useEditorStore.getState().history.past.length;
    fireEvent.click(screen.getByTestId("block-inspector-save"));
    expect(headlineValue()).toBe("Edited headline");
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore + 1);
  });

  it("Enter saves single-line fields; unchanged save is a no-op", () => {
    useBlockEditorStore.getState().selectBlock(headlineNodeId);
    renderInspector();
    const pastBefore = useEditorStore.getState().history.past.length;
    // Unchanged save → disabled + no history.
    expect((screen.getByTestId("block-inspector-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("block-inspector-text"), {
      target: { value: "New value" },
    });
    fireEvent.keyDown(screen.getByTestId("block-inspector-text"), { key: "Enter" });
    expect(headlineValue()).toBe("New value");
    expect(useEditorStore.getState().history.past.length).toBe(pastBefore + 1);
  });

  it("Escape cancels the draft", () => {
    useBlockEditorStore.getState().selectBlock(headlineNodeId);
    renderInspector();
    const textarea = screen.getByTestId("block-inspector-text");
    fireEvent.change(textarea, { target: { value: "Canceled" } });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect((screen.getByTestId("block-inspector-text") as HTMLTextAreaElement).value).toBe(
      "Build anything",
    );
  });

  it("shows preset chips for button blocks", () => {
    const tree = sectionToBlockTree(useEditorStore.getState().project.pages[0].sections[0]);
    const buttonNode = allNodes(tree).find((n) => n.type === "button")!;
    useBlockEditorStore.getState().selectBlock(buttonNode.id);
    renderInspector();
    expect(screen.getByTestId("preset-button-primary")).toBeTruthy();
    expect(screen.getByTestId("preset-button-gradient")).toBeTruthy();
  });

  it("renders a section-container explanation for root rows", () => {
    useBlockEditorStore.getState().selectBlock("s-hero");
    renderInspector();
    expect(screen.getByText(/Sections are containers/)).toBeTruthy();
  });
});
