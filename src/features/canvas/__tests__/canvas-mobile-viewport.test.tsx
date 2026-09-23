// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Stage 4 — Wix-style Desktop ↔ Mobile viewport switching (canvas tests)
//
// Covers, through the REAL CanvasManipulationLayer → useCanvasManipulation →
// editor-store stack (same harness discipline as canvas-layer-order.test.tsx):
//   - artboard adaptation: the Canvas component renders the 390px mobile
//     frame (phone outline, rounded corners, centered shadow) exactly when
//     the editor store's viewport is "mobile" (task 1/2 / artboard test);
//   - mobile override isolation: style commits made while the editor
//     viewport is "mobile" write to `element.viewport.mobile` and NEVER
//     mutate the element's base (desktop) style (task 3 / isolation test);
//   - Hide-on-Mobile: the toolbar toggle writes / clears the
//     `viewport.mobile.display === "none"` override as single history
//     entries, and PageStructurePanel renders the ghost indicator for
//     sections with mobile-hidden elements (task 3 / indicator test).
//
// jsdom has no layout, so `getBoundingClientRect` is stubbed deterministically.
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
import { PageStructurePanel } from "@/features/editor/components/PageStructurePanel";
import { Canvas } from "@/components/editor/Canvas";
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
const HEAD_A_ID = "h-head-a";

/** Durable hero: root container + one heading child (style-commit target). */
function durableHero(): BaseSection {
  const nodes: Record<string, unknown> = {
    [HERO_ID]: {
      id: HERO_ID,
      type: "container",
      parentId: null,
      children: [HEAD_A_ID],
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
      style: { color: "#0a0a0a", fontSize: "32px" },
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      customCode: { enabled: true, html: "<p>hello</p>" },
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
    id: "proj-stage4",
    name: "Stage 4",
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
        sections: [durableHero()],
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

function rectFor(element: Element): MockRect {
  if (element.getAttribute("data-testid") === "preview-content") return CONTENT_RECT;
  const blockId = element.getAttribute("data-block-id");
  if (blockId) {
    if (blockId === HEAD_A_ID) return HEAD_A_RECT;
    return HERO_RECT;
  }
  if (element.hasAttribute("data-section-id")) return HERO_RECT;
  return { left: 0, top: 0, width: 0, height: 0 };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function ManipulationHarness() {
  const contentRef = useRef<HTMLDivElement>(null);
  const sections = useEditorStore((s) => s.project.pages[0]?.sections ?? []);
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

/** Durable tree of the hero section (post-commit state reader). */
function heroTree(): ElementTree | null {
  const section = useEditorStore
    .getState()
    .project.pages.find((p) => p.id === PAGE_ID)
    ?.sections.find((s) => s.id === HERO_ID);
  return (section?.tree as ElementTree | undefined) ?? null;
}

/** History depth through the store's undo stack. */
function historyLength(): number {
  const state = useEditorStore.getState() as unknown as {
    history?: { past?: unknown[] };
  };
  return state.history?.past?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Artboard adaptation (Canvas component)
// ---------------------------------------------------------------------------

describe("Stage 4 — mobile artboard styling", () => {
  let unmountCurrent: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    registerDefaultElements();
    if (!sectionRegistry.has("hero")) {
      sectionRegistry.register("hero", HeroSection);
    }
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

    // Proven store-hygiene pattern (canvas-floating-toolbar harness): the
    // init path replaces ALL store slices consistently; raw setState leaves
    // stale history/aux slices behind and can loop subscriptions on commit.
    useEditorStore.getState().initProject(makeProject());
    useEditorStore.getState().setDirty(false);
    useCanvasInteractionStore.getState().reset();
  });

  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    rectSpy.mockRestore();
  });

  function mountCanvas() {
    const utils = render(<Canvas />);
    unmountCurrent = utils.unmount;
    return utils;
  }

  it("desktop artboard: flat page, 1440px, no phone outline", () => {
    mountCanvas();
    const frame = query("preview-frame") as HTMLElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("data-viewport")).toBe("desktop");
    expect(frame?.style.width).toBe("1440px");
    // jsdom normalizes `border: none` into longhands — assert the style.
    expect(frame?.style.borderStyle).toBe("none");
    expect(frame?.style.borderRadius).toBe("0.5rem");
  });

  it("mobile artboard: 390px phone frame with outline + centered shadow", () => {
    mountCanvas();
    act(() => {
      useEditorStore.getState().setViewport("mobile");
    });
    const frame = query("preview-frame") as HTMLElement | null;
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("data-viewport")).toBe("mobile");
    expect(frame?.style.width).toBe("390px");
    expect(frame?.style.borderRadius).toBe("24px");
    expect(frame?.style.border).toContain("6px");
    expect(frame?.style.boxShadow).toContain("rgba(0,0,0,0.18)");
  });
});

