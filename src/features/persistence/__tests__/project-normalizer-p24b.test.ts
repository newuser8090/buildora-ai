// ---------------------------------------------------------------------------
// Phase P24-B — normalizer security: durable section trees
//   - depth / node-count / text caps clamp pathological input
//   - invalid geometry / animation / interaction / binding payloads are dropped
//   - oversized custom-code payloads are clamped to the schema caps
//   - corrupt trees are dropped (section stays legacy), never propagated raw
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { normalizeProject } from "../services/project-normalizer";
import { ELEMENT_MAX_DEPTH, ELEMENT_MAX_NODES, ELEMENT_MAX_TEXT_LENGTH, ELEMENT_MAX_CUSTOM_CODE_LENGTH } from "@/features/elements/schemas/element-schemas";
import type { ElementTree } from "@/features/elements/types";

function makeRawProject(section: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "proj-sec",
    name: "Security",
    theme: {
      palette: {
        background: "#fff", foreground: "#000", primary: "#7c5cfc", primaryForeground: "#fff",
        secondary: "#f5f5f5", secondaryForeground: "#000", muted: "#f5f5f5",
        mutedForeground: "#737373", accent: "#7c5cfc", accentForeground: "#fff",
        border: "#e5e5e5", card: "#fff", cardForeground: "#000",
      },
      typography: { fontFamily: "sans-serif", headingFont: "sans-serif", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "5rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [section],
      },
    ],
    assets: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sectionWithTree(tree: unknown): Record<string, unknown> {
  return {
    id: "s-hero",
    type: "hero",
    order: 1,
    visible: true,
    props: { headline: "Hello", primaryCta: { text: "Go", href: "#" } },
    styles: {},
    tree,
  };
}

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

function normalizedTree(rawProject: Record<string, unknown>): ElementTree | undefined {
  const result = normalizeProject(rawProject);
  expect(result.success).toBe(true);
  if (!result.success) return undefined;
  const section = result.project.pages[0].sections[0] as { tree?: ElementTree };
  return section.tree;
}

function treeDepth(tree: ElementTree): number {
  const walk = (id: string, d: number, seen: Set<string>): number => {
    if (seen.has(id)) return d;
    const node = tree.nodes[id];
    if (!node) return d;
    seen.add(id);
    let deepest = d;
    for (const child of node.children) {
      deepest = Math.max(deepest, walk(child, d + 1, new Set(seen)));
    }
    return deepest;
  };
  return walk(tree.rootIds[0], 0, new Set());
}

describe("durable tree bounds", () => {
  it("clamps depth beyond the maximum", () => {
    const nodes: Record<string, Record<string, unknown>> = {};
    const rootId = "n0";
    nodes[rootId] = baseNode({ id: rootId });
    let parent = rootId;
    for (let i = 1; i <= 20; i += 1) {
      const id = `n${i}`;
      nodes[id] = baseNode({
        id,
        parentId: parent,
        children: i < 20 ? [`n${i + 1}`] : [],
        type: "heading",
      });
      nodes[parent].children = [id];
      parent = id;
    }
    const tree = normalizedTree(makeRawProject(sectionWithTree({ rootIds: [rootId], nodes })));
    expect(tree).toBeDefined();
    if (tree) expect(treeDepth(tree)).toBeLessThanOrEqual(ELEMENT_MAX_DEPTH);
  });

  it("bounds the node count to the maximum", () => {
    const nodes: Record<string, Record<string, unknown>> = {};
    const rootId = "root";
    nodes[rootId] = baseNode({ id: rootId });
    // root → 32 children → 32 grandchildren each = 1 + 32 + 1024 nodes.
    const childIds: string[] = [];
    for (let i = 0; i < 32; i += 1) {
      const childId = `c${i}`;
      childIds.push(childId);
      const grandIds: string[] = [];
      for (let j = 0; j < 32; j += 1) {
        const grandId = `g${i}-${j}`;
        grandIds.push(grandId);
        nodes[grandId] = baseNode({
          id: grandId,
          parentId: childId,
          type: "heading",
          children: [],
          props: { text: `item ${i}-${j}` },
        });
      }
      nodes[childId] = baseNode({ id: childId, parentId: rootId, type: "container", children: grandIds });
    }
    nodes[rootId].children = childIds;

    const tree = normalizedTree(makeRawProject(sectionWithTree({ rootIds: [rootId], nodes })));
    expect(tree).toBeDefined();
    if (tree) {
      expect(Object.keys(tree.nodes).length).toBeLessThanOrEqual(ELEMENT_MAX_NODES);
    }
  });

  it("clamps oversized text in tree props", () => {
    const long = "x".repeat(ELEMENT_MAX_TEXT_LENGTH + 2000);
    const tree = normalizedTree(makeRawProject(sectionWithTree({
      rootIds: ["root"],
      nodes: { root: baseNode({ children: ["b1"] }), b1: baseNode({ id: "b1", parentId: "root", type: "heading", props: { text: long } }) },
    })));
    expect(tree).toBeDefined();
    expect(tree?.nodes.b1.props.text).toHaveLength(ELEMENT_MAX_TEXT_LENGTH);
  });

  it("clamps oversized custom code to the code cap", () => {
    const bigCss = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 5000);
    const tree = normalizedTree(makeRawProject(sectionWithTree({
      rootIds: ["root"],
      nodes: {
        root: baseNode({
          children: ["b1"],
          customCode: { enabled: true, css: bigCss, html: "<div>hi</div>" },
        }),
        b1: baseNode({ id: "b1", parentId: "root", type: "heading" }),
      },
    })));
    expect(tree).toBeDefined();
    const customCode = tree?.nodes.root.customCode;
    // The payload is clamped (never dropped for being too large), and it still
    // satisfies the schema's own total cap.
    expect(customCode).toBeDefined();
    const css = (customCode as { css?: string } | undefined)?.css;
    expect(css?.length ?? 0).toBeLessThanOrEqual(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
  });
});

describe("invalid element metadata is dropped (never coerced)", () => {
  it.each([
    ["geometry", { geometry: { width: "not-a-number" } }],
    ["animation", { animation: { trigger: "bogus", type: "fade" } }],
    ["interaction", { interaction: { click: { kind: "teleport" } } }],
    ["binding", { binding: { source: "bogus" } }],
    // The viewport schema is strict — an unknown breakpoint key fails it, so
    // the whole field is dropped (unsafe CSS values are scrubbed to {} by
    // sanitizeJson first, which is also schema-valid).
    ["viewport", { viewport: { bogus: { fontSize: "12px" } } }],
  ] as const)("drops invalid %s payloads", (_field, overrides) => {
    const tree = normalizedTree(makeRawProject(sectionWithTree({
      rootIds: ["root"],
      nodes: { root: baseNode(overrides) },
    })));
    expect(tree).toBeDefined();
    if (!tree) return;
    const root = tree.nodes.root as unknown as Record<string, unknown>;
    const field = Object.keys(overrides)[0];
    expect(root[field]).toBeUndefined();
    // The node itself survives.
    expect(root.type).toBe("container");
  });

  it("drops a corrupt tree and keeps the section legacy", () => {
    const result = normalizeProject(makeRawProject(sectionWithTree({ rootIds: [], nodes: {} })));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0] as { tree?: ElementTree } & { props: Record<string, unknown> };
    expect(section.tree).toBeUndefined();
    // Legacy props are preserved verbatim.
    expect(section.props.headline).toBe("Hello");
  });
});
