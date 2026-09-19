// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas nested element selection producer (Phase P25, Slice 2)
//
// Covers §2.3 F1 / decisions D3 (producer + precedence) and D6/S3
// (manipulable), plus REQ-9 (selection stays transient):
//   - a pointerdown on a nested element node focuses THAT element id
//   - a pointerdown on the section ROOT node / background mirrors the section
//     root
//   - clicking an element in another section activates the owning section
//   - the section-sync effect yields to an active nested element focus, so a
//     section/tree re-render can never clobber the element the inspector shows
//   - switching `selectedSectionId` re-syncs the transient selection
//   - focusing an element never touches the project, history or serialized JSON
//   - transform handles survive a nested element focus (no R3 regression) and
//     are available for durable non-custom-block sections (D6)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useRef } from "react";
import { render, act, fireEvent, screen } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import { useCanvasInteractionStore } from "@/features/canvas/store/canvas-interaction-store";
import {
  registerDefaultBlocks,
  isDefaultBlocksRegistered,
} from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { HeroSection } from "@/features/editor/sections/HeroSection";
import { CustomBlockSection } from "@/features/editor/sections/CustomBlockSection";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { serializeProject } from "@/features/persistence/services/project-serializer";
import { SectionRenderer } from "@/features/editor/renderer/SectionRenderer";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";
import { RightSidebar } from "@/components/editor/RightSidebar";
import { CanvasManipulationLayer } from "../components/CanvasManipulationLayer";

