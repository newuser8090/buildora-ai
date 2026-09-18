// ---------------------------------------------------------------------------
// Editor store — commitSectionTree (Phase P24-B)
//   - legacy section → first real edit materializes + persists the durable tree
//   - the durable tree becomes authoritative for subsequent element edits
//   - exactly one withHistory entry per commit; undo/redo restore tree + props
//   - no-op commits (unchanged durable tree / unchanged materialization) skip
//     history and never eagerly materialize legacy sections
//   - independent commits create independent history entries
//   - the durable tree survives the persistence round-trip (normalizer + schema)
//   - custom-block sections keep their existing props.tree fold (no section.tree)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";
import { sectionToElementTree } from "@/features/elements/adapters/section-element-adapter";
import { updateElementGeometry } from "@/features/elements/engine/element-operations";
import { normalizeProject } from "@/features/persistence/services/project-normalizer";
import { ProjectSchema } from "@/features/generation/schemas/generation-plan-schema";
import type { ElementTree } from "@/features/elements/types";

function makeProject(): Project {
  return {
    id: "proj-sec-tree",
    name: "Section trees",
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
            id: "s-hero",
            type: "hero",
            order: 1,
            visible: true,
            props: {
              headline: "Build anything",
              subheadline: "A subheadline.",
              primaryCta: { text: "Get started", href: "/start" },
            },
            styles: {},
          },
          {
            id: "s-custom",
            type: "custom-block",
            order: 2,
            visible: true,
            props: {
              name: "Design",
              tree: {
                rootIds: ["s-custom"],
                nodes: {
                  "s-custom": {
                    id: "s-custom",
                    type: "container",
                    parentId: null,
                    children: ["b1"],
                    props: {},
                    style: {},
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  b1: {
                    id: "b1",
                    type: "heading",
                    parentId: "s-custom",
                    children: [],
                    props: { text: "Hello" },
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
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function heroSection() {
  return useEditorStore.getState().project.pages[0].sections[0];
}

function heroTreeWithHeadline(headline: string): ElementTree {
  const tree = sectionToElementTree(heroSection());
  const root = tree.nodes[tree.rootIds[0]];
  const childId = root.children[0];
  const child = tree.nodes[childId];
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [childId]: { ...child, props: { ...child.props, text: headline } },
    },
  };
}

function storedHeroTree() {
  return (heroSection() as { tree?: ElementTree }).tree;
}

function storedHeadline(): string {
  return heroSection().props.headline as string;
}

function customTreeWithGeometry() {
  const section = useEditorStore.getState().project.pages[0].sections[1];
  const tree = sectionToElementTree(section);
  const result = updateElementGeometry(tree, "s-custom", { x: 40, y: 60, width: 320 });
  return result.ok ? result.value : tree;
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
});

describe("commitSectionTree — materialization + durability", () => {
  it("materializes a legacy section into a durable tree on the first real edit", () => {
    const result = useEditorStore
      .getState()
      .commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("New headline"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    // The tree is durable now.
    expect(storedHeroTree()).toBeDefined();
    // Folded props stay in sync for legacy renderers.
    expect(storedHeadline()).toBe("New headline");
  });

  it("creates exactly one history entry", () => {
    const before = useEditorStore.getState().history.past.length;
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });

  it("undo restores the legacy section (no tree); redo re-applies the durable tree", () => {
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    expect(storedHeadline()).toBe("New");
    useEditorStore.getState().undo();
    expect(storedHeadline()).toBe("Build anything");
    expect(storedHeroTree()).toBeUndefined();
    useEditorStore.getState().redo();
    expect(storedHeadline()).toBe("New");
    expect(storedHeroTree()).toBeDefined();
  });

  it("subsequent edits operate against the durable tree (geometry survives)", () => {
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    // Now drag the root element — the durable tree is materialized, not the props.
    const tree = sectionToElementTree(heroSection());
    const result = updateElementGeometry(tree, "s-hero", { x: 12, y: 34 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const committed = useEditorStore.getState().commitSectionTree("page-1", "s-hero", result.value);
    expect(committed.ok).toBe(true);
    if (committed.ok) expect(committed.changed).toBe(true);
    expect(storedHeroTree()?.nodes["s-hero"].geometry).toMatchObject({ x: 12, y: 34 });
    // Content from the first durable commit is still present.
    expect(storedHeadline()).toBe("New");
  });
});

describe("commitSectionTree — no-op semantics", () => {
  it("re-committing an identical durable tree skips history", () => {
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("committing the exact materialization of a legacy section is a no-op (stays legacy)", () => {
    const materialized = sectionToElementTree(heroSection());
    const result = useEditorStore.getState().commitSectionTree("page-1", "s-hero", materialized);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(0);
    // No eager materialization.
    expect(storedHeroTree()).toBeUndefined();
  });

  it("independent commits create independent history entries", () => {
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("First"));
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("Second"));
    const state = useEditorStore.getState();
    expect(state.history.past.length).toBe(2);
    useEditorStore.getState().undo();
    expect(storedHeadline()).toBe("First");
    useEditorStore.getState().undo();
    expect(storedHeadline()).toBe("Build anything");
    expect(storedHeroTree()).toBeUndefined();
  });
});

describe("commitSectionTree — persistence round trip", () => {
  it("the durable tree survives normalizeProject + ProjectSchema validation", () => {
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", heroTreeWithHeadline("Persisted"));
    const project = useEditorStore.getState().project;
    const normalized = normalizeProject(project);
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    const validation = ProjectSchema.safeParse(normalized.project);
    expect(validation.success).toBe(true);
    if (!validation.success) return;
    const section = validation.data.pages[0].sections[0] as { tree?: ElementTree } & { props: Record<string, unknown> };
    expect(section.tree).toBeDefined();
    expect(section.props.headline).toBe("Persisted");
  });
});

describe("commitSectionTree — custom-block compatibility", () => {
  it("custom-block sections keep the props.tree fold and never gain section.tree", () => {
    const result = useEditorStore
      .getState()
      .commitSectionTree("page-1", "s-custom", customTreeWithGeometry());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    const section = useEditorStore.getState().project.pages[0].sections[1];
    expect((section as { tree?: unknown }).tree).toBeUndefined();
    const stored = (section.props as { tree?: { nodes?: Record<string, { geometry?: unknown }> } }).tree;
    expect(stored?.nodes?.["s-custom"]?.geometry).toMatchObject({ x: 40, y: 60, width: 320 });
  });
});

describe("commitSectionTree — guards", () => {
  it("rejects a missing page / missing section", () => {
    const tree = sectionToElementTree(heroSection());
    const noPage = useEditorStore.getState().commitSectionTree("nope", "s-hero", tree);
    expect(noPage.ok).toBe(false);
    if (!noPage.ok) expect(noPage.error.code).toBe("PAGE_NOT_FOUND");
    const noSection = useEditorStore.getState().commitSectionTree("page-1", "nope", tree);
    expect(noSection.ok).toBe(false);
    if (!noSection.ok) expect(noSection.error.code).toBe("SECTION_NOT_FOUND");
  });

  it("rejects a tree rooted at a different section", () => {
    const other = sectionToElementTree({
      id: "s-other",
      type: "hero",
      order: 2,
      visible: true,
      props: { headline: "X", subheadline: "", primaryCta: { text: "", href: "#" } },
      styles: {},
    });
    const result = useEditorStore.getState().commitSectionTree("page-1", "s-hero", other);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TREE");
  });

  it("does not create history on failure", () => {
    const before = useEditorStore.getState().history.past.length;
    useEditorStore.getState().commitSectionTree("page-1", "s-hero", sectionToElementTree({
      id: "s-other",
      type: "hero",
      order: 2,
      visible: true,
      props: { headline: "X", subheadline: "", primaryCta: { text: "", href: "#" } },
      styles: {},
    }));
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });
});
