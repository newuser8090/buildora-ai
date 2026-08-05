// ---------------------------------------------------------------------------
// Phase P3 — custom-block persistence
//   - serializer round trip preserves custom-block sections + metadata
//   - project import/export (deserialize) keeps the tree intact
//   - duplicate project / section duplication keeps block ids unique
//   - legacy / malformed custom blocks normalize on load
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { serializeProject, deserializeProject } from "@/features/persistence/services/project-serializer";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";

function makeTree(): BlockTree {
  return {
    rootIds: ["root"],
    nodes: {
      root: {
        id: "root",
        type: "container",
        parentId: null,
        children: ["head"],
        props: { name: "Pricing" },
        style: { padding: "1rem" },
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
      },
      head: {
        id: "head",
        type: "heading",
        parentId: "root",
        children: [],
        props: { text: "Simple pricing" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
      },
    },
  };
}

function makeProject(): Project {
  return {
    id: "proj-persist",
    name: "Persist",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
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
              name: "Pricing",
              tree: makeTree(),
              sourceMetadata: {
                language: "html",
                importedAt: "2026-01-01T00:00:00.000Z",
                sourceHash: "abcd1234",
                converterVersion: 1,
                warningCount: 1,
              },
            },
            styles: {},
          },
          {
            id: "s-hero",
            type: "hero",
            order: 2,
            visible: true,
            props: { headline: "H", subheadline: "S", primaryCta: { text: "Go", href: "#" } },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("serializer round trip", () => {
  it("preserves the custom-block section, tree and metadata", () => {
    const json = serializeProject(makeProject());
    const result = deserializeProject(json);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections.find((s) => s.id === "s-custom");
    expect(section?.type).toBe(CUSTOM_BLOCK_SECTION_TYPE);
    const props = section?.props as { name: string; tree: BlockTree; sourceMetadata?: unknown };
    expect(props?.name).toBe("Pricing");
    expect(props?.tree.rootIds).toEqual(["root"]);
    expect(Object.keys(props?.tree.nodes ?? {})).toHaveLength(2);
    expect((props?.tree.nodes.head.props as { text: string }).text).toBe("Simple pricing");
    expect(props?.sourceMetadata).toBeDefined();
  });

  it("does not store the pasted source code", () => {
    const json = serializeProject(makeProject());
    expect(json).not.toContain("<div");
    expect(json).not.toContain("onClick");
    expect(json).toContain("abcd1234"); // the hash IS stored
  });

  it("keeps legacy built-in sections untouched alongside custom blocks", () => {
    const result = deserializeProject(serializeProject(makeProject()));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const hero = result.project.pages[0].sections.find((s) => s.id === "s-hero");
    expect(hero?.type).toBe("hero");
    expect((hero?.props as { headline: string }).headline).toBe("H");
  });
});

describe("malformed / legacy custom blocks", () => {
  it("loads without crashing and repairs the tree at projection time", () => {
    const project = makeProject();
    const props = project.pages[0].sections[0].props as { tree: BlockTree };
    props.tree = {
      rootIds: ["root"],
      nodes: {
        root: {
          id: "root",
          type: "mystery" as never,
          parentId: null,
          children: [],
          props: {},
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
      },
    };
    // Project-level round trip succeeds (schema is intentionally permissive
    // about section props); the deep repair happens when the tree is used.
    const result = deserializeProject(serializeProject(project));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const section = result.project.pages[0].sections[0];
    // Projection drops the unknown node and yields a safe editable root.
    const tree = customBlockTreeFromSection(section);
    expect(tree.rootIds[0]).toBe(section.id);
    const root = tree.nodes[tree.rootIds[0]];
    expect(root.type).toBe("container");
  });

  it("rejects dangerous keys in persisted trees through the schema boundary", () => {
    const project = makeProject();
    const props = project.pages[0].sections[0].props as { tree: BlockTree };
    props.tree = {
      rootIds: ["root"],
      nodes: {
        root: {
          id: "root",
          type: "container",
          parentId: null,
          children: [],
          props: JSON.parse('{"__proto__": "polluted"}'),
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
      },
    };
    // Projection normalizes the tree and strips dangerous keys — never crashes.
    const section = project.pages[0].sections[0];
    const tree = customBlockTreeFromSection(section);
    const root = tree.nodes[tree.rootIds[0]];
    expect(Object.prototype.hasOwnProperty.call(root.props, "__proto__")).toBe(false);
  });
});

describe("editor store + duplication", () => {
  beforeEach(() => {
    if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
    useEditorStore.getState().hydrateProject(makeProject(), 1);
  });

  it("projects a persisted custom block back to an editable tree", () => {
    const section = useEditorStore.getState().project.pages[0].sections[0];
    expect(section.type).toBe(CUSTOM_BLOCK_SECTION_TYPE);
    const tree = customBlockTreeFromSection(section);
    expect(tree.rootIds[0]).toBe(section.id);
    expect(Object.keys(tree.nodes)).toHaveLength(2);
    expect(tree.nodes[tree.rootIds[0]].type).toBe("container");
  });

  it("duplicating a custom-block section yields unique block ids", () => {
    const result = useEditorStore.getState().duplicateSection("s-custom");
    expect(result.ok).toBe(true);
    const sections = useEditorStore.getState().project.pages[0].sections.filter(
      (s) => s.type === CUSTOM_BLOCK_SECTION_TYPE,
    );
    expect(sections).toHaveLength(2);
    // Both trees are structurally identical but the section ids differ.
    expect(sections[0].id).not.toBe(sections[1].id);
    const a = customBlockTreeFromSection(sections[0]);
    const b = customBlockTreeFromSection(sections[1]);
    expect(a.rootIds[0]).toBe(sections[0].id);
    expect(b.rootIds[0]).toBe(sections[1].id);
  });

  it("committing an edited tree persists through the store", () => {
    const section = useEditorStore.getState().project.pages[0].sections[0];
    const tree = customBlockTreeFromSection(section);
    const headId = tree.nodes[tree.rootIds[0]].children[0];
    const edited = {
      ...tree,
      nodes: {
        ...tree.nodes,
        [headId]: {
          ...tree.nodes[headId],
          props: { ...tree.nodes[headId].props, text: "Edited heading" },
        },
      },
    };
    const commit = useEditorStore.getState().commitBlockTree("page-1", section.id, edited);
    expect(commit.ok).toBe(true);
    const after = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections[0],
    );
    const persistedHeadId = after.nodes[after.rootIds[0]].children[0];
    expect((after.nodes[persistedHeadId].props as { text: string }).text).toBe("Edited heading");
  });
});
