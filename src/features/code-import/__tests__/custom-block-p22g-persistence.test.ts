// ---------------------------------------------------------------------------
// Phase P22-G — durable persistence of declarative animations + interactions
//   - animation survives save/reload (normalizeCustomBlockTree)
//   - interaction survives save/reload
//   - null/absence remains valid
//   - old nodes (no animation/interaction) remain valid
//   - invalid animation/interaction is rejected (dropped, never stored)
//   - schema bounds remain enforced
//   - serializer round trip preserves the data
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BlockTree } from "@/features/blocks/types";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";
import { normalizeCustomBlockTree, CustomBlockTreeSchema } from "@/features/code-import/schemas/custom-block-schema";
import { serializeProject, deserializeProject } from "@/features/persistence/services/project-serializer";
import type { Project } from "@/types/project";

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
  return {
    rootIds: Object.keys(nodes),
    nodes: nodes as unknown as BlockTree["nodes"],
  };
}

const FADE = { trigger: "load", type: "fade", durationMs: 400, delayMs: 0 };
const NAVIGATE_INTERACTION = {
  click: { kind: "navigate", target: { kind: "page", pageId: "home" } },
  hover: { color: "#ff0000", scale: 1.05 },
};

function projectWithTree(tree: BlockTree): Project {
  return {
    id: "proj-p22g",
    name: "P22G",
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
            props: { name: "Design", tree },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Schema boundary
// ---------------------------------------------------------------------------

describe("CustomBlockNodeSchema — animation + interaction fields", () => {
  it("accepts nodes with animation and interaction", () => {
    const result = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({ animation: FADE, interaction: NAVIGATE_INTERACTION }),
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts nodes without animation/interaction (old projects)", () => {
    const result = CustomBlockTreeSchema.safeParse(treeWithNodes({ root: baseNode() }));
    expect(result.success).toBe(true);
  });

  it("rejects malformed animation", () => {
    const result = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({ animation: { trigger: "bogus", type: "fade" } }),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects malformed interaction (unsafe URL, unknown kind)", () => {
    const unsafeUrl = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({
          interaction: { click: { kind: "navigate", target: { kind: "external", url: "javascript:evil()" } } },
        }),
      }),
    );
    expect(unsafeUrl.success).toBe(false);

    const unknownKind = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({ interaction: { click: { kind: "teleport" } } }),
      }),
    );
    expect(unknownKind.success).toBe(false);
  });

  it("enforces animation bounds", () => {
    const overDuration = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({ animation: { trigger: "load", type: "fade", durationMs: 1_000_000 } }),
      }),
    );
    expect(overDuration.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeCustomBlockTree — save/reload parity
// ---------------------------------------------------------------------------

describe("normalizeCustomBlockTree — animation/interaction survival", () => {
  it("carries animation through repair", () => {
    const tree = treeWithNodes({ root: baseNode({ animation: FADE }) });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    expect(normalized).not.toBeNull();
    const root = normalized?.nodes.root as { animation?: unknown };
    expect(root?.animation).toEqual(FADE);
  });

  it("carries interaction through repair (navigate + hover)", () => {
    const tree = treeWithNodes({ root: baseNode({ interaction: NAVIGATE_INTERACTION }) });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { interaction?: unknown };
    expect(root?.interaction).toEqual(NAVIGATE_INTERACTION);
  });

  it("carries animation + interaction alongside geometry and viewport", () => {
    const tree = treeWithNodes({
      root: baseNode({
        animation: FADE,
        interaction: NAVIGATE_INTERACTION,
        geometry: { mode: "absolute", x: 10, y: 20, width: 300 },
        viewport: { mobile: { fontSize: "14px" } },
      }),
    });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as {
      animation?: unknown;
      interaction?: unknown;
      geometry?: unknown;
      viewport?: unknown;
    };
    expect(root?.animation).toEqual(FADE);
    expect(root?.interaction).toEqual(NAVIGATE_INTERACTION);
    expect(root?.geometry).toMatchObject({ x: 10, y: 20 });
    expect(root?.viewport).toMatchObject({ mobile: { fontSize: "14px" } });
  });

  it("drops malformed animation/interaction during repair", () => {
    const tree = treeWithNodes({
      root: baseNode({
        animation: { trigger: "nope", type: "fade" },
        interaction: { click: { kind: "teleport" } },
      }),
    });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toBeUndefined();
    expect(root?.interaction).toBeUndefined();
  });

  it("old nodes without animation/interaction normalize unchanged", () => {
    const tree = treeWithNodes({ root: baseNode() });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toBeUndefined();
    expect(root?.interaction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Project serializer round trip
// ---------------------------------------------------------------------------

describe("project serializer round trip — P22-G data survives", () => {
  it("animation + interaction survive save/reload of the project", () => {
    const tree = treeWithNodes({ root: baseNode({ animation: FADE, interaction: NAVIGATE_INTERACTION }) });
    const json = serializeProject(projectWithTree(tree));
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0];
    const stored = (section.props as { tree?: BlockTree }).tree;
    const root = stored?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toEqual(FADE);
    expect(root?.interaction).toEqual(NAVIGATE_INTERACTION);
  });

  it("old projects (no animation/interaction) round-trip unchanged", () => {
    const json = serializeProject(projectWithTree(treeWithNodes({ root: baseNode() })));
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0];
    const stored = (section.props as { tree?: BlockTree }).tree;
    const root = stored?.nodes.root as { animation?: unknown; interaction?: unknown };
    expect(root?.animation).toBeUndefined();
    expect(root?.interaction).toBeUndefined();
  });
});
