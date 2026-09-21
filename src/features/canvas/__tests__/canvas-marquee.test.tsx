// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas element marquee (Phase P27 Slice 1 — decisions D1/D1b/D1c/D2)
//
// Covers:
//   - a pointer drag on the section BACKGROUND starts the marquee and selects
//     the intersecting element ids of the ACTIVE section (OQ-1 intersection
//     model), resolved through topLevelSelection (D1);
//   - the marquee never starts on an element node (the P25 producer keeps
//     precedence) and never leaks ids from another section (REQ-1);
//   - an empty marquee (click without drag) keeps the frozen P25 section-root
//     contract via onMarqueeEmpty;
//   - the marquee rectangle visual appears during the drag and clears on
//     release (D1c);
//   - marquee selection is transient: zero mutations to the project, history
//     or serialized JSON (REQ-11 / Invariant 1).
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed deterministically
// (same discipline as canvas-overlay-targeting.test.tsx).
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
import { serializeProject } from "@/features/persistence/services/project-serializer";
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

const DURABLE_ID = "s-durable";
const HEAD_A_ID = "h-head-a";
const BTN_B_ID = "b-btn-b";
const CUSTOM_ID = "s-custom";
const CUSTOM_CHILD_ID = "h-custom";

const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

/** Durable hero whose tree carries TWO nested children (marquee candidates). */
function durableHeroWithTwoChildren(id: string, order: number, headId: string, btnId: string): BaseSection {
  const nodes: Record<string, unknown> = {
    [id]: {
      id,
      type: "container",
      parentId: null,
      children: [headId, btnId],
      props: { _sectionType: "hero", _sectionId: id },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    },
    [headId]: {
      id: headId,
      type: "heading",
      parentId: id,
      children: [],
      props: { text: "Durable headline", level: 2 },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      customCode: ENABLED_CODE, // makes the section tree-path rendered (P25)
    },
    [btnId]: {
      id: btnId,
      type: "button",
      parentId: id,
      children: [],
      props: { text: "Buy", href: "#" },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
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

/** A second (custom-block) section — the marquee must never leak into it. */
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

function makeProject(): Project {
  return {
    id: "proj-p27-slice1",
    name: "P27 Slice 1",
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
          durableHeroWithTwoChildren(DURABLE_ID, 1, HEAD_A_ID, BTN_B_ID),
          customBlockSection(CUSTOM_ID, 2, CUSTOM_CHILD_ID),
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Deterministic layout stub (client coords == canvas coords at zoom 100)
// ---------------------------------------------------------------------------

type MockRect = { left: number; top: number; width: number; height: number };

const CONTENT_RECT: MockRect = { left: 0, top: 0, width: 1200, height: 900 };
const DURABLE_RECT: MockRect = { left: 100, top: 200, width: 400, height: 300 };
const HEAD_A_RECT: MockRect = { left: 140, top: 260, width: 120, height: 60 };
const BTN_B_RECT: MockRect = { left: 300, top: 300, width: 100, height: 40 };
const CUSTOM_RECT: MockRect = { left: 100, top: 550, width: 400, height: 300 };

const SECTION_IDS = new Set([DURABLE_ID, CUSTOM_ID]);

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    if (blockId === HEAD_A_ID) return HEAD_A_RECT;
    if (blockId === BTN_B_ID) return BTN_B_RECT;
    if (blockId === CUSTOM_CHILD_ID) return HEAD_A_RECT;
    // Section ROOT nodes share their section id → the container rect.
    return SECTION_IDS.has(blockId) ? DURABLE_RECT : HEAD_A_RECT;
  }
  if (element.getAttribute("data-section-id") === CUSTOM_ID) return CUSTOM_RECT;
  if (element.hasAttribute("data-section-id")) return DURABLE_RECT;
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

function sectionWrapper(sectionId: string): HTMLElement {
  const el = document.querySelector(`[data-section-id="${sectionId}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function selectionIds(): string[] {
  return useCanvasInteractionStore.getState().selection.ids;
}

function marqueeVisual(): HTMLElement | null {
  return document.querySelector('[data-testid="canvas-marquee-rect"]');
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

/** Render the harness, select the section, then drag a marquee. */
async function marqueeDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  onAfterMove?: () => void,
) {
  render(<CanvasHarness />);
  await act(async () => {
    useEditorStore.getState().selectSection(DURABLE_ID);
  });
  await flushMicrotasks();

  await act(async () => {
    fireEvent.pointerDown(sectionWrapper(DURABLE_ID), { clientX: from.x, clientY: from.y, button: 0 });
  });
  await act(async () => {
    fireEvent.pointerMove(document.body, { clientX: to.x, clientY: to.y });
  });
  onAfterMove?.();
  await act(async () => {
    fireEvent.pointerUp(document.body, { clientX: to.x, clientY: to.y });
  });
  await flushMicrotasks();
}

// ---------------------------------------------------------------------------
// Marquee selection (D1 / OQ-1 intersection model)
// ---------------------------------------------------------------------------

describe("element marquee selection (P27 Slice 1)", () => {
  it("selects BOTH intersecting elements when the marquee covers them", async () => {
    await marqueeDrag({ x: 120, y: 240 }, { x: 420, y: 350 });

    expect(selectionIds()).toEqual([HEAD_A_ID, BTN_B_ID]);
  });

  it("selects a SINGLE element when the marquee clips only it (intersection, not containment)", async () => {
    // The marquee clips HEAD_A's left edge and misses BTN_B entirely.
    await marqueeDrag({ x: 120, y: 240 }, { x: 200, y: 330 });

    expect(selectionIds()).toEqual([HEAD_A_ID]);
  });

  it("never leaks ids from another section, even when the marquee spans the canvas", async () => {
    // Spans both sections (and both section containers).
    await marqueeDrag({ x: 10, y: 10 }, { x: 1100, y: 850 });

    expect(selectionIds()).toEqual([HEAD_A_ID, BTN_B_ID]);
    expect(selectionIds()).not.toContain(DURABLE_ID); // section root excluded
    expect(selectionIds()).not.toContain(CUSTOM_ID); // other section excluded
    expect(selectionIds()).not.toContain(CUSTOM_CHILD_ID); // its elements too
  });

  it("does not start a marquee when the pointerdown hits an element (producer precedence)", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    await act(async () => {
      fireEvent.pointerDown(nodeById(HEAD_A_ID), { clientX: 150, clientY: 270, button: 0 });
    });
    // Mid-drag: no marquee visual, and the P25 producer already focused the element.
    expect(marqueeVisual()).toBeNull();
    expect(selectionIds()).toEqual([HEAD_A_ID]);

    await act(async () => {
      fireEvent.pointerMove(document.body, { clientX: 400, clientY: 400 });
      fireEvent.pointerUp(document.body, { clientX: 400, clientY: 400 });
    });
    await flushMicrotasks();

    // The drag over other elements must NOT extend the selection.
    expect(selectionIds()).toEqual([HEAD_A_ID]);
  });
});

// ---------------------------------------------------------------------------
// Empty marquee + the frozen background-click contract (OQ-1)
// ---------------------------------------------------------------------------

describe("empty marquee keeps the frozen section-root contract", () => {
  it("a click without drag selects the section root (never a stray element)", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    await act(async () => {
      fireEvent.pointerDown(sectionWrapper(DURABLE_ID), { clientX: 120, clientY: 240, button: 0 });
    });
    await act(async () => {
      fireEvent.pointerUp(document.body, { clientX: 120, clientY: 240 });
    });
    await flushMicrotasks();

    expect(selectionIds()).toEqual([DURABLE_ID]);
    expect(marqueeVisual()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Marquee visual (D1c)
// ---------------------------------------------------------------------------

describe("marquee rectangle visual (P27 D1c)", () => {
  it("appears during the drag and clears on release", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    await act(async () => {
      fireEvent.pointerDown(sectionWrapper(DURABLE_ID), { clientX: 120, y: 0, clientY: 240, button: 0 } as never);
    });
    await act(async () => {
      fireEvent.pointerMove(document.body, { clientX: 420, clientY: 350 });
    });

    const visual = marqueeVisual();
    expect(visual).toBeTruthy();
    // Logical canvas units: (120,240) → (420,350) at zoom 100.
    expect(visual!.style.left).toBe("120px");
    expect(visual!.style.top).toBe("240px");
    expect(visual!.style.width).toBe("300px");
    expect(visual!.style.height).toBe("110px");

    await act(async () => {
      fireEvent.pointerUp(document.body, { clientX: 420, clientY: 350 });
    });
    await flushMicrotasks();

    expect(marqueeVisual()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transient only (REQ-11 / Invariant 1)
// ---------------------------------------------------------------------------

describe("marquee selection stays transient (P27 REQ-11)", () => {
  it("produces zero mutations in the project, history or serialized JSON", async () => {
    render(<CanvasHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(DURABLE_ID);
    });
    await flushMicrotasks();

    const before = useEditorStore.getState().project;
    const historyBefore = useEditorStore.getState().history.past.length;
    const serializedBefore = serializeProject(before);

    await marqueeDrag({ x: 120, y: 240 }, { x: 420, y: 350 });

    expect(selectionIds()).toEqual([HEAD_A_ID, BTN_B_ID]);
    // Identical reference: no project mutation, no history entry.
    expect(useEditorStore.getState().project).toBe(before);
    expect(useEditorStore.getState().history.past.length).toBe(historyBefore);
    // Byte-identical canonical payload: nothing transient can reach persistence.
    expect(serializeProject(useEditorStore.getState().project)).toBe(serializedBefore);

    const editorState = useEditorStore.getState() as unknown as Record<string, unknown>;
    expect(editorState.selection).toBeUndefined();
    expect(editorState.anchorId).toBeUndefined();
    expect(editorState.selectedElementId).toBeUndefined();
    expect(editorState.marquee).toBeUndefined();
  });
});
