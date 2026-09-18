// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// SectionRenderer — additive tree dispatch (Phase P25, Slice 1)
//
// Decisions covered: D1 (additive predicate), D2 (SectionRenderer is the single
// dispatch point), D4 (render the reconciled tree as-is — no lossy projection),
// D8 (canvas and export consult the SAME custom-code emission gate; OQ-1
// resolved export-aligned).
//
// The dispatch rule under test:
//   non-`custom-block` + durable tree carrying EMITTABLE custom code
//     → DurableTreeSection → BlockRenderer (inert placeholder on canvas)
//   everything else → the registered component (bespoke props layout for
//     regular sections, CustomBlockSection for custom-block)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useEditorUiStore } from "@/features/editor/ui/editor-ui-store";
import {
  registerDefaultBlocks,
  isDefaultBlocksRegistered,
} from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { sectionRegistry } from "@/features/editor/registry/section-registry";
import { HeroSection } from "@/features/editor/sections/HeroSection";
import { CustomBlockSection } from "@/features/editor/sections/CustomBlockSection";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { buildSrcdocsForTreeRecord } from "@/features/export/generators/section-tree-export";
import { ELEMENT_MAX_CUSTOM_CODE_LENGTH } from "@/features/elements/schemas/element-schemas";
import type { BaseSection } from "@/types/section";
import type { Project } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";
import { SectionRenderer } from "../SectionRenderer";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A section-derived tree: container root with the section markers + children.
 *
 * Each child is a heading; a child carrying `customCode` is the element the
 * tree path must replace with the inert placeholder, while sibling children
 * keep rendering normally.
 */
function sectionTree(
  sectionId: string,
  children: { id: string; customCode?: unknown }[],
): ElementTree {
  const nodes: Record<string, unknown> = {
    [sectionId]: {
      id: sectionId,
      type: "container",
      parentId: null,
      children: children.map((child) => child.id),
      props: { _sectionType: "hero", _sectionId: sectionId },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
    },
  };
  for (const child of children) {
    nodes[child.id] = {
      id: child.id,
      type: "heading",
      parentId: sectionId,
      children: [],
      props: { text: "Durable headline", level: 2 },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      ...(child.customCode === undefined ? {} : { customCode: child.customCode }),
    };
  }
  return { rootIds: [sectionId], nodes } as ElementTree;
}

function hero(id: string, order: number, tree?: ElementTree): BaseSection {
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
    ...(tree ? { tree } : {}),
  } as BaseSection;
}

function customBlock(id: string, order: number): BaseSection {
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
  } as unknown as BaseSection;
}

/** Valid, explicitly enabled payload. */
const ENABLED_CODE = { enabled: true, html: "<p>hello</p>", css: "p{color:red}", js: "1+1" };
/** Explicitly disabled payload — must never select the tree path. */
const DISABLED_CODE = { enabled: false, html: "<p>hello</p>" };
/** Schema-INVALID payload (over the per-field cap) — export emits nothing. */
const OVER_CAP_CODE = { enabled: true, html: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1) };

const SECTION_IDS = {
  legacy: "s-hero-legacy",
  durable: "s-hero-durable",
  coded: "s-hero-coded",
  disabled: "s-hero-disabled",
  overCap: "s-hero-overcap",
  custom: "s-custom-block",
} as const;

