// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas batch drag + composite bounding box (Phase P27 Slice 2 — D4/D5/D7)
//
// Covers, through the REAL CanvasManipulationLayer → useCanvasManipulation →
// editor-store stack:
//   - the composite union bounding box renders for a multi-selection, with the
//     count/dimensions chip; the single-element box (handles + dims chip) is
//     byte-identical (D7);
//   - dragging the composite box translates every top-level selected element
//     by the SAME pointer delta (D3) and commits through commitElementTree as
//     exactly ONE history entry (D5 / Invariant 2);
//   - children of a selected container are NEVER double-translated
//     (topLevelSelection gesture filtering, D3);
//   - flow-mode elements keep their mode and take ONLY an x/y offset
//     (OQ-6 — responsive invariants hold, no mode flip).
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed deterministically
// (same discipline as canvas-marquee.test.tsx).
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

const PAGE_ID = "page-1";
const HERO_ID = "s-hero";
const ROOT_ID = HERO_ID;
const HEAD_A_ID = "h-head-a";
const BTN_B_ID = "b-btn-b";

const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

/** Durable hero whose tree carries TWO nested children (batch candidates). */
function durableHeroWithTwoChildren(
  id: string,
  headId: string,
  btnId: string,
  flowBtn = false,
): BaseSection {
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
      ...(flowBtn ? { geometry: { mode: "flow", x: 0, y: 0 } } : {}),
    },
  };
  return {
    id,
    type: "hero",
    order: 1,
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

function makeProject(flowBtn = false): Project {
  return {
    id: "proj-p27-slice2",
    name: "P27 Slice 2",
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
        sections: [durableHeroWithTwoChildren(HERO_ID, HEAD_A_ID, BTN_B_ID, flowBtn)],
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
const HERO_RECT: MockRect = { left: 100, top: 200, width: 400, height: 300 };
const HEAD_A_RECT: MockRect = { left: 140, top: 260, width: 120, height: 60 };
const BTN_B_RECT: MockRect = { left: 300, top: 300, width: 100, height: 40 };

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    if (blockId === HEAD_A_ID) return HEAD_A_RECT;
    if (blockId === BTN_B_ID) return BTN_B_RECT;
    // Section ROOT node shares its section id → the container rect.
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

function moveHandle(): HTMLElement {
  const el = query("canvas-move-handle");
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

async function renderAndSelectSection() {
  render(<CanvasHarness />);
  await act(async () => {
    useEditorStore.getState().selectSection(HERO_ID);
  });
  await flushMicrotasks();
}

/**
 * Select ids (transient, multi), flush, then drag the composite box's move
 * affordance from `from` to `to` (window pointermove/pointerup drive).
 * The editor snapshot is captured AFTER pointerdown, BEFORE the move —
 * exactly the invariant a gesture must uphold.
 */
async function batchDrag(
  ids: string[],
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  // Deterministic deltas: the 8px snap threshold would otherwise nudge the
  // preview onto nearby element/canvas edges mid-drag. (Snapping semantics
  // are unit-tested in canvas-transform.test.ts / canvas-snap tests.)
  useCanvasInteractionStore.getState().setSnapEnabled(false);
  await act(async () => {
    useCanvasInteractionStore.getState().setSelection(ids, {
      multi: ids.length > 1,
      anchorId: ids[0],
    });
  });
  await flushMicrotasks();

  await act(async () => {
    fireEvent.pointerDown(moveHandle(), { clientX: from.x, clientY: from.y, button: 0 });
  });
  const editorBefore = useEditorStore.getState();

  await act(async () => {
    fireEvent.pointerMove(document.body, { clientX: to.x, clientY: to.y });
  });
  await act(async () => {
    fireEvent.pointerUp(document.body, { clientX: to.x, clientY: to.y });
  });

  return { editorBefore };
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
});

afterEach(() => {
  rectSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// D7 — composite union box + count chip; single-element contract untouched
// ---------------------------------------------------------------------------

describe("composite bounding box (P27 Slice 2, D7)", () => {
  it("renders the union box with the count chip for a multi-selection", async () => {
    await renderAndSelectSection();
    await act(async () => {
      useCanvasInteractionStore.getState().setSelection([HEAD_A_ID, BTN_B_ID], {
        multi: true,
        anchorId: HEAD_A_ID,
      });
    });
    await flushMicrotasks();

    const box = query("canvas-selection-box");
    expect(box).toBeTruthy();
    // Union of HEAD_A (140,260,120,60) and BTN_B (300,300,100,40):
    // x=140, y=260, width=300-140=260, height=340-260=80.
    expect(box!.style.left).toBe("140px");
    expect(box!.style.top).toBe("260px");
    expect(box!.style.width).toBe("260px");
    expect(box!.style.height).toBe("80px");
    expect(box!.getAttribute("data-selection-count")).toBe("2");

    const chip = query("canvas-selection-count");
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toBe("2 selected · 260 × 80");

    // Exactly ONE selection box is rendered (no double box with the single box).
    expect(document.querySelectorAll('[data-testid="canvas-selection-box"]').length).toBe(1);
  });

  it("keeps the single-element box (handles, dims chip, no count chip)", async () => {
    await renderAndSelectSection();
    await act(async () => {
      useCanvasInteractionStore.getState().setSelection([HEAD_A_ID], {
        multi: false,
        anchorId: HEAD_A_ID,
      });
    });
    await flushMicrotasks();

    const box = query("canvas-selection-box");
    expect(box).toBeTruthy();
    expect(box!.getAttribute("data-selection-count")).toBeNull();
    expect(query("canvas-selection-count")).toBeNull();
    // Single-element handles remain (multi-resize is out of scope).
    expect(query("canvas-resize-handle-se")).toBeTruthy();
    expect(query("canvas-rotate-handle")).toBeTruthy();
    expect(query("canvas-selection-dims")).toBeTruthy();
  });

  it("renders NO composite box when the multi-selection includes the section root", async () => {
    await renderAndSelectSection();
    await act(async () => {
      useCanvasInteractionStore.getState().setSelection([BTN_B_ID, ROOT_ID], {
        multi: true,
        anchorId: BTN_B_ID,
      });
    });
    await flushMicrotasks();

    // Root + child is a single batch target (the container) — the composite
    // union box must not appear for it.
    expect(query("canvas-selection-count")).toBeNull();
    expect(document.querySelector('[data-element-id="__composite__"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D3/D5 — batch drag: same delta, no double-translation, ONE history entry
// ---------------------------------------------------------------------------

describe("batch drag gestures (P27 Slice 2, D3/D5)", () => {
  it("moves all top-level selected elements by the SAME delta in ONE history entry", async () => {
    await renderAndSelectSection();
    const { editorBefore } = await batchDrag(
      [HEAD_A_ID, BTN_B_ID],
      { x: 150, y: 350 },
      { x: 185, y: 374 }, // delta (+35, +24)
    );

    const geom = projectGeometry();
    // HEAD_A: (140,260) + (35,24); BTN_B: (300,300) + (35,24) — identical delta.
    expect(geom[HEAD_A_ID]).toMatchObject({ x: 175, y: 284 });
    expect(geom[BTN_B_ID]).toMatchObject({ x: 335, y: 324 });

    // Exactly ONE history entry for the whole batch (D5 / Invariant 2).
    expect(editorBefore.history.past).toHaveLength(0);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useEditorStore.getState().history.future).toHaveLength(0);
    // The project actually changed (a no-op commit would not push history).
    expect(useEditorStore.getState().project).not.toBe(editorBefore.project);
  });

  it("never double-translates children when their container is also selected", async () => {
    await renderAndSelectSection();
    const { editorBefore } = await batchDrag(
      [BTN_B_ID, ROOT_ID],
      { x: 150, y: 350 },
      { x: 185, y: 374 }, // delta (+35, +24)
    );

    const geom = projectGeometry();
    // The container ABSORBS the child (topLevelSelection): the gesture moves
    // the ROOT exactly once and the child NEVER enters the op batch — its
    // durable geometry is untouched (the no-double-translate proof).
    expect(geom[BTN_B_ID]).toEqual({});
    expect(geom[ROOT_ID]).toEqual({ mode: "absolute", x: 135, y: 224 });
    // One history entry for the (root-only) batch.
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useEditorStore.getState().project).not.toBe(editorBefore.project);
  });

  it("commits nothing when a zero-delta drag leaves every rect unchanged", async () => {
    await renderAndSelectSection();
    const { editorBefore } = await batchDrag(
      [HEAD_A_ID, BTN_B_ID],
      { x: 150, y: 350 },
      { x: 150, y: 350 }, // click on the box without dragging
    );

    expect(useEditorStore.getState().history.past).toHaveLength(0);
    expect(useEditorStore.getState().project).toBe(editorBefore.project);
  });
});

// ---------------------------------------------------------------------------
// D4/OQ-6 — flow elements keep their mode and take ONLY an x/y offset
// ---------------------------------------------------------------------------

describe("flow-mode batch drag (P27 Slice 2, OQ-6)", () => {
  it("commits an x/y offset for flow elements — never a mode flip", async () => {
    // Flow geometry is baked into the fixture (no setup commit → clean
    // history snapshot for the gesture's ONE-entry assertion).
    useEditorStore.getState().initProject(makeProject(true));
    useEditorStore.getState().setDirty(false);

    await renderAndSelectSection();
    const { editorBefore } = await batchDrag(
      [BTN_B_ID],
      { x: 350, y: 320 },
      { x: 380, y: 340 }, // delta (+30, +20)
    );

    const geom = projectGeometry();
    const btn = geom[BTN_B_ID];
    // Flow: the offset moved by the delta, the mode survived untouched.
    expect(btn.mode).toBe("flow");
    expect(btn.x).toBe(30);
    expect(btn.y).toBe(20);
    expect(useEditorStore.getState().history.past).toHaveLength(1);
    expect(useEditorStore.getState().project).not.toBe(editorBefore.project);
  });
});
