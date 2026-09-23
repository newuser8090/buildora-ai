// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Canvas floating contextual toolbar (Stage 1 light shell)
//
// Covers, through the REAL CanvasManipulationLayer → useElementInspector →
// editor-store stack:
//   - the toolbar renders above a single nested element focus and is ABSENT
//     for the section-root box (the root keeps its frozen chrome);
//   - a text-capable target (heading) renders the typography cluster
//     (font/size/color/bold/alignment); a widget/container target renders the
//     appearance cluster (background/radius/Action-Behavior);
//   - every change commits through the inspector field path as exactly ONE
//     history entry with the correct style token written;
//   - delete inside the toolbar removes the element (one history entry);
//   - the P28 layer cluster remains mounted under `canvas-layer-actions`
//     inside the toolbar (the dark-chip fallback is gone for element boxes).
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed deterministically
// (same discipline as canvas-layer-order.test.tsx).
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
const CONTAINER_ID = "c-box-c";

const ENABLED_CODE = { enabled: true, html: "<p>hello</p>" };

/**
 * Durable hero with a heading (text target), a button (widget target), and a
 * container (widget target). All unlocked; `customCode` on the heading makes
 * the section tree-path rendered (P25 gate).
 */
function durableHero(id: string): BaseSection {
  const nodes: Record<string, unknown> = {
    [id]: {
      id,
      type: "container",
      parentId: null,
      children: [HEAD_A_ID, BTN_B_ID, CONTAINER_ID],
      props: { _sectionType: "hero", _sectionId: id },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    },
    [HEAD_A_ID]: {
      id: HEAD_A_ID,
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
    [BTN_B_ID]: {
      id: BTN_B_ID,
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
    [CONTAINER_ID]: {
      id: CONTAINER_ID,
      type: "container",
      parentId: id,
      children: [],
      props: {},
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

function makeProject(): Project {
  return {
    id: "proj-p28-toolbar",
    name: "P28 Toolbar",
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
    pages: [{ id: PAGE_ID, title: "Home", slug: "/", sections: [durableHero(HERO_ID)] }],
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
const CONTAINER_RECT: MockRect = { left: 300, top: 380, width: 100, height: 40 };

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    if (blockId === HEAD_A_ID) return HEAD_A_RECT;
    if (blockId === BTN_B_ID) return BTN_B_RECT;
    if (blockId === CONTAINER_ID) return CONTAINER_RECT;
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
// Tests
// ---------------------------------------------------------------------------

describe("Floating contextual toolbar — mounting (Stage 1)", () => {
  it("renders above a single nested element focus", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);
    expect(query("canvas-floating-toolbar")).toBeTruthy();
  });

  it("does NOT render for the section-root box (root keeps its frozen chrome)", async () => {
    await renderAndSelectSection();
    expect(query("canvas-floating-toolbar")).toBeNull();
    // The P28 layer cluster is likewise absent on the root box.
    expect(query("canvas-layer-actions")).toBeNull();
  });

  it("does NOT render for a composite multi-selection (no single style target)", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID, BTN_B_ID]);
    expect(query("canvas-floating-toolbar")).toBeNull();
    // …but the standalone P28 layer cluster still rides the composite box.
    expect(query("canvas-layer-actions")).toBeTruthy();
  });
});

describe("Floating contextual toolbar — text variant", () => {
  it("renders the typography cluster for a heading", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);
    expect(query("canvas-toolbar-font")).toBeTruthy();
    expect(query("canvas-toolbar-font-size")).toBeTruthy();
    expect(query("canvas-toolbar-color")).toBeTruthy();
    expect(query("canvas-toolbar-bold")).toBeTruthy();
    expect(query("canvas-toolbar-align")).toBeTruthy();
  });

  it("commits a font-size change as exactly ONE history entry", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);
    const before = historyDepth();

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-font-size")!, {
        target: { value: "32" },
      });
    });
    await flushMicrotasks();

    expect(historyDepth()).toBe(before + 1);
    expect(heroTree()?.nodes[HEAD_A_ID]?.style.fontSize).toBe(32);
  });

  it("toggles bold (fontWeight 400 → 700) and back", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.click(query("canvas-toolbar-bold")!);
    });
    expect(heroTree()?.nodes[HEAD_A_ID]?.style.fontWeight).toBe(700);

    await act(async () => {
      fireEvent.click(query("canvas-toolbar-bold")!);
    });
    expect(heroTree()?.nodes[HEAD_A_ID]?.style.fontWeight).toBe(400);
  });

  it("commits a text color change", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-color")!, {
        target: { value: "#ff0000" },
      });
    });
    expect(heroTree()?.nodes[HEAD_A_ID]?.style.color).toBe("#ff0000");
  });

  it("commits an alignment change", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-align")!, {
        target: { value: "center" },
      });
    });
    expect(heroTree()?.nodes[HEAD_A_ID]?.style.textAlign).toBe("center");
  });

  it("commits a font family change", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-font")!, {
        target: { value: "Inter, system-ui, sans-serif" },
      });
    });
    expect(heroTree()?.nodes[HEAD_A_ID]?.style.fontFamily).toBe(
      "Inter, system-ui, sans-serif",
    );
  });
});