function makeProject(): Project {
  return {
    id: "proj-p25-slice1",
    name: "P25 Slice 1",
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
          hero(SECTION_IDS.legacy, 1),
          hero(
            SECTION_IDS.durable,
            2,
            sectionTree(SECTION_IDS.durable, [{ id: `${SECTION_IDS.durable}-h` }]),
          ),
          // A plain sibling FIRST, so the placeholder can be proven to be
          // scoped to the coded element alone.
          hero(
            SECTION_IDS.coded,
            3,
            sectionTree(SECTION_IDS.coded, [
              { id: `${SECTION_IDS.coded}-h` },
              { id: `${SECTION_IDS.coded}-c`, customCode: ENABLED_CODE },
            ]),
          ),
          hero(
            SECTION_IDS.disabled,
            4,
            sectionTree(SECTION_IDS.disabled, [
              { id: `${SECTION_IDS.disabled}-h`, customCode: DISABLED_CODE },
            ]),
          ),
          hero(
            SECTION_IDS.overCap,
            5,
            sectionTree(SECTION_IDS.overCap, [
              { id: `${SECTION_IDS.overCap}-h`, customCode: OVER_CAP_CODE },
            ]),
          ),
          customBlock(SECTION_IDS.custom, 6),
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

function renderCanvas() {
  const project = useEditorStore.getState().project;
  const sections = project.pages[0].sections;
  return render(<SectionRenderer sections={sections} pageId="page-1" />);
}

/** Scope queries to ONE section wrapper (by its frozen `data-section-id`). */
function sectionEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-section-id="${id}"]`);
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

const PLACEHOLDER = '[data-testid="block-custom-code-placeholder"]';
const TREE_SECTION = '[data-testid="durable-tree-section"]';

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  sectionRegistry.registerAll([
    ["hero", HeroSection],
    [CUSTOM_BLOCK_SECTION_TYPE, CustomBlockSection],
  ]);

  useEditorStore.getState().initProject(makeProject());
  useEditorStore.getState().setDirty(false);
  useEditorUiStore.setState({ ...useEditorUiStore.getState(), rightPanelCollapsed: false });
});

// ---------------------------------------------------------------------------
// The legacy path is untouched
// ---------------------------------------------------------------------------

describe("SectionRenderer — legacy props-driven path (P25 Slice 1)", () => {
  it("renders the registered section component for a section with no durable tree", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.legacy);

    expect(el.querySelector(TREE_SECTION)).toBeNull();
    expect(el.querySelector(PLACEHOLDER)).toBeNull();
    // The bespoke props component renders — its inline-editing bindings prove it.
    expect(el.querySelector('[data-editable-field="hero.headline"]')).toBeTruthy();
  });

  it("keeps the props-driven component for a durable section WITHOUT custom code (bespoke layout preserved)", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.durable);

    expect(el.querySelector(TREE_SECTION)).toBeNull();
    expect(el.querySelector(PLACEHOLDER)).toBeNull();
    expect(el.querySelector('[data-editable-field="hero.headline"]')).toBeTruthy();
  });

  it("does not switch on explicitly DISABLED custom code", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.disabled);

    expect(el.querySelector(TREE_SECTION)).toBeNull();
    expect(el.querySelector(PLACEHOLDER)).toBeNull();
  });

  it("does not switch on schema-INVALID custom code (export emits nothing either)", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.overCap);

    expect(el.querySelector(TREE_SECTION)).toBeNull();
    expect(el.querySelector(PLACEHOLDER)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The new tree path
// ---------------------------------------------------------------------------

describe("SectionRenderer — durable tree path (P25 Slice 1)", () => {
  it("renders a durable section WITH enabled custom code through BlockRenderer", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.coded);

    expect(el.querySelector(TREE_SECTION)).toBeTruthy();
    // ...and NOT through the bespoke props component.
    expect(el.querySelector('[data-editable-field]')).toBeNull();
  });

  it("shows the inert custom-code placeholder on canvas for that element", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.coded);

    const placeholder = el.querySelector(PLACEHOLDER);
    expect(placeholder).toBeTruthy();
    expect(placeholder?.textContent).toContain("Custom code");
    // The sibling (non-custom-code) element still renders normally.
    expect(el.textContent).toContain("Durable headline");
  });

  it("stays inert: no iframe, no srcdoc, no user code text in the canvas DOM", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.coded);

    expect(el.querySelector("iframe")).toBeNull();
    const html = el.innerHTML;
    expect(html).not.toContain("srcdoc");
    expect(html).not.toContain("<script");
    // The authored code is never inlined on canvas (only the placeholder is).
    expect(html).not.toContain("p{color:red}");
    expect(html).not.toContain("hello");
  });

  it("keeps the frozen canvas DOM contract (data-section-id + section wrapper)", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.coded);

    expect(el.getAttribute("data-testid")).toMatch(/section-wrapper|selected-section/);
  });
});

// ---------------------------------------------------------------------------
// custom-block regression — the registry path is frozen
// ---------------------------------------------------------------------------

describe("SectionRenderer — custom-block is unchanged (P25 Slice 1)", () => {
  it("keeps rendering custom-block through its registered component", () => {
    const { container } = renderCanvas();
    const el = sectionEl(container, SECTION_IDS.custom);

    expect(el.querySelector('[data-testid="custom-block-section"]')).toBeTruthy();
    // NOT the new durable-tree path: custom-block's tree lives in props.tree.
    expect(el.querySelector(TREE_SECTION)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D8 — canvas and export consult the same emission gate
// ---------------------------------------------------------------------------

describe("SectionRenderer — canvas/export parity (P25 decision D8)", () => {
  it("switches to the tree path exactly when the export would emit the tree", () => {
    const { container } = renderCanvas();

    for (const [sectionId, tree] of [
      [SECTION_IDS.durable, sectionTree("x-durable", [{ id: "x-durable-h" }])],
      [
        SECTION_IDS.coded,
        sectionTree("x-coded", [{ id: "x-coded-h", customCode: ENABLED_CODE }]),
      ],
      [
        SECTION_IDS.disabled,
        sectionTree("x-disabled", [{ id: "x-disabled-h", customCode: DISABLED_CODE }]),
      ],
      [
        SECTION_IDS.overCap,
        sectionTree("x-overcap", [{ id: "x-overcap-h", customCode: OVER_CAP_CODE }]),
      ],
    ] as const) {
      const el = sectionEl(container, sectionId);
      const rendersTree = el.querySelector(TREE_SECTION) !== null;
      const exportEmits = buildSrcdocsForTreeRecord(tree) !== null;

      // The canvas tree path is selected if and only if the export pipeline
      // would emit a sandboxed frame for the same tree.
      expect(rendersTree).toBe(exportEmits);
    }
  });
});
