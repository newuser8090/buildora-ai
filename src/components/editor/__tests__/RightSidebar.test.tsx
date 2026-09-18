// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// RightSidebar — inspector routing (Phase P24-C, decisions D2/D3; REQ-3)
//
// Covers:
//   - the existing fallback: no element selected → the section-specific
//     inspector (unchanged legacy behaviour)
//   - an element selected inside a STANDARD section carrying a durable tree →
//     the universal ElementInspectorPanel, targeted at THAT element
//   - clearing the selection restores the section inspector
//   - ambiguous (multi / stale / root) selections fail gracefully
//   - legacy custom-block sections keep routing to the universal panel
//   - the transient selection never leaks into the project, history, or the
//     serialized/persisted payload
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useCanvasInteractionStore } from "@/features/canvas/store/canvas-interaction-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { serializeProject } from "@/features/persistence/services/project-serializer";
import { inspectorRegistry } from "@/features/editor/registry/inspector-registry";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { HeroInspector } from "@/features/editor/inspectors/HeroInspector";
import { HeroSection } from "@/features/editor/sections/HeroSection";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import { RightSidebar } from "../RightSidebar";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A hero section WITHOUT a durable tree (legacy props-driven surface). */
function legacyHero(id: string, order: number): BaseSection {
  return {
    id,
    type: "hero",
    order,
    visible: true,
    props: {
      headline: "Legacy headline",
      subheadline: "",
      primaryCta: { text: "Go", href: "#" },
    },
    styles: {},
  };
}

/**
 * A hero section WITH a durable element tree (Phase P24-B). The tree keeps the
 * section-derived shape: a container root carrying the section markers plus one
 * bound heading child (the element the inspector should target).
 */
