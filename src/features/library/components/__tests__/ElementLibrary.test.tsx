// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ElementLibrary panel (Phase P22-D) — component tests
//   - renders categories + elements
//   - search + category filtering
//   - clicking an element inserts through the canonical service
//   - empty state
//   - insertion context (inside selected design vs new section)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { useMyBlocksUiStore } from "@/features/my-blocks/store/my-blocks-ui-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import type { Project } from "@/types/project";
import { ElementLibrary } from "../ElementLibrary";

function makeProject(): Project {
  return {
    id: "proj-library",
    name: "Library test",
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
          {
            id: "s-custom",
            type: "custom-block",
            order: 2,
            visible: true,
            props: {
              name: "Design",
              tree: {
                rootIds: ["s-custom"],
                nodes: {
                  "s-custom": {
                    id: "s-custom",
                    type: "container",
                    parentId: null,
                    children: ["h1"],
                    props: {},
                    style: { padding: "2rem" },
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  h1: {
                    id: "h1",
                    type: "heading",
                    parentId: "s-custom",
                    children: [],
                    props: { text: "Hello", level: 2 },
                    style: { fontSize: 24 },
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                },
              },
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
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
  useBlockEditorStore.getState().reset();
  useMyBlocksUiStore.getState().clearToast();
});

describe("ElementLibrary — rendering", () => {
  it("renders the header, categories and element cards", () => {
    render(<ElementLibrary />);
    expect(screen.getByTestId("element-library")).toBeTruthy();
    // Category chips.
    expect(screen.getByTestId("element-cat-all")).toBeTruthy();
    expect(screen.getByTestId("element-cat-layout")).toBeTruthy();
    expect(screen.getByTestId("element-cat-content")).toBeTruthy();
    expect(screen.getByTestId("element-cat-interactive")).toBeTruthy();
    expect(screen.getByTestId("element-cat-navigation")).toBeTruthy();
    // Representative element cards.
    expect(screen.getByTestId("element-card-heading")).toBeTruthy();
    expect(screen.getByTestId("element-card-container")).toBeTruthy();
    expect(screen.getByTestId("element-card-navbar")).toBeTruthy();
  });

  it("shows a new-section context when a built-in section is selected", () => {
    act(() => useEditorStore.getState().selectSection("s-hero"));
    render(<ElementLibrary />);
    expect(screen.getByTestId("element-library-context").textContent).toContain("Adding as a new section below");
  });

  it("shows an inside-design context when a custom-block section is selected", () => {
    act(() => useEditorStore.getState().selectSection("s-custom"));
    render(<ElementLibrary />);
    expect(screen.getByTestId("element-library-context").textContent).toContain("Adding inside the selected design");
  });
});

describe("ElementLibrary — search + categories", () => {
  it("filters cards by search query", () => {
    render(<ElementLibrary />);
    expect(screen.getByTestId("element-card-heading")).toBeTruthy();
    fireEvent.change(screen.getByTestId("element-library-search"), { target: { value: "pricing" } });
    expect(screen.queryByTestId("element-card-heading")).toBeNull();
    expect(screen.getByTestId("element-card-pricing-card")).toBeTruthy();
  });

  it("filters cards by category chip", () => {
    render(<ElementLibrary />);
    fireEvent.click(screen.getByTestId("element-cat-layout"));
    expect(screen.getByTestId("element-card-container")).toBeTruthy();
    expect(screen.queryByTestId("element-card-heading")).toBeNull();
  });

  it("shows an empty state for a search miss", () => {
    render(<ElementLibrary />);
    fireEvent.change(screen.getByTestId("element-library-search"), { target: { value: "zzzzz" } });
    expect(screen.getByTestId("element-library-empty")).toBeTruthy();
  });
});

describe("ElementLibrary — insertion", () => {
  it("clicking an element inserts a new custom-block section", () => {
    render(<ElementLibrary />);
    const before = useEditorStore.getState().project.pages[0].sections.length;
    fireEvent.click(screen.getByTestId("element-card-heading"));

    const state = useEditorStore.getState();
    expect(state.project.pages[0].sections.length).toBe(before + 1);
    const added = state.project.pages[0].sections[state.project.pages[0].sections.length - 1];
    expect(added.type).toBe("custom-block");
    const root = customBlockTreeFromSection(added).nodes[added.id];
    expect(root.type).toBe("heading");
    // Toast feedback + selection.
    expect(useMyBlocksUiStore.getState().toast).toContain("added to your page");
    expect(state.selectedSectionId).toBe(added.id);
  });

  it("clicking an element inserts inside the selected custom-block section", () => {
    act(() => useEditorStore.getState().selectSection("s-custom"));
    render(<ElementLibrary />);
    fireEvent.click(screen.getByTestId("element-card-button"));

    const state = useEditorStore.getState();
    // No new section — the tree grew instead.
    expect(state.project.pages[0].sections.length).toBe(2);
    const section = state.project.pages[0].sections.find((s) => s.id === "s-custom")!;
    const tree = customBlockTreeFromSection(section);
    const button = Object.values(tree.nodes).find((n) => n.type === "button");
    expect(button).toBeDefined();
    expect(button?.parentId).toBe("s-custom");
    // The new block is highlighted in the build tree / inspector.
    expect(useBlockEditorStore.getState().selectedBlockId).toBe(button?.id);
  });

  it("insertion creates exactly one history entry", () => {
    render(<ElementLibrary />);
    const before = useEditorStore.getState().history.past.length;
    fireEvent.click(screen.getByTestId("element-card-divider"));
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });
});
