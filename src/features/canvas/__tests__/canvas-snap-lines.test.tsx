// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas visual snap guides (Phase P27 Slice 3 — D5/D6, REQ-4/REQ-7/REQ-9/REQ-11)
//
// Covers, through the REAL CanvasManipulationLayer → useCanvasManipulation →
// editor-store stack:
//   - snap guide lines RENDER during an active drag when the 8px threshold is
//     met (single-element drag aligned with an unselected sibling);
//   - a multi-element batch drag surfaces the COMPOSITE box's snap line
//     (D5/OQ-1c) when the dragged set aligns with an unselected sibling, and
//     every element is translated by the SAME snapped delta;
//   - NO guides render when nothing is within the threshold, when snapping is
//     toggled off (REQ-7) or when the session is not a move (resize);
//   - guides CLEAR on gesture completion (pointerup) — REQ-4;
//   - guides are transient: zero project mutation / history entries while
//     dragging (REQ-11), and the snapped commit is still ONE history entry.
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed deterministically
// (same discipline as canvas-batch-drag.test.tsx).
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
import { SectionRenderer } from "@/features/editor/renderer/SectionRenderer";
import { serializeProject } from "@/features/persistence/services/project-serializer";
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
// Fixtures (identical shape to canvas-batch-drag.test.tsx)
// ---------------------------------------------------------------------------

const PAGE_ID = "page-1";
const HERO_ID = "s-hero";
const HEAD_A_ID = "h-head-a";
const BTN_B_ID = "b-btn-b";

const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

function durableHeroWithTwoChildren(): BaseSection {
  const nodes: Record<string, unknown> = {
    [HERO_ID]: {
      id: HERO_ID,
      type: "container",
      parentId: null,
      children: [HEAD_A_ID, BTN_B_ID],
      props: { _sectionType: "hero", _sectionId: HERO_ID },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    },
    [HEAD_A_ID]: {
      id: HEAD_A_ID,
      type: "heading",
      parentId: HERO_ID,
      children: [],
      props: { text: "Durable headline", level: 2 },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      customCode: ENABLED_CODE, // makes the section tree-path rendered (P25)
    },
    [BTN_B_ID]: {
      id: BTN_B_ID,
      type: "button",
      parentId: HERO_ID,
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
    id: HERO_ID,
    type: "hero",
    order: 1,
    visible: true,
    props: {
      headline: "Durable headline",
      subheadline: "",
      primaryCta: { text: "Go", href: "#" },
    },
    styles: {},
    tree: { rootIds: [HERO_ID], nodes } as ElementTree,
  } as unknown as BaseSection;
}

function makeProject(): Project {
  return {
    id: "proj-p27-slice3",
    name: "P27 Slice 3",
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
        id: PAGE_ID,
        title: "Home",
        slug: "/",
        sections: [durableHeroWithTwoChildren()],
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

// HEAD_A at (140,260,120×60); BTN_B (the unselected sibling) at (300,300,100×40);
// the hero section container at (100,200,400×300); viewport 1200×900.
const CONTENT_RECT: MockRect = { left: 0, top: 0, width: 1200, height: 900 };
const HERO_RECT: MockRect = { left: 100, top: 200, width: 400, height: 300 };
const HEAD_A_RECT: MockRect = { left: 140, top: 260, width: 120, height: 60 };
const BTN_B_RECT: MockRect = { left: 300, top: 300, width: 100, height: 40 };

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    if (blockId === HEAD_A_ID) return HEAD_A_RECT;
    if (blockId === BTN_B_ID) return BTN_B_RECT;
    return HERO_RECT;
  }
  if (element.hasAttribute("data-section-id")) return HERO_RECT;
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
      <SectionRenderer sections={sections} pageId={PAGE_ID} />
      <CanvasManipulationLayer contentRef={contentRef} />
    </div>
  );
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

function query(testId: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testId}"]`);
}

function queryAllSnapLines(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-testid="canvas-snap-guide-line"]'));
}

async function renderAndSelectSection() {
  render(<CanvasHarness />);
  await act(async () => {
    useEditorStore.getState().selectSection(HERO_ID);
  });
  await flushMicrotasks();
}

async function selectIds(ids: string[]) {
  await act(async () => {
    useCanvasInteractionStore.getState().setSelection(ids, {
      multi: ids.length > 1,
      anchorId: ids[0],
    });
  });
  await flushMicrotasks();
}

