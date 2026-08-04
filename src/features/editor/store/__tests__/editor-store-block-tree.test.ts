// ---------------------------------------------------------------------------
// Editor store — commitBlockTree (Phase O)
//   - one history entry per committed block tree
//   - undo / redo
//   - no-op skips history
//   - invalid section / invalid tree rejected
//   - selection preserved
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { sectionToBlockTree } from "@/features/blocks/adapters/section-block-adapter";
import { allNodes } from "@/features/blocks/engine/tree-traversal";

function allBoundNodes(tree: ReturnType<typeof sectionToBlockTree>) {
  return allNodes(tree).filter((n) => Array.isArray(n.props._bindPath));
}

function makeProject(): Project {
  return {
    id: "proj-block",
    name: "Blocks",
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
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function heroTreeWithHeadline(headline: string) {
  const tree = sectionToBlockTree(
    useEditorStore.getState().project.pages[0].sections[0],
  );
  const node = allBoundNodes(tree).find((n) => (n.props._bindLabel as string) === "Main headline")!;
  return {
    ...tree,
    nodes: {
      ...tree.nodes,
      [node.id]: { ...node, props: { ...node.props, text: headline } },
    },
  };
}

function headlineValue(): string {
  return useEditorStore
    .getState()
    .project.pages[0].sections[0].props.headline as string;
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
});

describe("commitBlockTree — application", () => {
  it("applies one validated fold", () => {
    const result = useEditorStore
      .getState()
      .commitBlockTree("page-1", "s-hero", heroTreeWithHeadline("New headline"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(headlineValue()).toBe("New headline");
  });

  it("creates exactly one history entry", () => {
    const before = useEditorStore.getState().history.past.length;
    useEditorStore.getState().commitBlockTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });

  it("undo restores the old value, redo reapplies", () => {
    useEditorStore.getState().commitBlockTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    expect(headlineValue()).toBe("New");
    useEditorStore.getState().undo();
    expect(headlineValue()).toBe("Build anything");
    useEditorStore.getState().redo();
    expect(headlineValue()).toBe("New");
  });

  it("selection is preserved", () => {
    useEditorStore.getState().selectSection("s-hero");
    useEditorStore.getState().selectPage("page-1");
    useEditorStore.getState().commitBlockTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    const after = useEditorStore.getState();
    expect(after.selectedSectionId).toBe("s-hero");
    expect(after.selectedPageId).toBe("page-1");
  });

  it("preserves unrelated props, links and styles", () => {
    useEditorStore.getState().commitBlockTree("page-1", "s-hero", heroTreeWithHeadline("New"));
    const section = useEditorStore.getState().project.pages[0].sections[0];
    expect((section.props.primaryCta as { href: string }).href).toBe("/start");
    expect(section.props.subheadline).toBe("A subheadline.");
  });
});

describe("commitBlockTree — guards", () => {
  it("no-op (unchanged) skips history", () => {
    useEditorStore.getState().setDirty(false);
    const result = useEditorStore
      .getState()
      .commitBlockTree("page-1", "s-hero", heroTreeWithHeadline("Build anything"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(0);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("rejects a missing page", () => {
    const result = useEditorStore
      .getState()
      .commitBlockTree("nope", "s-hero", heroTreeWithHeadline("X"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("rejects a missing section", () => {
    const result = useEditorStore
      .getState()
      .commitBlockTree("page-1", "nope", heroTreeWithHeadline("X"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_NOT_FOUND");
  });

  it("rejects a tree rooted at a different section", () => {
    const other = sectionToBlockTree({
      id: "s-other",
      type: "hero",
      order: 2,
      visible: true,
      props: { headline: "X", subheadline: "", primaryCta: { text: "", href: "#" } },
      styles: {},
    });
    const result = useEditorStore.getState().commitBlockTree("page-1", "s-hero", other);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TREE");
  });

  it("does not create history on failure", () => {
    const before = useEditorStore.getState().history.past.length;
    useEditorStore
      .getState()
      .commitBlockTree("page-1", "s-hero", sectionToBlockTree({
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
