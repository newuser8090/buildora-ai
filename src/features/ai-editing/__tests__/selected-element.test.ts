// ---------------------------------------------------------------------------
// Phase P26 Slice 1 — selected element resolution across durable trees
//
//   - a nested element inside a DURABLE regular section (hero, features)
//     resolves as the AI element target (the P24-C follow-up #8 asymmetry)
//   - a section with NO element tree (legacy regular section) still resolves
//     to null — it has no element surface to target
//   - custom-block sections keep resolving exactly as before (no regression)
//   - the three-tier precedence is unchanged: canvas element selection, then
//     the inspector selection, then the section root
//   - a multi-selection never picks one of its ids; a non-renderable or
//     unknown target falls back to the section root rather than resolving
//
// The resolver is pure — these tests never touch a store.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll } from "vitest";
import { resolveElementEditTarget } from "../selected-element";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import type { Project } from "@/types/project";
import type { ElementTree, ElementNode } from "@/features/elements/types";

// The element registry (backing isRenderableElementType) needs the defaults.
beforeAll(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function node(overrides: Record<string, unknown> = {}): ElementNode {
  return {
    id: "root",
    type: "container",
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  } as unknown as ElementNode;
}

/** A durable tree for a regular section: container root + one heading child. */
function durableTree(sectionId: string, sectionType: string, childId: string): ElementTree {
  return {
    rootIds: [sectionId],
    nodes: {
      [sectionId]: node({
        id: sectionId,
        type: "container",
        parentId: null,
        children: [childId],
        props: { _sectionType: sectionType, _sectionId: sectionId },
      }),
      [childId]: node({
        id: childId,
        type: "heading",
        parentId: sectionId,
        props: { text: "Hello" },
      }),
    },
  } as unknown as ElementTree;
}

/** Legacy custom-block tree (props.tree), as P22-H built it. */
function customBlockTree(): ElementTree {
  return {
    rootIds: ["cb-root"],
    nodes: {
      "cb-root": node({ id: "cb-root", type: "container", parentId: null, children: ["cb-heading"] }),
      "cb-heading": node({ id: "cb-heading", type: "heading", parentId: "cb-root", props: { text: "Custom" } }),
    },
  } as unknown as ElementTree;
}

const HERO_CHILD = "hero-heading";
const FEATURES_CHILD = "features-heading";

function makeProject(): Project {
  const hero = {
    id: "s-hero",
    type: "hero",
    order: 1,
    visible: true,
    props: { headline: "Hero", subheadline: "Sub", primaryCta: { text: "Go", href: "#" } },
    styles: {},
  };
  return {
    id: "proj-p26",
    name: "P26",
    theme: {
      palette: {
        background: "#fff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#fff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#fff", border: "#e5e5e5", card: "#fff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          // DURABLE regular section — hero with a persisted element tree.
          { ...hero, tree: durableTree("s-hero", "hero", HERO_CHILD) },
          // DURABLE regular section — features.
          {
            id: "s-features",
            type: "features",
            order: 2,
            visible: true,
            props: {},
            styles: {},
            tree: durableTree("s-features", "features", FEATURES_CHILD),
          },
          // LEGACY regular section — no element tree at all.
          {
            id: "s-legacy",
            type: "cta",
            order: 3,
            visible: true,
            props: { headline: "Go", ctaText: "Start", href: "#" },
            styles: {},
          },
          // Legacy custom-block section — tree lives in props.tree.
          {
            id: "s-custom",
            type: CUSTOM_BLOCK_SECTION_TYPE,
            order: 4,
            visible: true,
            props: { name: "Design", tree: customBlockTree() },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as Project;
}

const PROJECT = makeProject();

function resolve(
  sectionId: string | null,
  canvasSelectionIds: string[] = [],
  inspectorSelectedId: string | null = null,
) {
  return resolveElementEditTarget({
    project: PROJECT,
    selectedPageId: "page-1",
    selectedSectionId: sectionId,
    canvasSelectionIds,
    inspectorSelectedId,
  });
}

// ---------------------------------------------------------------------------
// Durable regular sections (the P26 widening)
// ---------------------------------------------------------------------------

describe("resolveElementEditTarget — durable regular sections (P26 Slice 1)", () => {
  it("resolves a nested element in a durable hero section", () => {
    const target = resolve("s-hero", [HERO_CHILD]);
    expect(target).not.toBeNull();
    expect(target?.sectionId).toBe("s-hero");
    expect(target?.elementId).toBe(HERO_CHILD);
    expect(target?.node.type).toBe("heading");
    expect(target?.pageId).toBe("page-1");
  });

  it("resolves a nested element in a durable features section", () => {
    const target = resolve("s-features", [FEATURES_CHILD]);
    expect(target?.sectionId).toBe("s-features");
    expect(target?.elementId).toBe(FEATURES_CHILD);
  });

  it("resolves the section root when nothing nested is selected", () => {
    const target = resolve("s-hero");
    expect(target?.elementId).toBe("s-hero");
  });

  it("resolves a durable section's element through the inspector tier", () => {
    const target = resolve("s-hero", [], HERO_CHILD);
    expect(target?.elementId).toBe(HERO_CHILD);
  });
});

// ---------------------------------------------------------------------------
// Legacy sections + custom-block regression
// ---------------------------------------------------------------------------

describe("resolveElementEditTarget — guard", () => {
  it("returns null for a legacy section with no element tree", () => {
    expect(resolve("s-legacy", ["anything"])).toBeNull();
  });

  it("returns null when no section is selected", () => {
    expect(resolve(null)).toBeNull();
  });

  it("returns null for a section that does not exist", () => {
    expect(resolve("s-missing")).toBeNull();
  });

  it("keeps resolving custom-block sections (no regression)", () => {
    const target = resolve("s-custom", ["cb-heading"]);
    expect(target?.sectionId).toBe("s-custom");
    expect(target?.elementId).toBe("cb-heading");
    expect(target?.node.type).toBe("heading");
  });
});

// ---------------------------------------------------------------------------
// Precedence + fallback behaviour (unchanged by P26)
// ---------------------------------------------------------------------------

describe("resolveElementEditTarget — precedence and fallback", () => {
  it("prefers a canvas element selection over the inspector selection", () => {
    const target = resolve("s-hero", [HERO_CHILD], "s-hero");
    expect(target?.elementId).toBe(HERO_CHILD);
  });

  it("treats a canvas selection of the section root as section-level (root fallback)", () => {
    const target = resolve("s-hero", ["s-hero"], HERO_CHILD);
    expect(target?.elementId).toBe(HERO_CHILD);
  });

  it("never picks one id out of a multi-selection", () => {
    const target = resolve("s-hero", [HERO_CHILD, "s-hero"]);
    // Falls through to the section-root tier rather than guessing.
    expect(target?.elementId).toBe("s-hero");
  });

  it("falls back to the section root for an unknown element id", () => {
    const target = resolve("s-hero", ["ghost-element"]);
    expect(target?.elementId).toBe("s-hero");
  });

  it("falls back to the section root when the inspector id is not renderable", () => {
    // An element-only type has no renderer/durable persistence path, so it is
    // never a valid AI target; the root is the last resort.
    const target = resolve("s-hero", [], "s-hero");
    expect(target?.elementId).toBe("s-hero");
  });
});
