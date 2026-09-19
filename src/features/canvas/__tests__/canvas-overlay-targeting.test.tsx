// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas overlay targeting (Phase P25, Slice 3 — decisions D6 / REQ-4 / S3)
//
// Covers:
//   - a single nested element focus measures/positions the bounding box and the
//     8 resize + rotation handles on the ELEMENT's DOM node, not the outer
//     section container;
//   - clearing the nested focus restores the box to the section boundary;
//   - a transform gesture on a nested element writes `node.geometry` on the
//     owning section's durable tree and records exactly ONE history entry.
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed deterministically:
// section containers and nested element nodes get distinct rects, which is what
// lets the assertions prove WHICH DOM node was measured.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useRef } from "react";
import { render, act, fireEvent } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
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
import { SectionRenderer } from "@/features/editor/renderer/SectionRenderer";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";
import { CanvasManipulationLayer } from "../components/CanvasManipulationLayer";

// jsdom does not implement CSS.escape, used to build `[data-section-id]` selectors.
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

const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

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

function makeProject(): Project {
  return {
    id: "proj-p25-slice3",
    name: "P25 Slice 3",
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
          durableHeroSection(DURABLE_ID, 1, DURABLE_CODE_ID),
          customBlockSection(CUSTOM_ID, 2, CUSTOM_CHILD_ID),
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Deterministic layout stub
// ---------------------------------------------------------------------------

type MockRect = { left: number; top: number; width: number; height: number };

const CONTENT_RECT: MockRect = { left: 0, top: 0, width: 1200, height: 900 };
const SECTION_RECT: MockRect = { left: 100, top: 200, width: 400, height: 300 };
const ELEMENT_RECT: MockRect = { left: 140, top: 260, width: 120, height: 60 };

const SECTION_IDS = new Set([CUSTOM_ID, DURABLE_ID]);

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    // The section ROOT node shares its section id → use the container rect.
    return SECTION_IDS.has(blockId) ? SECTION_RECT : ELEMENT_RECT;
  }
  if (element.hasAttribute("data-section-id")) return SECTION_RECT;
  return { left: 0, top: 0, width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Harness
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

function selectionBox(): HTMLElement {
  const el = document.querySelector('[data-testid="canvas-selection-box"]');
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

/** Select the section, then focus a nested element node via the producer. */
async function selectSectionWithElement(sectionId: string, elementId?: string) {
  await act(async () => {
    useEditorStore.getState().selectSection(sectionId);
  });
  await flushMicrotasks();
  if (elementId) {
    await act(async () => {
      fireEvent.pointerDown(nodeById(elementId));
    });
    await flushMicrotasks();
  }
}

let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  rectSpy = vi
    .spyOn(Element.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: Element) {
      const r = rectFor(this);
      return {
        x: r.left,
        y: r.top,
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        right: r.left + r.width,
        bottom: r.top + r.height,
        toJSON: () => ({}),
      } as DOMRect;
    });

  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  sectionRegistry.registerAll([
    ["hero", HeroSection],
    [CUSTOM_BLOCK_SECTION_TYPE, CustomBlockSection],
  ]);

  useEditorStore.getState().initProject(makeProject());
  useEditorStore.getState().setDirty(false);
  useCanvasInteractionStore.getState().reset();
});