function moveHandle(): HTMLElement {
  const el = query("canvas-move-handle");
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

/**
 * Drag the current selection's move affordance from `from` to `to` with
 * snapping LEFT ENABLED (unlike the Slice 2 helper — snapping is the feature
 * under test here). `onDragged` runs after the pointermove while the gesture
 * is still ACTIVE (guides, if any, must be visible at that point).
 */
async function dragWithSnap(
  from: { x: number; y: number },
  to: { x: number; y: number },
  onDragged?: () => void,
) {
  await act(async () => {
    fireEvent.pointerDown(moveHandle(), { clientX: from.x, clientY: from.y, button: 0 });
  });
  await act(async () => {
    fireEvent.pointerMove(document.body, { clientX: to.x, clientY: to.y });
  });
  onDragged?.();
  await act(async () => {
    fireEvent.pointerUp(document.body, { clientX: to.x, clientY: to.y });
  });
}

/** Current durable geometry map of the hero's tree (post-merge). */
function projectGeometry(): Record<string, Record<string, unknown>> {
  const section = useEditorStore
    .getState()
    .project.pages.find((p) => p.id === PAGE_ID)
    ?.sections.find((s) => s.id === HERO_ID);
  const tree = section?.tree as ElementTree | undefined;
  const out: Record<string, Record<string, unknown>> = {};
  if (!tree) return out;
  for (const [id, node] of Object.entries(tree.nodes)) {
    out[id] = (node.geometry ?? {}) as Record<string, unknown>;
  }
  return out;
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
  sectionRegistry.registerAll([["hero", HeroSection]]);

  useEditorStore.getState().initProject(makeProject());
  useEditorStore.getState().setDirty(false);
  useCanvasInteractionStore.getState().reset();
  // Snapping is the feature under test — keep the default (enabled, 8px).
  useCanvasInteractionStore.getState().setSnapEnabled(true);
});

