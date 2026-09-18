// ---------------------------------------------------------------------------
// Phase P24-B — collaboration normalization of durable section trees
//   - durable SectionElement.tree survives section + project normalization
//   - tree normalization runs before projection (bounded, schema-safe)
//   - malformed / oversized trees are clamped, never propagated raw
//   - old projects without durable trees normalize unchanged
//   - durable trees merge through the existing shape-agnostic CRDT bridge
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { normalizeProject, normalizeSections } from "../crdt/tree-normalizer";
import { initFromProject, reconcileProject, toProject } from "../crdt/collab-doc";
import type { Project } from "@/types/project";
import type { ElementTree } from "@/features/elements/types";

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

function durableHeroTree(): ElementTree {
  return {
    rootIds: ["s-hero"],
    nodes: {
      "s-hero": {
        id: "s-hero",
        type: "container",
        parentId: null,
        children: ["b-head"],
        props: { _sectionType: "hero", _sectionId: "s-hero" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        geometry: { mode: "absolute", x: 10, y: 20, width: 320 },
      },
      "b-head": {
        id: "b-head",
        type: "heading",
        parentId: "s-hero",
        children: [],
        props: { text: "Durable headline" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        animation: { trigger: "load", type: "fade" },
      },
    },
  };
}

function heroSectionWithTree(): Record<string, unknown> {
  return {
    id: "s-hero",
    type: "hero",
    order: 1,
    visible: true,
    props: { headline: "Durable headline", primaryCta: { text: "Go", href: "#" } },
    styles: {},
    tree: durableHeroTree(),
  };
}

describe("normalizeSections — durable section trees", () => {
  it("preserves a valid durable tree through section normalization", () => {
    const out = normalizeSections([heroSectionWithTree()]);
    expect(out).toHaveLength(1);
    const tree = out[0].tree;
    expect(tree).toBeDefined();
    expect(tree?.nodes["s-hero"].geometry).toMatchObject({ x: 10, y: 20 });
    expect(tree?.nodes["b-head"].animation).toMatchObject({ type: "fade" });
    expect(tree?.nodes["b-head"].props.text).toBe("Durable headline");
  });

  it("drops a corrupt tree field but keeps the section legacy", () => {
    const section = heroSectionWithTree();
    section.tree = { rootIds: [], nodes: {} }; // unrecoverable
    const out = normalizeSections([section]);
    expect(out).toHaveLength(1);
    expect(out[0].tree).toBeUndefined();
    // Props are untouched — the section stays fully functional.
    expect((out[0].props as Record<string, unknown>).headline).toBe("Durable headline");
  });

  it("clamps an oversized durable tree (depth) before projection", () => {
    // Build a chain deeper than ELEMENT_MAX_DEPTH (12).
    const nodes: Record<string, Record<string, unknown>> = {};
    const rootId = "n0";
    nodes[rootId] = baseNode({ id: rootId });
    let parent = rootId;
    let childId = "n1";
    for (let i = 1; i <= 20; i += 1) {
      childId = `n${i}`;
      nodes[childId] = baseNode({
        id: childId,
        parentId: parent,
        children: i < 20 ? [`n${i + 1}`] : [],
        type: "heading",
      });
      nodes[parent].children = [childId];
      parent = childId;
    }
    const section = heroSectionWithTree();
    section.tree = { rootIds: [rootId], nodes } as unknown as ElementTree;
    const out = normalizeSections([section]);
    const tree = out[0].tree;
    expect(tree).toBeDefined();
    // Depth is bounded — nodes beyond the cap are pruned.
    const maxDepth = (t: ElementTree): number => {
      const walk = (id: string, d: number, seen: Set<string>): number => {
        if (seen.has(id)) return d;
        const node = t.nodes[id];
        if (!node) return d;
        seen.add(id);
        let deepest = d;
        for (const c of node.children) {
          deepest = Math.max(deepest, walk(c, d + 1, new Set(seen)));
        }
        return deepest;
      };
      return walk(t.rootIds[0], 0, new Set());
    };
    if (tree) expect(maxDepth(tree)).toBeLessThanOrEqual(12);
  });

  it("old sections without a durable tree normalize unchanged (no tree added)", () => {
    const out = normalizeSections([
      {
        id: "s-legacy",
        type: "footer",
        order: 1,
        visible: true,
        props: { text: "© 2026", links: [] },
        styles: {},
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tree).toBeUndefined();
    expect((out[0].props as Record<string, unknown>).text).toBe("© 2026");
  });
});

describe("normalizeProject — durable trees in full projects", () => {
  it("carries durable section trees through project normalization", () => {
    const project = normalizeProject({
      id: "p1",
      name: "Site",
      pages: [
        { id: "page-1", title: "Home", slug: "/", sections: [heroSectionWithTree()] },
      ],
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(project.pages[0].sections[0].tree).toBeDefined();
  });

  it("old projects without durable trees still normalize", () => {
    const project = normalizeProject({
      id: "p1",
      name: "Site",
      pages: [
        {
          id: "page-1",
          title: "Home",
          slug: "/",
          sections: [
            { id: "s1", type: "hero", order: 1, visible: true, props: { headline: "Hi" }, styles: {} },
          ],
        },
      ],
      assets: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(project.pages[0].sections[0].tree).toBeUndefined();
  });
});

describe("durable trees through the CRDT bridge", () => {
  function makeProject(): Project {
    return {
      id: "p-collab",
      name: "Collab",
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
      assets: [],
      pages: [
        {
          id: "page-1",
          title: "Home",
          slug: "/",
          sections: [heroSectionWithTree() as unknown as Project["pages"][number]["sections"][number]],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
  }

  it("a durable tree survives init → project → reconcile → project", () => {
    const doc = new Y.Doc();
    const project = makeProject();
    initFromProject(doc, project);
    const projected = toProject(doc);
    expect(projected.pages[0].sections[0].tree).toBeDefined();
    expect(projected.pages[0].sections[0].tree?.nodes["b-head"].props.text).toBe("Durable headline");
    expect(projected.pages[0].sections[0].tree?.nodes["s-hero"].geometry).toMatchObject({ x: 10, y: 20 });

    // A local tree edit merges through the existing bridge.
    const edited = JSON.parse(JSON.stringify(project)) as Project;
    const section = edited.pages[0].sections[0] as { tree?: ElementTree };
    const tree = section.tree!;
    section.tree = {
      ...tree,
      nodes: {
        ...tree.nodes,
        "b-head": { ...tree.nodes["b-head"], props: { ...tree.nodes["b-head"].props, text: "Merged edit" } },
      },
    };
    reconcileProject(doc, edited);
    const merged = toProject(doc);
    expect(merged.pages[0].sections[0].tree?.nodes["b-head"].props.text).toBe("Merged edit");
    // Geometry survived the merge.
    expect(merged.pages[0].sections[0].tree?.nodes["s-hero"].geometry).toMatchObject({ x: 10, y: 20 });
  });

  it("old projects without trees still merge through the bridge", () => {
    const doc = new Y.Doc();
    const project = makeProject();
    delete (project.pages[0].sections[0] as { tree?: unknown }).tree;
    initFromProject(doc, project);
    const projected = toProject(doc);
    expect(projected.pages[0].sections[0].tree).toBeUndefined();
    reconcileProject(doc, project);
    expect(toProject(doc).pages[0].sections[0].tree).toBeUndefined();
  });
});
