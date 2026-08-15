// ---------------------------------------------------------------------------
// Phase P23-C — durable persistence of OPT-IN custom code on custom-block nodes
//   - customCode survives schema parsing (shared P23-A ElementCustomCodeSchema)
//   - valid customCode survives normalization (normalizeCustomBlockTree)
//   - malformed customCode is dropped during repair (never stored)
//   - enabled defaults to false for legacy payloads (stays inert on reload)
//   - enabled:true survives a full save/reload round trip
//   - old nodes (no customCode) remain valid and normalize unchanged
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BlockTree } from "@/features/blocks/types";
import {
  CUSTOM_BLOCK_SECTION_TYPE,
  normalizeCustomBlockTree,
  CustomBlockTreeSchema,
} from "@/features/code-import/schemas/custom-block-schema";
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

const ENABLED_CODE = {
  enabled: true,
  css: "p { color: red; }",
  js: "console.log('hello')",
  html: "<span data-x='1'>hi</span>",
  attributes: { "data-x": "y" },
};

const LEGACY_CODE = { css: "p { color: red; }" };

function projectWithTree(tree: BlockTree): Project {
  return {
    id: "proj-p23c",
    name: "P23C",
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

describe("CustomBlockNodeSchema — customCode field", () => {
  it("accepts nodes with enabled custom code (shared P23-A schema)", () => {
    const result = CustomBlockTreeSchema.safeParse(
      treeWithNodes({ root: baseNode({ customCode: ENABLED_CODE }) }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nodes.root.customCode?.enabled).toBe(true);
    expect(result.data.nodes.root.customCode?.js).toBe("console.log('hello')");
  });

  it("accepts legacy customCode (enabled defaults to false at parse)", () => {
    const result = CustomBlockTreeSchema.safeParse(
      treeWithNodes({ root: baseNode({ customCode: LEGACY_CODE }) }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    // The P23-A schema is the ONLY vocabulary: absent `enabled` → false, so
    // the payload stays inert after reload.
    expect(result.data.nodes.root.customCode?.enabled).toBe(false);
    expect(result.data.nodes.root.customCode?.css).toBe("p { color: red; }");
  });

  it("accepts nodes without customCode (old projects)", () => {
    const result = CustomBlockTreeSchema.safeParse(treeWithNodes({ root: baseNode() }));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.nodes.root.customCode).toBeUndefined();
  });

  it("rejects malformed customCode (per-field cap)", () => {
    const result = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({ customCode: { enabled: true, js: "x".repeat(20_001) } }),
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects malformed customCode (aggregate cap)", () => {
    const atCap = "x".repeat(20_000);
    const result = CustomBlockTreeSchema.safeParse(
      treeWithNodes({
        root: baseNode({ customCode: { enabled: true, html: atCap, css: atCap, js: atCap } }),
      }),
    );
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeCustomBlockTree — save/reload parity
// ---------------------------------------------------------------------------

describe("normalizeCustomBlockTree — customCode survival", () => {
  it("carries valid enabled customCode through repair", () => {
    const tree = treeWithNodes({ root: baseNode({ customCode: ENABLED_CODE }) });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { customCode?: Record<string, unknown> };
    expect(root?.customCode).toEqual(ENABLED_CODE);
  });

  it("defaults enabled to false for legacy payloads during repair", () => {
    const tree = treeWithNodes({ root: baseNode({ customCode: LEGACY_CODE }) });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { customCode?: Record<string, unknown> };
    expect(root?.customCode?.enabled).toBe(false);
    expect(root?.customCode?.css).toBe("p { color: red; }");
  });

  it("drops malformed customCode during repair", () => {
    const tree = treeWithNodes({
      root: baseNode({ customCode: { enabled: true, js: "x".repeat(20_001) } }),
    });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { customCode?: unknown };
    expect(root?.customCode).toBeUndefined();
  });

  it("old nodes without customCode normalize unchanged", () => {
    const tree = treeWithNodes({ root: baseNode() });
    const normalized = normalizeCustomBlockTree(JSON.parse(JSON.stringify(tree)));
    const root = normalized?.nodes.root as { customCode?: unknown };
    expect(root?.customCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Project serializer round trip
// ---------------------------------------------------------------------------

describe("project serializer round trip — P23-C data survives", () => {
  it("enabled customCode survives save/reload", () => {
    const json = serializeProject(projectWithTree(treeWithNodes({ root: baseNode({ customCode: ENABLED_CODE }) })));
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0];
    const stored = (section.props as { tree?: BlockTree }).tree;
    const root = stored?.nodes.root as { customCode?: Record<string, unknown> };
    expect(root?.customCode?.enabled).toBe(true);
    expect(root?.customCode?.css).toBe("p { color: red; }");
    expect(root?.customCode?.js).toBe("console.log('hello')");
  });

  it("legacy customCode round-trips as inert data and defaults to disabled at the schema boundary", () => {
    const json = serializeProject(projectWithTree(treeWithNodes({ root: baseNode({ customCode: LEGACY_CODE }) })));
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0];
    const stored = (section.props as { tree?: BlockTree }).tree;
    const root = stored?.nodes.root as { customCode?: Record<string, unknown> };
    // Inert data survives the raw JSON round trip; it is never enabled.
    expect(root?.customCode?.css).toBe("p { color: red; }");
    expect(root?.customCode?.enabled).not.toBe(true);
    // The persistence schema deterministically defaults the payload to
    // disabled, so nothing can execute on reload.
    const parsed = CustomBlockTreeSchema.safeParse(stored as never);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nodes.root.customCode?.enabled).toBe(false);
    }
  });

  it("old projects (no customCode) round-trip unchanged", () => {
    const json = serializeProject(projectWithTree(treeWithNodes({ root: baseNode() })));
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0];
    const stored = (section.props as { tree?: BlockTree }).tree;
    const root = stored?.nodes.root as { customCode?: unknown };
    expect(root?.customCode).toBeUndefined();
  });
});