function durableHero(id: string, order: number): BaseSection {
  return {
    id,
    type: "hero",
    order,
    visible: true,
    props: {
      headline: "Durable headline",
      subheadline: "",
      primaryCta: { text: "Go", href: "#" },
    },
    styles: {},
    tree: {
      rootIds: [id],
      nodes: {
        [id]: {
          id,
          type: "container",
          parentId: null,
          children: ["h-durable"],
          props: { _sectionType: "hero", _sectionId: id },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
        "h-durable": {
          id: "h-durable",
          type: "heading",
          parentId: id,
          children: [],
          props: { text: "Durable headline", level: 2 },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
      },
    },
  };
}

/** A custom-block section (props.tree is the durable surface, per P22/P23). */
function customBlockSection(id: string, order: number): BaseSection {
  return {
    id,
    type: "custom-block",
    order,
    visible: true,
    props: {
      name: "Imported design",
      tree: {
        rootIds: [id],
        nodes: {
          [id]: {
            id,
            type: "container",
            parentId: null,
            children: ["h-custom"],
            props: {},
            style: {},
            responsive: {},
            visible: true,
            locked: false,
            hidden: false,
          },
          "h-custom": {
            id: "h-custom",
            type: "heading",
            parentId: id,
            children: [],
            props: { text: "Custom headline", level: 2 },
            style: {},
            responsive: {},
            visible: true,
            locked: false,
            hidden: false,
          },
        },
      },
    },
    styles: {},
  };
}

function makeProject(): Project {
  return {
    id: "proj-routing",
    name: "Routing",
    theme: {
      palette: {
        background: "#ffffff",
        foreground: "#0a0a0a",
        primary: "#7c5cfc",
        primaryForeground: "#ffffff",
        secondary: "#f5f5f5",
        secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5",
        mutedForeground: "#737373",
        accent: "#7c5cfc",
        accentForeground: "#ffffff",
        border: "#e5e5e5",
        card: "#ffffff",
        cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "a", md: "b", lg: "c", xl: "d" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          legacyHero("s-hero-legacy", 1),
          durableHero("s-hero-tree", 2),
          customBlockSection("s-custom", 3),
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Select a section and (optionally) drive the transient element selection. */
function selectSection(sectionId: string, elementIds: string[] = []) {
  act(() => {
    useEditorStore.getState().selectSection(sectionId);
    const interaction = useCanvasInteractionStore.getState();
    if (elementIds.length === 0) {
      // No element focus: the manipulation layer mirrors the section root.
      interaction.setSelection([sectionId], { multi: false, anchorId: sectionId });
    } else {
      interaction.setSelection(elementIds, { multi: elementIds.length > 1, anchorId: elementIds[0] });
    }
  });
}

function renderDesignPanel() {
  return render(<RightSidebar />);
}

const elementInspector = () => screen.queryByTestId("element-inspector");

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  sectionRegistry.registerAll([["hero", HeroSection]]);
  inspectorRegistry.registerAll([["hero", HeroInspector]]);

  useEditorStore.getState().initProject(makeProject());
  useEditorStore.getState().setDirty(false);
  useBlockEditorStore.getState().reset();
  useCanvasInteractionStore.getState().reset();
  useEditorUiStore.setState({
    ...useEditorUiStore.getState(),
    rightPanelCollapsed: false,
    rightSidebarTab: "design",
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("RightSidebar inspector routing (P24-C)", () => {
  it("keeps the section-specific inspector for a legacy section with no element selected", () => {
    renderDesignPanel();
    selectSection("s-hero-legacy");

    expect(elementInspector()).toBeNull();
    expect(screen.getByText("Headline")).toBeTruthy();
  });

  it("mounts the universal element inspector when an element of a durable standard section is selected", () => {
    renderDesignPanel();
    selectSection("s-hero-tree", ["h-durable"]);

    expect(elementInspector()).toBeTruthy();
    // ...and it inspects THAT element (not the section root).
    expect(screen.getByTestId("element-inspector-title").textContent).toBe("Heading");
  });

  it("restores the section-specific inspector when the element selection is cleared", () => {
    renderDesignPanel();
    selectSection("s-hero-tree", ["h-durable"]);
    expect(elementInspector()).toBeTruthy();

    // Deselect the element → section-level selection marker only.
    act(() => {
      useCanvasInteractionStore.getState().clearSelection();
      useCanvasInteractionStore.getState().setSelection(["s-hero-tree"], {
        multi: false,
        anchorId: "s-hero-tree",
      });
    });

    expect(elementInspector()).toBeNull();
    expect(screen.getByText("Headline")).toBeTruthy();
  });

  it("falls back to the section inspector for a multi-element (ambiguous) selection", () => {
    renderDesignPanel();
    selectSection("s-hero-tree", ["h-durable", "unknown"]);

    expect(elementInspector()).toBeNull();
    expect(screen.getByText("Headline")).toBeTruthy();
  });

  it("falls back gracefully for a stale element id from another section", () => {
    renderDesignPanel();
    selectSection("s-hero-tree", ["h-custom"]);

    expect(elementInspector()).toBeNull();
    expect(screen.getByText("Headline")).toBeTruthy();
  });

  it("does not route a legacy section whose selection id is not in its tree", () => {
    renderDesignPanel();
    selectSection("s-hero-legacy", ["h-durable"]);

    expect(elementInspector()).toBeNull();
    expect(screen.getByText("Headline")).toBeTruthy();
  });

  it("keeps routing legacy custom-block sections to the universal inspector", () => {
    renderDesignPanel();
    selectSection("s-custom");

    expect(elementInspector()).toBeTruthy();
  });

  it("targets the block selected in the build tree for a custom-block section", () => {
    renderDesignPanel();
    selectSection("s-custom");
    act(() => {
      useBlockEditorStore.getState().selectBlock("h-custom");
    });

    expect(elementInspector()).toBeTruthy();
    expect(screen.getByTestId("element-inspector-title").textContent).toBe("Heading");
  });
});

// ---------------------------------------------------------------------------
// Transient state containment (selection is UI state, never durable)
// ---------------------------------------------------------------------------

describe("RightSidebar — element selection stays transient (P24-C)", () => {
  it("never writes the selection into the project, history, or serialized payload", () => {
    renderDesignPanel();
    const before = useEditorStore.getState().project;
    const historyBefore = useEditorStore.getState().history.past.length;
    const serializedBefore = serializeProject(before);

    selectSection("s-hero-tree", ["h-durable"]);

    const after = useEditorStore.getState().project;
    expect(after).toBe(before); // identical reference: no project mutation
    expect(useEditorStore.getState().history.past.length).toBe(historyBefore);

    // The canonical payload is byte-identical after focusing an element, so no
    // transient selection state can reach persistence, sync, or export.
    expect(serializeProject(after)).toBe(serializedBefore);
    expect(serializedBefore).not.toContain("anchorId");
    expect(serializedBefore).not.toContain("previewRects");
  });

  it("keeps the element focus in the transient store only", () => {
    renderDesignPanel();
    selectSection("s-hero-tree", ["h-durable"]);

    // Present in the canvas interaction store...
    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(["h-durable"]);
    // ...and absent from the editor store's durable surface.
    const editorState = useEditorStore.getState() as unknown as Record<string, unknown>;
    expect(editorState.selection).toBeUndefined();
    expect(editorState.anchorId).toBeUndefined();
    expect(editorState.selectedElementId).toBeUndefined();
  });

  it("does not create a durable tree on a legacy section from a selection alone", () => {
    renderDesignPanel();
    const before = sectionToElementTree(
      useEditorStore.getState().project.pages[0].sections[0],
    );

    selectSection("s-hero-legacy", ["h-durable"]);

    const section = useEditorStore.getState().project.pages[0].sections[0];
    expect((section as { tree?: unknown }).tree).toBeUndefined();
    // The materialized projection is deterministic and unchanged.
    expect(sectionToElementTree(section)).toEqual(before);
  });
});