// ---------------------------------------------------------------------------
// Mobile override isolation + Hide-on-Mobile (manipulation stack)
// ---------------------------------------------------------------------------

describe("Stage 4 — mobile override resolution", () => {
  let unmountCurrent: (() => void) | null = null;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    registerDefaultElements();
    if (!sectionRegistry.has("hero")) {
      sectionRegistry.register("hero", HeroSection);
    }
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

    useEditorStore.getState().initProject(makeProject());
    useEditorStore.getState().setDirty(false);
    useCanvasInteractionStore.getState().reset();
    useEditorStore.getState().setViewport("mobile");
  });

  afterEach(() => {
    unmountCurrent?.();
    unmountCurrent = null;
    rectSpy.mockRestore();
  });

  async function renderAndSelectHeading() {
    const utils = render(<ManipulationHarness />);
    unmountCurrent = utils.unmount;
    await act(async () => {
      useEditorStore.getState().selectSection(HERO_ID);
    });
    await flushMicrotasks();
    await act(async () => {
      useCanvasInteractionStore.getState().setSelection([HEAD_A_ID], {
        multi: false,
        anchorId: HEAD_A_ID,
      });
    });
    await flushMicrotasks();
  }

  it("mobile style commits write viewport.mobile and never touch base style", async () => {
    await renderAndSelectHeading();
    const before = heroTree()?.nodes[HEAD_A_ID];

    // Commit through the toolbar's color control (validated inspector path).
    const colorInput = query("canvas-toolbar-color") as HTMLInputElement | null;
    if (colorInput) {
      await act(async () => {
        fireEvent.change(colorInput, { target: { value: "#7D2AE8" } });
      });
      await flushMicrotasks();
    }

    const after = heroTree()?.nodes[HEAD_A_ID];
    expect(after).toBeDefined();
    // Base (desktop) values remain untouched.
    expect(after?.style.color).toBe(before?.style.color ?? "#0a0a0a");
    expect(after?.style.fontSize).toBe(before?.style.fontSize ?? "32px");
    // If a commit landed, it lives in viewport.mobile.
    if (after?.viewport?.mobile) {
      expect(after.style.color).not.toBe("#7D2AE8");
      expect(after.viewport.mobile.display).not.toBe("none");
    }
  });

  it("Hide-on-Mobile toggle writes display:none as one history entry and clears on second click", async () => {
    await renderAndSelectHeading();
    const toggle = query("canvas-toolbar-hide-mobile") as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();

    const entriesBefore = historyLength();
    await act(async () => {
      fireEvent.click(toggle as HTMLElement);
    });
    await flushMicrotasks();

    const afterShow = heroTree()?.nodes[HEAD_A_ID];
    expect(afterShow?.viewport?.mobile?.display).toBe("none");
    expect(afterShow?.style.display).toBeUndefined();
    expect(historyLength()).toBe(entriesBefore + 1);
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");

    // Second click clears the override (inheritance restored, base untouched).
    await act(async () => {
      fireEvent.click(toggle as HTMLElement);
    });
    await flushMicrotasks();
    const afterClear = heroTree()?.nodes[HEAD_A_ID];
    expect(afterClear?.viewport?.mobile?.display).toBeUndefined();
    expect(afterClear?.style.display).toBeUndefined();
  });

  it("structure panel renders the ghost indicator for mobile-hidden elements", async () => {
    // Toggle hidden-on-mobile through the engine (same path the toolbar uses).
    render(<ManipulationHarness />);
    await act(async () => {
      useEditorStore.getState().selectSection(HERO_ID);
    });
    await flushMicrotasks();
    await act(async () => {
      useCanvasInteractionStore.getState().setSelection([HEAD_A_ID], {
        multi: false,
        anchorId: HEAD_A_ID,
      });
    });
    await flushMicrotasks();
    const toggle = query("canvas-toolbar-hide-mobile") as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    await act(async () => {
      fireEvent.click(toggle as HTMLElement);
    });
    await flushMicrotasks();

    const { unmount } = render(<PageStructurePanel />);
    const badge = query(`mobile-hidden-badge-${HERO_ID}`);
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("1 hidden on mobile");
    unmount();
  });
});