afterEach(() => {
  rectSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Guides render during an active single-element drag (D5/REQ-4)
// ---------------------------------------------------------------------------

describe("visual snap guides during a single-element drag (P27 Slice 3, D5)", () => {
  it("renders a horizontal line where the dragged top edge aligns with the sibling's top edge", async () => {
    await renderAndSelectSection();
    await selectIds([HEAD_A_ID]);

    // Drag HEAD_A by (+100, +36): raw top edge lands at 296 → within the 8px
    // threshold of BTN_B's top edge (300) → snaps to 300. No x-axis target is
    // within threshold (the box's center-x lands exactly ON 300 → delta 0,
    // which is not a snap), so exactly ONE guide line is expected.
    let sawGuides = false;
    await dragWithSnap({ x: 150, y: 280 }, { x: 250, y: 316 }, () => {
      sawGuides = true;
      const container = query("canvas-snap-guides");
      expect(container).toBeTruthy();
      const lines = queryAllSnapLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].getAttribute("data-guide-axis")).toBe("y");
      expect(lines[0].getAttribute("data-guide-value")).toBe("300");
      // Span: BTN_B (300..400) shares the aligned y=300 (it IS the snap
      // target), so the horizontal line stretches from the dragged box's left
      // (240) to BTN_B's right (400). The hero container does NOT share
      // y=300 (its top is 200), so it never enters the span.
      expect(Number(lines[0].getAttribute("data-guide-span-start"))).toBe(240);
      expect(Number(lines[0].getAttribute("data-guide-span-end"))).toBe(400);
      // Overlay chrome never intercepts pointers (REQ-12).
      expect(container!.className).toContain("pointer-events-none");
    });
    expect(sawGuides).toBe(true);

    // Guides CLEAR on gesture completion (REQ-4).
    expect(query("canvas-snap-guides")).toBeNull();

    // The snapped position committed: top = 300 (raw was 296).
    expect(projectGeometry()[HEAD_A_ID]).toMatchObject({ x: 240, y: 300 });
    expect(useEditorStore.getState().history.past).toHaveLength(1);
  });

  it("renders no guides when no candidate is within the threshold", async () => {
    await renderAndSelectSection();
    await selectIds([HEAD_A_ID]);

    let dragWasActive = false;
    await dragWithSnap({ x: 150, y: 280 }, { x: 350, y: 480 }, () => {
      dragWasActive = useCanvasInteractionStore.getState().previewRects !== null;
      expect(query("canvas-snap-guides")).toBeNull();
    });
    // The gesture really ran (preview published) — guides are absent because
    // nothing aligned, not because the drag was inert.
    expect(dragWasActive).toBe(true);
    expect(query("canvas-snap-guides")).toBeNull();
  });

  it("renders no guides while snapping is toggled off (REQ-7) and commits the raw delta", async () => {
    await renderAndSelectSection();
    await selectIds([HEAD_A_ID]);
    useCanvasInteractionStore.getState().setSnapEnabled(false);

    let dragWasActive = false;
    await dragWithSnap({ x: 150, y: 280 }, { x: 250, y: 316 }, () => {
      // Same delta as the snapping test above — but the toggle hides guides
      // AND disables the snap itself.
      dragWasActive = useCanvasInteractionStore.getState().previewRects !== null;
      expect(query("canvas-snap-guides")).toBeNull();
    });
    expect(dragWasActive).toBe(true);
    expect(projectGeometry()[HEAD_A_ID]).toMatchObject({ x: 240, y: 296 });
  });

  it("renders no guides during a resize session (REQ-4: move sessions only)", async () => {
    await renderAndSelectSection();
    await selectIds([HEAD_A_ID]);

    const handle = query("canvas-resize-handle-se");
    expect(handle).toBeTruthy();
    let dragWasActive = false;
    await act(async () => {
      fireEvent.pointerDown(handle as HTMLElement, { clientX: 260, clientY: 320, button: 0 });
    });
    await act(async () => {
      fireEvent.pointerMove(document.body, { clientX: 265, clientY: 326 });
    });
    dragWasActive = useCanvasInteractionStore.getState().session?.kind === "resize";
    expect(dragWasActive).toBe(true);
    expect(query("canvas-snap-guides")).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(document.body, { clientX: 265, clientY: 326 });
    });
    expect(query("canvas-snap-guides")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Composite batch drag surfaces the composite box's snap line (D5/OQ-1c)
// ---------------------------------------------------------------------------

describe("composite batch drag snap lines (P27 Slice 3, D5/OQ-1c)", () => {
  it("surfaces the composite box's alignment with an unselected sibling and moves every element by the SAME snapped delta", async () => {
    await renderAndSelectSection();
    await selectIds([HEAD_A_ID, BTN_B_ID]);

    // Composite start box: union of HEAD_A (140,260,120×60) and BTN_B
    // (300,300,100×40) = (140,260,260×80). Drag by (−44, 0): the box's LEFT
    // edge lands at 96 → snaps to the hero container's left edge (100). The
    // box's right edge (356) is 6 from BTN_B's right (350) — farther than the
    // left candidate (4), so the left-edge match wins.
    let sawGuides = false;
    await dragWithSnap({ x: 150, y: 280 }, { x: 106, y: 280 }, () => {
      sawGuides = true;
      const lines = queryAllSnapLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].getAttribute("data-guide-axis")).toBe("x");
      expect(lines[0].getAttribute("data-guide-value")).toBe("100");
      // Span: the hero container shares x=100, so the vertical line stretches
      // from the container's top (200) to its bottom (500), covering the
      // dragged composite box (y 260..340).
      expect(Number(lines[0].getAttribute("data-guide-span-start"))).toBe(200);
      expect(Number(lines[0].getAttribute("data-guide-span-end"))).toBe(500);

      // Every element of the set carries the SAME snapped delta (−40, 0) —
      // the composite match is applied to the whole batch (D3b + OQ-1c).
      const previews = useCanvasInteractionStore.getState().previewRects;
      expect(previews?.[HEAD_A_ID]).toMatchObject({ x: 100, y: 260 });
      expect(previews?.[BTN_B_ID]).toMatchObject({ x: 260, y: 300 });
    });
    expect(sawGuides).toBe(true);

    // Guides clear on completion; the snapped positions commit as ONE entry.
    expect(query("canvas-snap-guides")).toBeNull();
    const geom = projectGeometry();
    expect(geom[HEAD_A_ID]).toMatchObject({ x: 100, y: 260 });
    expect(geom[BTN_B_ID]).toMatchObject({ x: 260, y: 300 });
    expect(useEditorStore.getState().history.past).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Transient invariant (REQ-11): dragging never touches durable state
// ---------------------------------------------------------------------------

describe("snap-guide drag transient invariant (P27 Slice 3, REQ-11)", () => {
  it("mutates no project state and pushes no history while a snap guide is visible", async () => {
    await renderAndSelectSection();
    await selectIds([HEAD_A_ID]);

    await act(async () => {
      fireEvent.pointerDown(moveHandle(), { clientX: 150, clientY: 280, button: 0 });
    });
    await act(async () => {
      fireEvent.pointerMove(document.body, { clientX: 250, clientY: 316 });
    });

    // Mid-drag: guides visible, but the durable side is untouched.
    expect(query("canvas-snap-guides")).toBeTruthy();
    const editorBefore = useEditorStore.getState();
    const serializedBefore = serializeProject(editorBefore.project);
    expect(useEditorStore.getState().history.past).toHaveLength(0);
    expect(useEditorStore.getState().project).toBe(editorBefore.project);

    await act(async () => {
      fireEvent.pointerUp(document.body, { clientX: 250, clientY: 316 });
    });

    // Only the final commit writes — exactly one entry; serialization of the
    // committed project differs from the pre-drag one ONLY by the geometry.
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    const after = serializeProject(useEditorStore.getState().project);
    expect(after).not.toBe(serializedBefore);
    expect(after).toContain("\"x\":240");
  });
});
