// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// ResponsiveSuggestions tests (Phase P22-F)
// Rendered inside the element inspector: proposals appear at tablet/mobile
// viewports only, are NEVER auto-applied, Apply folds the override + records
// the AI decision, Dismiss records the user rejection (never re-suggested).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import type { Project } from "@/types/project";
import { ElementInspectorPanel } from "../components/ElementInspectorPanel";

function makeProject(): Project {
  return {
    id: "proj-suggestions",
    name: "Suggestions",
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
            id: "s-custom",
            type: "custom-block",
            order: 1,
            visible: true,
            props: {
              name: "Grid design",
              tree: {
                rootIds: ["s-custom"],
                nodes: {
                  "s-custom": {
                    id: "s-custom",
                    type: "container",
                    parentId: null,
                    children: ["g1"],
                    props: {},
                    style: {},
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  g1: {
                    id: "g1",
                    type: "grid",
                    parentId: "s-custom",
                    children: ["c1", "c2", "c3", "c4"],
                    props: { columns: 4 },
                    style: { display: "grid", gap: "1rem" },
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  c1: { id: "c1", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                  c2: { id: "c2", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                  c3: { id: "c3", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
                  c4: { id: "c4", type: "container", parentId: "g1", children: [], props: {}, style: {}, responsive: {}, visible: true, locked: false, hidden: false },
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

function storedGridViewport() {
  const section = useEditorStore.getState().project.pages[0].sections[0];
  const tree = (section.props as { tree?: { nodes?: Record<string, { viewport?: unknown }> } }).tree;
  return tree?.nodes?.g1?.viewport;
}

function storedDecisions() {
  return useEditorStore.getState().project.responsiveDecisions ?? [];
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
  useBlockEditorStore.getState().reset();
});

function renderPanel() {
  render(<ElementInspectorPanel pageId="page-1" sectionId="s-custom" />);
}

function switchViewport(viewport: "desktop" | "tablet" | "mobile") {
  act(() => {
    useEditorStore.getState().setViewport(viewport);
  });
}

describe("ResponsiveSuggestions", () => {
  it("shows no suggestions on desktop", () => {
    renderPanel();
    expect(screen.queryByTestId("responsive-suggestions")).toBeNull();
  });

  it("suggests 1 column for a 4-column grid on mobile", () => {
    renderPanel();
    switchViewport("mobile");
    expect(screen.getByTestId("responsive-suggestions")).toBeTruthy();
    const row = screen.getByTestId("responsive-suggestion-g1");
    expect(within(row).getByText("Show 1 column on mobile")).toBeTruthy();
  });

  it("suggests 2 columns for the same grid on tablet", () => {
    renderPanel();
    switchViewport("tablet");
    const row = screen.getByTestId("responsive-suggestion-g1");
    expect(within(row).getByText("Show 2 columns on tablet")).toBeTruthy();
  });

  it("Apply folds the override AND records the AI decision (no re-suggestion)", () => {
    renderPanel();
    switchViewport("mobile");
    fireEvent.click(screen.getByTestId("responsive-apply"));

    expect(storedGridViewport()).toEqual({ mobile: { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } });
    expect(storedDecisions()).toHaveLength(1);
    expect(storedDecisions()[0]).toMatchObject({
      elementId: "g1",
      viewport: "mobile",
      transformation: "grid-columns-1",
      appliedBy: "ai",
      state: "applied",
    });
    // The suggestion disappears once applied (never re-offered).
    expect(screen.queryByTestId("responsive-suggestion-g1")).toBeNull();
  });

  it("Dismiss records the user rejection and does NOT auto-apply anything", () => {
    renderPanel();
    switchViewport("mobile");
    fireEvent.click(screen.getByTestId("responsive-dismiss"));

    expect(storedGridViewport()).toBeUndefined();
    expect(storedDecisions()).toEqual([
      expect.objectContaining({
        elementId: "g1",
        viewport: "mobile",
        transformation: "grid-columns-1",
        appliedBy: "user",
        state: "rejected",
      }),
    ]);
    expect(screen.queryByTestId("responsive-suggestion-g1")).toBeNull();
  });

  it("a dismissed proposal stays hidden after viewport round-trip (never re-suggested)", () => {
    renderPanel();
    switchViewport("mobile");
    fireEvent.click(screen.getByTestId("responsive-dismiss"));

    // Leave and re-enter the viewport — the user decision suppresses it.
    switchViewport("desktop");
    expect(screen.queryByTestId("responsive-suggestions")).toBeNull();
    switchViewport("mobile");
    expect(screen.queryByTestId("responsive-suggestion-g1")).toBeNull();
  });
});
