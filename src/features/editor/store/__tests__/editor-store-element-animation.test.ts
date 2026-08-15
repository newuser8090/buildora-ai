// ---------------------------------------------------------------------------
// Editor store — updateElementAnimation / updateElementInteraction (P22-G)
//   - updates route through the element operation engine + withHistory
//   - exactly ONE history entry per mutation
//   - undo / redo restore the previous state
//   - null clears the property
//   - invalid data is rejected (never stored)
//   - no-op (identical value) skips history
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { Project } from "@/types/project";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "@/features/elements/registry/register-default-elements";

function makeProject(): Project {
  return {
    id: "proj-p22g-store",
    name: "P22G Store",
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
            type: "custom-block",
            order: 1,
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

function storedNode(id: string) {
  const section = useEditorStore.getState().project.pages[0].sections[0];
  const tree = (section.props as { tree?: { nodes?: Record<string, Record<string, unknown>> } }).tree;
  return tree?.nodes?.[id];
}

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  registerDefaultElements();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
});

describe("updateElementAnimation", () => {
  it("applies a validated animation to a custom-block element (one history entry)", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementAnimation("page-1", "s-custom", "b1", { trigger: "load", type: "fade", durationMs: 400 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    expect(storedNode("b1")?.animation).toEqual({ trigger: "load", type: "fade", durationMs: 400 });
  });

  it("persists the animation through the durable tree (round trip)", () => {
    useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "b1", { trigger: "scroll", type: "slide" });
    const section = useEditorStore.getState().project.pages[0].sections[0];
    const tree = (section.props as { tree?: { nodes?: Record<string, { animation?: unknown }> } }).tree;
    expect(tree?.nodes?.b1?.animation).toMatchObject({ trigger: "scroll", type: "slide" });
  });

  it("clears the property when null is supplied (one history entry)", () => {
    useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "b1", { trigger: "load", type: "fade" });
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementAnimation("page-1", "s-custom", "b1", null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    expect(storedNode("b1")?.animation).toBeUndefined();
  });

  it("undo restores the previous animation, redo reapplies", () => {
    useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "b1", { trigger: "load", type: "fade" });
    useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "b1", { trigger: "scroll", type: "slide" });
    expect(storedNode("b1")?.animation).toMatchObject({ type: "slide" });
    useEditorStore.getState().undo();
    expect(storedNode("b1")?.animation).toMatchObject({ type: "fade" });
    useEditorStore.getState().undo();
    expect(storedNode("b1")?.animation).toBeUndefined();
    useEditorStore.getState().redo();
    expect(storedNode("b1")?.animation).toMatchObject({ type: "fade" });
  });

  it("rejects invalid animation data", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementAnimation("page-1", "s-custom", "b1", { trigger: "bogus", type: "fade" } as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TREE");
    expect(useEditorStore.getState().history.past.length).toBe(before);
    expect(storedNode("b1")?.animation).toBeUndefined();
  });

  it("identical values are a no-op (no history entry)", () => {
    useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "b1", { trigger: "load", type: "fade" });
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementAnimation("page-1", "s-custom", "b1", { trigger: "load", type: "fade" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("rejects unknown elements / sections / pages", () => {
    const badElement = useEditorStore.getState().updateElementAnimation("page-1", "s-custom", "ghost", { trigger: "load", type: "fade" });
    expect(badElement.ok).toBe(false);
    const badSection = useEditorStore.getState().updateElementAnimation("page-1", "nope", "b1", { trigger: "load", type: "fade" });
    expect(badSection.ok).toBe(false);
    const badPage = useEditorStore.getState().updateElementAnimation("nope", "s-custom", "b1", { trigger: "load", type: "fade" });
    expect(badPage.ok).toBe(false);
  });
});

describe("updateElementInteraction", () => {
  it("applies a validated interaction (one history entry)", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementInteraction("page-1", "s-custom", "b1", {
        click: { kind: "navigate", target: { kind: "page", pageId: "page-1" } },
        hover: { scale: 1.05 },
      });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    expect(storedNode("b1")?.interaction).toMatchObject({
      click: { kind: "navigate" },
      hover: { scale: 1.05 },
    });
  });

  it("clears the interaction when null is supplied", () => {
    useEditorStore.getState().updateElementInteraction("page-1", "s-custom", "b1", { hover: { scale: 1.1 } });
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementInteraction("page-1", "s-custom", "b1", null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
    expect(storedNode("b1")?.interaction).toBeUndefined();
  });

  it("undo/redo covers interaction updates", () => {
    useEditorStore.getState().updateElementInteraction("page-1", "s-custom", "b1", { hover: { scale: 1.05 } });
    expect(storedNode("b1")?.interaction).toMatchObject({ hover: { scale: 1.05 } });
    useEditorStore.getState().undo();
    expect(storedNode("b1")?.interaction).toBeUndefined();
    useEditorStore.getState().redo();
    expect(storedNode("b1")?.interaction).toMatchObject({ hover: { scale: 1.05 } });
  });

  it("rejects invalid interaction data (unsafe external URL)", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementInteraction("page-1", "s-custom", "b1", {
        click: { kind: "navigate", target: { kind: "external", url: "javascript:evil()" } },
      });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TREE");
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });

  it("identical interactions are a no-op", () => {
    useEditorStore.getState().updateElementInteraction("page-1", "s-custom", "b1", { hover: { scale: 1.05 } });
    const before = useEditorStore.getState().history.past.length;
    const result = useEditorStore
      .getState()
      .updateElementInteraction("page-1", "s-custom", "b1", { hover: { scale: 1.05 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
    expect(useEditorStore.getState().history.past.length).toBe(before);
  });
});
