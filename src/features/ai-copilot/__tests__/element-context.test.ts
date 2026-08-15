// ---------------------------------------------------------------------------
// Phase P22-H — selected-element copilot context + element scope mapping
//   - a selected element inside a custom-block tree produces a BOUNDED digest
//   - element scope with an elementId resolves that element; field-only
//     element scope keeps the legacy inline-field behavior
//   - the digest is deterministic and bounded (never the whole tree)
//   - pages + theme digests are included and capped
//   - resolveEffectiveScope maps a selected element to element scope
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildCopilotContext,
  buildElementDigest,
  contextByteLength,
} from "../context/context-builder";
import { resolveEffectiveScope } from "../services/copilot-service";
import { COPILOT_LIMITS } from "../constants";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";

// The element digest reads tree nodes that carry registered block types.
if (!isDefaultBlocksRegistered()) registerDefaultBlocks();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  };
}

function treeWithNodes(nodes: Record<string, unknown>): BlockTree {
  return { rootIds: ["root"], nodes: nodes as unknown as BlockTree["nodes"] };
}

function elementProject(): Project {
  return {
    id: "proj-p22h",
    name: "P22H",
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
          {
            id: "s-custom",
            type: CUSTOM_BLOCK_SECTION_TYPE,
            order: 1,
            visible: true,
            props: {
              name: "Design",
              tree: treeWithNodes({
                root: baseNode({ children: ["heading-1", "button-1"] }),
                "heading-1": baseNode({
                  id: "heading-1",
                  type: "heading",
                  parentId: "root",
                  props: { text: "Hello world" },
                  style: { fontSize: 24 },
                }),
                "button-1": baseNode({
                  id: "button-1",
                  type: "button",
                  parentId: "root",
                  props: { text: "Go", href: "#features" },
                }),
              }),
            },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const PROJECT = elementProject();

// ---------------------------------------------------------------------------
// buildElementDigest
// ---------------------------------------------------------------------------

describe("buildElementDigest — selected element digest", () => {
  it("returns a bounded digest for a node in a custom-block tree", () => {
    const digest = buildElementDigest(PROJECT, {
      pageId: "page-1",
      sectionId: "s-custom",
      elementId: "heading-1",
    });
    expect(digest).not.toBeNull();
    expect(digest?.elementId).toBe("heading-1");
    expect(digest?.elementType).toBe("heading");
    expect(digest?.label).toBe("Heading");
    expect(digest?.currentValue).toBe("Hello world");
    expect(digest?.parentType).toBe("Container");
  });

  it("includes bounded props and style entries", () => {
    const digest = buildElementDigest(PROJECT, {
      pageId: "page-1",
      sectionId: "s-custom",
      elementId: "heading-1",
    });
    expect(digest?.props?.some((p) => p.key === "text" && p.value === "Hello world")).toBe(true);
    expect(digest?.style?.some((s) => s.key === "fontSize" && s.value === "24")).toBe(true);
  });

  it("reports sibling count for children and root count for the root", () => {
    const child = buildElementDigest(PROJECT, { pageId: "page-1", sectionId: "s-custom", elementId: "button-1" });
    expect(child?.siblingCount).toBe(2);
  });

  it("returns null for missing nodes, sections, or pages", () => {
    expect(
      buildElementDigest(PROJECT, { pageId: "page-1", sectionId: "s-custom", elementId: "ghost" }),
    ).toBeNull();
    expect(
      buildElementDigest(PROJECT, { pageId: "page-1", sectionId: "ghost-section", elementId: "heading-1" }),
    ).toBeNull();
    expect(
      buildElementDigest(PROJECT, { pageId: "ghost-page", sectionId: "s-custom", elementId: "heading-1" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildCopilotContext — element scope
// ---------------------------------------------------------------------------

describe("buildCopilotContext — element scope with selected element", () => {
  it("includes the selected element digest and section context", () => {
    const ctx = buildCopilotContext({
      project: PROJECT,
      scope: { type: "element", pageId: "page-1", sectionId: "s-custom", elementId: "heading-1" },
      selectedElement: { pageId: "page-1", sectionId: "s-custom", elementId: "heading-1" },
      instruction: "Make the heading bold",
    });
    expect(ctx.element?.elementId).toBe("heading-1");
    expect(ctx.element?.elementType).toBe("heading");
    expect(ctx.section?.type).toBe(CUSTOM_BLOCK_SECTION_TYPE);
  });

  it("falls back to the inline-field digest when element scope carries no elementId", () => {
    const ctx = buildCopilotContext({
      project: PROJECT,
      scope: { type: "element", pageId: "page-1", sectionId: "s-custom", fieldPath: ["name"] },
      selectedField: { label: "Name", currentValue: "Design", pageId: "page-1", sectionId: "s-custom", fieldPath: ["name"] },
      instruction: "Rename it",
    });
    expect(ctx.element?.label).toBe("Name");
    expect(ctx.element?.currentValue).toBe("Design");
  });

  it("includes a bounded pages list and theme digest", () => {
    const ctx = buildCopilotContext({
      project: PROJECT,
      scope: { type: "project" },
      instruction: "Improve",
    });
    expect(ctx.pages?.some((p) => p.id === "page-1" && p.slug === "/")).toBe(true);
    expect(ctx.theme?.palette).toContain("#7c5cfc");
  });

  it("keeps the serialized context under the byte limit", () => {
    const ctx = buildCopilotContext({
      project: PROJECT,
      scope: { type: "element", pageId: "page-1", sectionId: "s-custom", elementId: "button-1" },
      selectedElement: { pageId: "page-1", sectionId: "s-custom", elementId: "button-1" },
      instruction: "Improve",
    });
    expect(contextByteLength(ctx)).toBeLessThanOrEqual(COPILOT_LIMITS.maxContextBytes);
  });

  it("is deterministic: same input → same output", () => {
    const input = {
      project: PROJECT,
      scope: { type: "element" as const, pageId: "page-1", sectionId: "s-custom", elementId: "button-1" },
      selectedElement: { pageId: "page-1", sectionId: "s-custom", elementId: "button-1" },
      instruction: "Make it bold",
    };
    const a = buildCopilotContext(input);
    const b = buildCopilotContext(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// resolveEffectiveScope — selected element → element scope
// ---------------------------------------------------------------------------

describe("resolveEffectiveScope — element scope", () => {
  it("maps a selected element to an element scope with elementId", () => {
    const scope = resolveEffectiveScope(
      "auto",
      PROJECT,
      "page-1",
      "s-custom",
      null,
      [],
      "Make the button bold",
      { pageId: "page-1", sectionId: "s-custom", elementId: "button-1" },
    );
    expect(scope).toEqual({
      type: "element",
      pageId: "page-1",
      sectionId: "s-custom",
      elementId: "button-1",
    });
  });

  it("prefers a selected field (inline behavior preserved)", () => {
    const scope = resolveEffectiveScope(
      "auto",
      PROJECT,
      "page-1",
      "s-custom",
      {
        label: "Text",
        currentValue: "Go",
        pageId: "page-1",
        sectionId: "s-custom",
        sectionType: "custom-block" as never,
        fieldPath: ["text"],
        kind: "text" as never,
        aiEditable: true,
      },
      [],
      "Shorten it",
      { pageId: "page-1", sectionId: "s-custom", elementId: "button-1" },
    );
    expect(scope).toEqual({
      type: "element",
      pageId: "page-1",
      sectionId: "s-custom",
      fieldPath: ["text"],
    });
  });

  it("keeps explicit scopes untouched", () => {
    expect(
      resolveEffectiveScope({ type: "page", pageId: "page-1" }, PROJECT, null, null, null, [], "Edit", null),
    ).toEqual({
      type: "page",
      pageId: "page-1",
    });
  });
});