afterEach(() => {
  rectSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Bounding box targeting
// ---------------------------------------------------------------------------

describe("overlay bounding box targets the focused element (P25 D6/S3)", () => {
  it("frames the element's DOM node, not the outer section", async () => {
    render(<CanvasHarness />);
    await selectSectionWithElement(CUSTOM_ID, CUSTOM_CHILD_ID);

    const box = selectionBox();
    expect(box.getAttribute("data-element-id")).toBe(CUSTOM_CHILD_ID);
    expect(box.style.left).toBe("140px");
    expect(box.style.top).toBe("260px");
    expect(box.style.width).toBe("120px");
    expect(box.style.height).toBe("60px");
    // Explicitly NOT the section container rect.
    expect(box.style.width).not.toBe("400px");
    expect(box.style.left).not.toBe("100px");

    // The 8 resize handles + rotation handle are rendered around the element.
    for (const handle of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
      expect(document.querySelector(`[data-testid="canvas-resize-handle-${handle}"]`)).toBeTruthy();
    }
    expect(document.querySelector('[data-testid="canvas-rotate-handle"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="canvas-selection-dims"]')?.textContent).toContain(
      "120 × 60",
    );
  });

  it("frames a nested element in a durable non-custom-block section too", async () => {
    render(<CanvasHarness />);
    await selectSectionWithElement(DURABLE_ID, DURABLE_CODE_ID);

    const box = selectionBox();
    expect(box.getAttribute("data-element-id")).toBe(DURABLE_CODE_ID);
    expect(box.style.left).toBe("140px");
    expect(box.style.width).toBe("120px");
  });

  it("restores the box to the section boundary when the nested focus is cleared", async () => {
    render(<CanvasHarness />);
    await selectSectionWithElement(CUSTOM_ID, CUSTOM_CHILD_ID);
    expect(selectionBox().style.width).toBe("120px");

    // Clicking the section background clears the element focus (D3).
    const wrapper = document.querySelector(`[data-section-id="${CUSTOM_ID}"]`);
    expect(wrapper).toBeTruthy();
    await act(async () => {
      fireEvent.pointerDown(wrapper as HTMLElement);
    });
    await flushMicrotasks();

    const box = selectionBox();
    expect(box.getAttribute("data-element-id")).toBe(CUSTOM_ID);
    expect(box.style.left).toBe("100px");
    expect(box.style.top).toBe("200px");
    expect(box.style.width).toBe("400px");
    expect(box.style.height).toBe("300px");
  });
});

// ---------------------------------------------------------------------------
// Nested transform commits
// ---------------------------------------------------------------------------

describe("nested transform commits (P25 REQ-4)", () => {
  it("writes node.geometry on the section's durable tree with ONE history entry", async () => {
    render(<CanvasHarness />);
    await selectSectionWithElement(DURABLE_ID, DURABLE_CODE_ID);
    // Deterministic geometry: no snap adjustments during the drag.
    useCanvasInteractionStore.getState().setSnapEnabled(false);

    const handle = document.querySelector('[data-testid="canvas-resize-handle-se"]');
    expect(handle).toBeTruthy();
    const historyBefore = useEditorStore.getState().history.past.length;

    // Resize the nested element by +50 × +30 logical px (zoom 100).
    await act(async () => {
      fireEvent.pointerDown(handle as HTMLElement, { clientX: 200, clientY: 300 });
      fireEvent.pointerMove(handle as HTMLElement, { clientX: 250, clientY: 330 });
      fireEvent.pointerUp(handle as HTMLElement, { clientX: 250, clientY: 330 });
    });
    await flushMicrotasks();

    expect(useEditorStore.getState().history.past.length).toBe(historyBefore + 1);

    const section = useEditorStore
      .getState()
      .project.pages[0].sections.find((s) => s.id === DURABLE_ID) as { tree?: ElementTree };
    const geometry = section.tree?.nodes[DURABLE_CODE_ID]?.geometry;
    expect(geometry).toMatchObject({ width: 170, height: 90, x: 140, y: 260 });
    // The owning section root is untouched by an element gesture.
    expect(section.tree?.nodes[DURABLE_ID]?.geometry).toBeUndefined();
  });

  it("writes nested geometry into a custom-block's persisted tree as one entry", async () => {
    render(<CanvasHarness />);
    await selectSectionWithElement(CUSTOM_ID, CUSTOM_CHILD_ID);
    useCanvasInteractionStore.getState().setSnapEnabled(false);

    const handle = document.querySelector('[data-testid="canvas-resize-handle-se"]') as HTMLElement;
    const historyBefore = useEditorStore.getState().history.past.length;

    await act(async () => {
      fireEvent.pointerDown(handle, { clientX: 200, clientY: 300 });
      fireEvent.pointerMove(handle, { clientX: 240, clientY: 320 });
      fireEvent.pointerUp(handle, { clientX: 240, clientY: 320 });
    });
    await flushMicrotasks();

    expect(useEditorStore.getState().history.past.length).toBe(historyBefore + 1);

    const section = useEditorStore
      .getState()
      .project.pages[0].sections.find((s) => s.id === CUSTOM_ID);
    const tree = section?.props.tree as { nodes: Record<string, { geometry?: unknown }> };
    expect(tree.nodes[CUSTOM_CHILD_ID]?.geometry).toMatchObject({ width: 160, height: 80 });
  });
});
