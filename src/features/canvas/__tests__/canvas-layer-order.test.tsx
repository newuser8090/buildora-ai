// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas layer ordering (Phase P28 Slice 1 — D1/D7/REQ-1/REQ-9/REQ-12)
//
// Covers, through the REAL CanvasManipulationLayer → useCanvasManipulation →
// editor-store stack:
//   - buildLayerOps' emission order stays correct under SEQUENTIAL `move` op
//     application (the call site applies ops verbatim — R3);
//   - Bring to Front / Send to Back move the target to the END / index 0 of
//     the sibling children array (task 4);
//   - forward/backward step one sibling (task 4);
//   - every layer action commits through commitElementTree as exactly ONE
//     history entry; undo restores the exact pre-action tree (task 4 / REQ-2);
//   - a boundary action (already at the stack end) emits no ops → no history
//     entry (fail-closed no-op);
//   - a locked element is excluded from layer resolution (no commit);
//   - the overlay layer cluster renders on element/composite boxes, is
//     disabled at the stack boundaries, is absent on the section-root box,
//     and its pointerdown never rewrites the selection (REQ-12);
//   - the Cmd/Ctrl+]/[ chords fire layer actions only when NOT focused in a
//     text field — a keydown inside an <input> produces ZERO mutations
//     (task 4 / REQ-9 / Invariant 4).
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
const TXT_C_ID = "t-txt-c";

const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

/**
 * Durable hero whose tree carries THREE nested siblings (layer targets).
 * `lockBtn` makes the middle sibling locked (exclusion candidate).
 */