// jsdom does not implement CSS.escape, which CanvasManipulationLayer uses to
// build its `[data-section-id]` selectors. The section ids in these fixtures
// are plain, so an identity polyfill is sufficient (prod code untouched).
if (typeof globalThis.CSS === "undefined") {
  (globalThis as unknown as { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value: string) => value,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CUSTOM_ID = "s-custom";
const CUSTOM_CHILD_ID = "h-custom";
const DURABLE_ID = "s-durable";
const DURABLE_CODE_ID = "h-durable-code";
const LEGACY_ID = "s-legacy";

/** Valid, explicitly enabled payload (the export/canvas emission gate). */
const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

/** A custom-block section whose durable build tree lives in `props.tree`. */
function customBlockSection(id: string, order: number, childId: string): BaseSection {
  return {
    id,
    type: CUSTOM_BLOCK_SECTION_TYPE,
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
            children: [childId],
            props: {},
            style: {},
            responsive: {},
            visible: true,
            locked: false,
            hidden: false,
          },
          [childId]: {
            id: childId,
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
  } as unknown as BaseSection;
}

/** A regular hero section with a durable element tree (P24-B) rendered as a tree. */
function durableHeroSection(id: string, order: number, codeChildId: string): BaseSection {
  const nodes: Record<string, unknown> = {
    [id]: {
      id,
      type: "container",
      parentId: null,
      children: [codeChildId],
      props: { _sectionType: "hero", _sectionId: id },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    },
    [codeChildId]: {
      id: codeChildId,
      type: "heading",
      parentId: id,
      children: [],
      props: { text: "Durable headline", level: 2 },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      customCode: ENABLED_CODE,
    },
  };
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
    tree: { rootIds: [id], nodes } as ElementTree,
  } as unknown as BaseSection;
}

/** A legacy props-driven hero (no durable tree). */
function legacyHeroSection(id: string, order: number): BaseSection {
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

function makeProject(): Project {
  return {
    id: "proj-p25-slice2",
    name: "P25 Slice 2",
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
          legacyHeroSection(LEGACY_ID, 1),
          durableHeroSection(DURABLE_ID, 2, DURABLE_CODE_ID),
          customBlockSection(CUSTOM_ID, 3, CUSTOM_CHILD_ID),
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Harness — the real canvas render surface + the manipulation layer
// ---------------------------------------------------------------------------

function CanvasHarness() {
  const contentRef = useRef<HTMLDivElement>(null);
  const sections = useEditorStore((s) => s.project.pages[0].sections);
  return (
    <div ref={contentRef} data-testid="preview-content">
      <SectionRenderer sections={sections} pageId="page-1" />
      <CanvasManipulationLayer contentRef={contentRef} />
    </div>
  );
}

/**
 * The real canvas render surface + manipulation layer + the right sidebar, so
 * a canvas click can be observed end-to-end through P24-C's inspector routing.
 */
function CanvasAndInspectorHarness() {
  const contentRef = useRef<HTMLDivElement>(null);
  const sections = useEditorStore((s) => s.project.pages[0].sections);
  return (
    <div>
      <div ref={contentRef} data-testid="preview-content">
        <SectionRenderer sections={sections} pageId="page-1" />
        <CanvasManipulationLayer contentRef={contentRef} />
      </div>
      <RightSidebar />
    </div>
  );
}

/** Flush the component's queued microtask effects inside `act`. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function nodeById(blockId: string): HTMLElement {
  const el = document.querySelector(`[data-block-id="${blockId}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function selectionIds(): string[] {
  return useCanvasInteractionStore.getState().selection.ids;
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  sectionRegistry.registerAll([
    ["hero", HeroSection],
    [CUSTOM_BLOCK_SECTION_TYPE, CustomBlockSection],
  ]);

  useEditorStore.getState().initProject(makeProject());
  useEditorStore.getState().setDirty(false);
  useCanvasInteractionStore.getState().reset();
  useEditorUiStore.setState({
    ...useEditorUiStore.getState(),
    rightPanelCollapsed: false,
  });
});

// ---------------------------------------------------------------------------
// Producer
// ---------------------------------------------------------------------------

describe("nested element selection producer (P25 D3)", () => {
  it("focuses the nested element a pointerdown hits in a durable tree section", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
      useCanvasInteractionStore.getState().setSelection([DURABLE_ID], {
        multi: false,
        anchorId: DURABLE_ID,
      });
    });

    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_CODE_ID));
    });

    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
  });

  it("activates the owning section and focuses its element in one gesture", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(LEGACY_ID);
    });

    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_CODE_ID));
    });
    await flushMicrotasks();

    expect(useEditorStore.getState().selectedSectionId).toBe(DURABLE_ID);
    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
  });

  it("keeps the section root selected for legacy custom-block clicks (frozen contract)", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(CUSTOM_ID);
      useCanvasInteractionStore.getState().setSelection([CUSTOM_ID], {
        multi: false,
        anchorId: CUSTOM_ID,
      });
    });

    await act(async () => {
      fireEvent.pointerDown(nodeById(CUSTOM_CHILD_ID));
    });

    // D3 scopes the nested write to non-custom-block sections (the build tree
    // remains custom-block's element-selection surface, P22-C).
    expect(selectionIds()).toEqual([CUSTOM_ID]);
  });

  it("selects the section root when the section ROOT node is hit", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
      useCanvasInteractionStore.getState().setSelection([DURABLE_CODE_ID], {
        multi: false,
        anchorId: DURABLE_CODE_ID,
      });
    });

    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_ID));
    });

    expect(selectionIds()).toEqual([DURABLE_ID]);
  });

  it("selects the section root when the section background is hit", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
      useCanvasInteractionStore.getState().setSelection([DURABLE_CODE_ID], {
        multi: false,
        anchorId: DURABLE_CODE_ID,
      });
    });

    const wrapper = document.querySelector(`[data-section-id="${DURABLE_ID}"]`);
    expect(wrapper).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(wrapper as HTMLElement);
    });

    expect(selectionIds()).toEqual([DURABLE_ID]);
  });

  it("never rewrites the selection when the manipulation overlay is pressed", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
      useCanvasInteractionStore.getState().setSelection([DURABLE_CODE_ID], {
        multi: false,
        anchorId: DURABLE_CODE_ID,
      });
    });
    await flushMicrotasks();

    const overlay = document.querySelector('[data-testid="canvas-selection-box"]');
    expect(overlay).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(overlay as HTMLElement);
    });

    // The handle/box pointerdown must not reset the focused element.
    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
  });
});

// ---------------------------------------------------------------------------
// Sync precedence (D3)
// ---------------------------------------------------------------------------

describe("section-sync precedence (P25 D3)", () => {
  it("does not overwrite an active nested element focus within the same section", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
      useCanvasInteractionStore.getState().setSelection([DURABLE_CODE_ID], {
        multi: false,
        anchorId: DURABLE_CODE_ID,
      });
    });
    await flushMicrotasks();
    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);

    // A project/tree update re-runs the sync effect — the element focus wins.
    await act(async () => {
      useEditorStore.getState().updateSectionStyles(DURABLE_ID, { paddingTop: "4px" });
    });
    await flushMicrotasks();

    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
  });

  it("re-syncs the transient selection when the active section genuinely changes", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(CUSTOM_ID);
      useCanvasInteractionStore.getState().setSelection([CUSTOM_ID], {
        multi: false,
        anchorId: CUSTOM_ID,
      });
    });
    await flushMicrotasks();
    expect(selectionIds()).toEqual([CUSTOM_ID]);

    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    expect(selectionIds()).toEqual([DURABLE_ID]);
  });

  it("re-syncs to the new section even while a nested element of the old one is focused", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_CODE_ID));
    });
    await flushMicrotasks();
    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);

    await act(async () => {
      useEditorStore.getState().selectSection(CUSTOM_ID);
    });
    await flushMicrotasks();

    expect(selectionIds()).toEqual([CUSTOM_ID]);
  });

  it("clears the transient selection when the section selection is cleared", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
      useCanvasInteractionStore.getState().setSelection([DURABLE_CODE_ID], {
        multi: false,
        anchorId: DURABLE_CODE_ID,
      });
    });
    await flushMicrotasks();

    await act(async () => {
      useEditorStore.getState().clearSelection();
    });
    await flushMicrotasks();

    expect(selectionIds()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Transient only — REQ-9
// ---------------------------------------------------------------------------

describe("element focus stays transient (P25 REQ-9)", () => {
  it("produces zero mutations in the project, history or serialized JSON", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    const before = useEditorStore.getState().project;
    const historyBefore = useEditorStore.getState().history.past.length;
    const serializedBefore = serializeProject(before);

    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_CODE_ID));
    });

    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
    // Identical reference: no project mutation, no history entry.
    expect(useEditorStore.getState().project).toBe(before);
    expect(useEditorStore.getState().history.past.length).toBe(historyBefore);
    // Byte-identical canonical payload: nothing transient can reach persistence.
    expect(serializeProject(useEditorStore.getState().project)).toBe(serializedBefore);

    const editorState = useEditorStore.getState() as unknown as Record<string, unknown>;
    expect(editorState.selection).toBeUndefined();
    expect(editorState.anchorId).toBeUndefined();
    expect(editorState.selectedElementId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration with P24-C inspector routing (Slice 2 task 2)
// ---------------------------------------------------------------------------

describe("canvas click → universal inspector routing (P24-C integration)", () => {
  it("mounts ElementInspectorPanel for the element a canvas click focused, with Custom Code", async () => {
    useEditorUiStore.setState({
      ...useEditorUiStore.getState(),
      rightPanelCollapsed: false,
      rightSidebarTab: "design",
    });
    render(<CanvasAndInspectorHarness />);

    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    // The click (not a direct store write) is what produces the nested focus.
    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_CODE_ID));
    });
    await flushMicrotasks();

    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
    expect(screen.getByTestId("element-inspector")).toBeTruthy();
    expect(screen.getByTestId("element-inspector-title").textContent).toBe("Heading");
    // The targeted element is a renderable type, so the Custom Code group is offered.
    expect(screen.getByTestId("inspector-section-custom-code")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Manipulable re-expression (P25 D6 / S3)
// ---------------------------------------------------------------------------

describe("durable-geometry handles (P25 D6/S3)", () => {
  const HANDLE = '[data-testid="canvas-resize-handle-se"]';

  it("keeps handles for a custom-block section (legacy selection unchanged)", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(CUSTOM_ID);
      useCanvasInteractionStore.getState().setSelection([CUSTOM_ID], {
        multi: false,
        anchorId: CUSTOM_ID,
      });
    });
    await flushMicrotasks();
    expect(document.querySelector(HANDLE)).toBeTruthy();

    await act(async () => {
      fireEvent.pointerDown(nodeById(CUSTOM_CHILD_ID));
    });
    await flushMicrotasks();

    // Legacy custom-block keeps its root selection, and the handle gate no
    // longer depends on selection membership (R3).
    expect(selectionIds()).toEqual([CUSTOM_ID]);
    expect(document.querySelector(HANDLE)).toBeTruthy();
  });

  it("keeps handles while a nested element of a durable section is focused", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();
    expect(document.querySelector(HANDLE)).toBeTruthy();

    await act(async () => {
      fireEvent.pointerDown(nodeById(DURABLE_CODE_ID));
    });
    await flushMicrotasks();

    // Dropping the selection-membership clause is what keeps this true (R3).
    expect(selectionIds()).toEqual([DURABLE_CODE_ID]);
    expect(document.querySelector(HANDLE)).toBeTruthy();
  });

  it("renders handles for a durable non-custom-block section", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    expect(document.querySelector(HANDLE)).toBeTruthy();
  });

  it("does not render handles for a legacy non-durable section (unchanged)", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(LEGACY_ID);
    });
    await flushMicrotasks();

    expect(document.querySelector(HANDLE)).toBeNull();
  });
});