describe("Floating contextual toolbar — widget/container variant", () => {
  it("renders the appearance cluster for a container (no typography controls)", async () => {
    await renderAndSelectSection();
    await selectElements([CONTAINER_ID]);
    expect(query("canvas-toolbar-background")).toBeTruthy();
    expect(query("canvas-toolbar-radius")).toBeTruthy();
    expect(query("canvas-toolbar-action")).toBeTruthy();
    expect(query("canvas-toolbar-font")).toBeNull();
    expect(query("canvas-toolbar-bold")).toBeNull();
  });

  it("commits a background color change", async () => {
    await renderAndSelectSection();
    await selectElements([CONTAINER_ID]);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-background")!, {
        target: { value: "#00ff00" },
      });
    });
    expect(heroTree()?.nodes[CONTAINER_ID]?.style.backgroundColor).toBe("#00ff00");
  });

  it("commits a border-radius preset", async () => {
    await renderAndSelectSection();
    await selectElements([CONTAINER_ID]);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-radius")!, {
        target: { value: "12px" },
      });
    });
    // The element engine normalizes radius tokens into bounded numbers.
    expect(heroTree()?.nodes[CONTAINER_ID]?.style.borderRadius).toBe(12);
  });

  it("clears the radius when reset to None", async () => {
    await renderAndSelectSection();
    await selectElements([CONTAINER_ID]);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-radius")!, {
        target: { value: "8px" },
      });
    });
    expect(heroTree()?.nodes[CONTAINER_ID]?.style.borderRadius).toBe(8);

    await act(async () => {
      fireEvent.change(query("canvas-toolbar-radius")!, {
        target: { value: "0" },
      });
    });
    expect(heroTree()?.nodes[CONTAINER_ID]?.style.borderRadius).toBeUndefined();
  });
});

describe("Floating contextual toolbar — actions", () => {
  it("delete removes the element with exactly one history entry", async () => {
    await renderAndSelectSection();
    await selectElements([BTN_B_ID]);
    const before = historyDepth();

    await act(async () => {
      fireEvent.click(query("canvas-delete")!);
    });
    await flushMicrotasks();

    expect(historyDepth()).toBe(before + 1);
    const tree = heroTree();
    expect(tree?.nodes[BTN_B_ID]).toBeUndefined();
    expect(tree?.nodes[ROOT_ID]?.children).not.toContain(BTN_B_ID);
  });

  it("keeps the P28 layer cluster mounted inside the toolbar", async () => {
    await renderAndSelectSection();
    await selectElements([HEAD_A_ID]);
    expect(query("canvas-layer-actions")).toBeTruthy();
    expect(query("canvas-layer-front")).toBeTruthy();
    expect(query("canvas-layer-back")).toBeTruthy();
  });

  it("layer buttons remain boundary-disabled inside the toolbar", async () => {
    await renderAndSelectSection();
    // BTN_B is the middle sibling: not at either boundary.
    await selectElements([BTN_B_ID]);
    expect((query("canvas-layer-forward") as HTMLButtonElement).disabled).toBe(false);
    expect((query("canvas-layer-backward") as HTMLButtonElement).disabled).toBe(false);
    // CONTAINER is the last sibling: Move Forward / Bring to Front disabled.
    await selectElements([CONTAINER_ID]);
    expect((query("canvas-layer-forward") as HTMLButtonElement).disabled).toBe(true);
    expect((query("canvas-layer-front") as HTMLButtonElement).disabled).toBe(true);
  });
});