function durableHeroWithThreeChildren(
  id: string,
  headId: string,
  btnId: string,
  txtId: string,
  lockBtn = false,
): BaseSection {
  const nodes: Record<string, unknown> = {
    [id]: {
      id,
      type: "container",
      parentId: null,
      children: [headId, btnId, txtId],
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
      locked: lockBtn,
      hidden: false,
    },
    [txtId]: {
      id: txtId,
      type: "button",
      parentId: id,
      children: [],
      props: { text: "Info", href: "#" },
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

function makeProject(lockBtn = false): Project {
  return {
    id: "proj-p28-slice1",
    name: "P28 Slice 1",
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
        sections: [durableHeroWithThreeChildren(HERO_ID, HEAD_A_ID, BTN_B_ID, TXT_C_ID, lockBtn)],
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
const TXT_C_RECT: MockRect = { left: 300, top: 380, width: 100, height: 40 };

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    if (blockId === HEAD_A_ID) return HEAD_A_RECT;
    if (blockId === BTN_B_ID) return BTN_B_RECT;
    if (blockId === TXT_C_ID) return TXT_C_RECT;
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

async function renderAndSelectSection() {
  render(<CanvasHarness />);
  await act(async () => {
    useEditorStore.getState().selectSection(HERO_ID);
  });
  await flushMicrotasks();
}

async function selectElements(ids: string[]) {
  await act(async () => {
    useCanvasInteractionStore.getState().setSelection(ids, {
      multi: ids.length > 1,
      anchorId: ids[0],
    });
  });
  await flushMicrotasks();
}

/** Durable tree of the hero section (post-commit state reader). */
function heroTree(): ElementTree | null {
  const section = useEditorStore
    .getState()
    .project.pages.find((p) => p.id === PAGE_ID)
    ?.sections.find((s) => s.id === HERO_ID);
  return (section?.tree as ElementTree | undefined) ?? null;
}

/** Sibling order of the hero root's children in the DURABLE tree. */
function durableChildren(): string[] {
  return [...(heroTree()?.nodes[ROOT_ID]?.children ?? [])];
}

function historyDepth(): number {
  return useEditorStore.getState().history.past.length;
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
// Engine emission order (R3) — ops applied verbatim reproduce the engine order
// ---------------------------------------------------------------------------

describe("buildLayerOps emission order under sequential application (P28 R3)", () => {
  it("single forward step: applying the emitted op reproduces the engine order", async () => {
    const { applyLayerAction, buildLayerOps } = await import("../engine/layering");
    const { applyElementOpBatch } = await import("../engine/batch");
    const { createElement } = await import("@/features/elements/engine/element-operations");

    const section = createElement("section", { id: "root" });
    const mk = (id: string) => ({
      id,
      type: "card" as const,
      parentId: "root",
      children: [] as string[],
      props: {},
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    });
    const tree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: { ...section, children: ["a", "b", "c", "d"] },
        a: mk("a"),
        b: mk("b"),
        c: mk("c"),
        d: mk("d"),
      },
    };
    const ordered = applyLayerAction(["a", "b", "c", "d"], ["b"], "forward");
    expect(ordered).toEqual(["a", "c", "b", "d"]);

    // Apply the emitted ops VERBATIM (the hook's contract) — the sequential
    // application must land exactly on the engine's computed order.
    const ops = buildLayerOps(tree, ["b"], "forward");
    expect(ops.length).toBe(1);
    const result = applyElementOpBatch(tree, ops);
    expect(result.ok).toBe(true);
    expect(result.tree?.nodes.root.children).toEqual(ordered);
  });

  it("multi-select back: applying the emitted ops verbatim reproduces the engine order", async () => {
    const { applyLayerAction, buildLayerOps } = await import("../engine/layering");
    const { applyElementOpBatch } = await import("../engine/batch");
    const { createElement } = await import("@/features/elements/engine/element-operations");

    const section = createElement("section", { id: "root" });
    const mk = (id: string) => ({
      id,
      type: "card" as const,
      parentId: "root",
      children: [] as string[],
      props: {},
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    });
    const tree: ElementTree = {
      rootIds: ["root"],
      nodes: {
        root: { ...section, children: ["a", "b", "c", "d"] },
        a: mk("a"),
        b: mk("b"),
        c: mk("c"),
        d: mk("d"),
      },
    };
    const ordered = applyLayerAction(["a", "b", "c", "d"], ["a", "c"], "back");
    expect(ordered).toEqual(["a", "c", "b", "d"]);

    const ops = buildLayerOps(tree, ["a", "c"], "back");
    const result = applyElementOpBatch(tree, ops);
    expect(result.ok).toBe(true);
    expect(result.tree?.nodes.root.children).toEqual(ordered);
  });
});

// ---------------------------------------------------------------------------
// Layer actions through the real stack — ONE history entry (D1/REQ-2)
// ---------------------------------------------------------------------------

describe("layer actions through the manipulation hook (P28 Slice 1, D1)", () => {
  it("Bring to Front moves the target to the END of the sibling children array", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]); // first of [head, btn, txt]
    expect(durableChildren()).toEqual([HEAD_A_ID, BTN_B_ID, TXT_C_ID]);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true, shiftKey: true });
    });

    expect(durableChildren()).toEqual([BTN_B_ID, TXT_C_ID, HEAD_A_ID]);
    expect(historyDepth()).toBe(1);
  });

  it("Send to Back moves the target to index 0 of the sibling children array", async () => {
    await renderAndSelectSection();
    await selectElements([TXT_C_ID]); // last of [head, btn, txt]

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "[", ctrlKey: true, shiftKey: true });
    });

    expect(durableChildren()).toEqual([TXT_C_ID, HEAD_A_ID, BTN_B_ID]);
    expect(historyDepth()).toBe(1);
  });

  it("Move Forward / Move Backward step exactly one sibling", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true });
    });
    expect(durableChildren()).toEqual([BTN_B_ID, HEAD_A_ID, TXT_C_ID]);
    expect(historyDepth()).toBe(1);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "[", ctrlKey: true });
    });
    // One entry per action: the second action stacks on the first.
    expect(durableChildren()).toEqual([HEAD_A_ID, BTN_B_ID, TXT_C_ID]);
    expect(historyDepth()).toBe(2);
  });

  it("commits exactly ONE history entry and undo restores the exact tree", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID, TXT_C_ID]); // multi: relative order preserved
    const before = heroTree();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true, shiftKey: true });
    });

    expect(durableChildren()).toEqual([BTN_B_ID, HEAD_A_ID, TXT_C_ID]);
    expect(historyDepth()).toBe(1);

    await act(async () => {
      useEditorStore.getState().undo();
    });
    expect(durableChildren()).toEqual([HEAD_A_ID, BTN_B_ID, TXT_C_ID]);
    // Deep restoration: the undone tree equals the pre-action tree.
    expect(heroTree()).toEqual(before);
  });

  it("is a fail-closed no-op at the stack boundary (no ops → no history entry)", async () => {
    await renderAndSelectSection();
    await selectElements([TXT_C_ID]); // already LAST → forward/front are no-ops
    const before = heroTree();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true });
    });

    expect(durableChildren()).toEqual([HEAD_A_ID, BTN_B_ID, TXT_C_ID]);
    expect(historyDepth()).toBe(0);
    expect(useEditorStore.getState().project).toBe(useEditorStore.getState().project);
    expect(heroTree()).toEqual(before);
  });

  it("excludes a locked element from layer resolution (no commit, no history)", async () => {
    useEditorStore.getState().initProject(makeProject(true)); // btn locked
    useEditorStore.getState().setDirty(false);
    await renderAndSelectSection();
    await selectElements([BTN_B_ID]);
    const before = heroTree();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true, shiftKey: true });
    });

    expect(heroTree()).toEqual(before);
    expect(historyDepth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Overlay layer controls (REQ-1 boundaries / REQ-12 chrome exclusion)
// ---------------------------------------------------------------------------

describe("overlay layer controls (P28 Slice 1, D1/REQ-1/REQ-12)", () => {
  it("renders the layer cluster on an element selection and disables at boundaries", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]); // FIRST sibling → cannot go backward/back

    const cluster = query("canvas-layer-actions");
    expect(cluster).toBeTruthy();
    expect(query("canvas-layer-front")).toBeTruthy();
    expect(query("canvas-layer-forward")).toBeTruthy();
    expect(query("canvas-layer-backward")).toBeTruthy();
    expect(query("canvas-layer-back")).toBeTruthy();

    // At the BACK boundary the two toward-back actions are disabled.
    expect((query("canvas-layer-backward") as HTMLButtonElement).disabled).toBe(true);
    expect((query("canvas-layer-back") as HTMLButtonElement).disabled).toBe(true);
    expect((query("canvas-layer-forward") as HTMLButtonElement).disabled).toBe(false);
    expect((query("canvas-layer-front") as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables toward-front actions when the target is the LAST sibling", async () => {
    await renderAndSelectSection();
    await selectElements([TXT_C_ID]); // LAST sibling

    expect((query("canvas-layer-forward") as HTMLButtonElement).disabled).toBe(true);
    expect((query("canvas-layer-front") as HTMLButtonElement).disabled).toBe(true);
    expect((query("canvas-layer-backward") as HTMLButtonElement).disabled).toBe(false);
    expect((query("canvas-layer-back") as HTMLButtonElement).disabled).toBe(false);
  });

  it("clicking Move Forward on a middle sibling reorders with ONE history entry", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.click(query("canvas-layer-forward") as HTMLElement);
    });

    expect(durableChildren()).toEqual([BTN_B_ID, HEAD_A_ID, TXT_C_ID]);
    expect(historyDepth()).toBe(1);
  });

  it("renders the cluster on the composite box and handles a multi-set", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID, TXT_C_ID]); // first + last → union box

    expect(query("canvas-selection-count")).toBeTruthy();
    expect(query("canvas-layer-actions")).toBeTruthy();

    await act(async () => {
      fireEvent.click(query("canvas-layer-back") as HTMLElement);
    });
    // Both members already sit at/relative to the back edge: [head, btn, txt]
    // with {head, txt} → "back" preserves their relative order at the front.
    expect(durableChildren()).toEqual([HEAD_A_ID, TXT_C_ID, BTN_B_ID]);
    expect(historyDepth()).toBe(1);
  });

  it("renders NO layer cluster on the section-root box", async () => {
    await renderAndSelectSection();
    await selectElements([ROOT_ID]); // section root — page-level ordering owns it

    expect(query("canvas-selection-box")).toBeTruthy();
    expect(query("canvas-layer-actions")).toBeNull();
  });

  it("never rewrites the selection on layer-chrome pointerdown (REQ-12)", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);
    const idsBefore = useCanvasInteractionStore.getState().selection.ids;

    await act(async () => {
      fireEvent.pointerDown(query("canvas-layer-forward") as HTMLElement, { button: 0 });
    });

    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(idsBefore);
    expect(historyDepth()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Keyboard chords (D7) — fire only OUTSIDE text fields (Invariant 4)
// ---------------------------------------------------------------------------

describe("layer keyboard chords (P28 Slice 1, D7/REQ-9)", () => {
  it("fires Cmd+Shift+] (front) and Cmd+[ (backward) with a selection active", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", metaKey: true, shiftKey: true });
    });
    expect(durableChildren()).toEqual([BTN_B_ID, TXT_C_ID, HEAD_A_ID]);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "[", metaKey: true });
    });
    // head is now LAST; backward steps it ONE position down the stack.
    expect(durableChildren()).toEqual([BTN_B_ID, HEAD_A_ID, TXT_C_ID]);
  });

  it("does nothing without a selection", async () => {
    await renderAndSelectSection();
    // No element selection → resolveGestureIds is empty → no-op.
    await act(async () => {
      useCanvasInteractionStore.getState().clearSelection();
    });
    const before = heroTree();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true });
    });

    expect(heroTree()).toEqual(before);
    expect(historyDepth()).toBe(0);
  });

  it("never fires inside a focused input — zero mutations (Invariant 4)", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);
    const childrenBefore = durableChildren();
    const historyBefore = historyDepth();
    const selectionBefore = useCanvasInteractionStore.getState().selection.ids;

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    await act(async () => {
      fireEvent.keyDown(input, { key: "]", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(input, { key: "[", ctrlKey: true });
    });

    expect(durableChildren()).toEqual(childrenBefore);
    expect(historyDepth()).toBe(historyBefore);
    expect(useCanvasInteractionStore.getState().selection.ids).toEqual(selectionBefore);

    input.remove();
  });

  it("fires again once the focus leaves the input", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    await act(async () => {
      fireEvent.keyDown(input, { key: "]", ctrlKey: true });
    });
    expect(durableChildren()).toEqual([HEAD_A_ID, BTN_B_ID, TXT_C_ID]);

    (document.activeElement as HTMLElement | null)?.blur?.();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "]", ctrlKey: true });
    });
    expect(durableChildren()).toEqual([BTN_B_ID, HEAD_A_ID, TXT_C_ID]);
    expect(historyDepth()).toBe(1);

    input.remove();
  });
});
