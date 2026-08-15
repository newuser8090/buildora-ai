// ---------------------------------------------------------------------------
// Element Library insertion (Phase P22-D) — unit tests
//   - buildLibraryTree: fresh defaults, no shared references
//   - new-section placement: custom-block section with the element as root,
//     one history entry, selection
//   - inside-custom-block placement: block appended under the section root,
//     one history entry, block selection
//   - failure is a no-op
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useBlockEditorStore } from "@/features/blocks/store/block-editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import type { Project } from "@/types/project";
import {
  buildLibraryTree,
  insertLibraryElement,
} from "../services/insert-library-element";

function makeProject(): Project {
  return {
    id: "proj-library",
    name: "Library test",
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
            props: { headline: "Build anything", subheadline: "Sub", primaryCta: { text: "Go", href: "/start" } },
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
                    children: ["h1"],
                    props: {},
                    style: { padding: "2rem" },
                    responsive: {},
                    visible: true,
                    locked: false,
                    hidden: false,
                  },
                  h1: {
                    id: "h1",
                    type: "heading",
                    parentId: "s-custom",
                    children: [],
                    props: { text: "Hello", level: 2 },
                    style: { fontSize: 24 },
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

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
  useBlockEditorStore.getState().reset();
});

function sectionCount(): number {
  return useEditorStore.getState().project.pages[0].sections.length;
}

describe("buildLibraryTree", () => {
  it("creates a single-root tree with the element's fresh defaults", () => {
    const result = buildLibraryTree("heading", "root-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { tree, root } = result.value;
    expect(tree.rootIds).toEqual(["root-1"]);
    expect(tree.nodes["root-1"]).toBe(root);
    expect(root.type).toBe("heading");
    expect(root.parentId).toBeNull();
    expect(root.props.text).toBe("Your heading");
    expect(root.visible).toBe(true);
  });

  it("never shares references across calls", () => {
    const a = buildLibraryTree("button", "b-1");
    const b = buildLibraryTree("button", "b-2");
    if (!a.ok || !b.ok) throw new Error("build failed");
    expect(a.value.root.props).not.toBe(b.value.root.props);
    expect(a.value.root.style).not.toBe(b.value.root.style);
    // Mutating one never leaks into the other.
    a.value.root.props.text = "Mutated";
    expect(b.value.root.props.text).toBe("Get Started");
  });

  it("rejects an unknown type", () => {
    const result = buildLibraryTree("nope" as never, "r");
    expect(result.ok).toBe(false);
  });
});

describe("insertLibraryElement — new-section placement", () => {
  it("appends a new custom-block section with the element as its root", () => {
    const before = sectionCount();
    const result = insertLibraryElement({ type: "heading", pageId: "page-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("new-section");
    expect(sectionCount()).toBe(before + 1);

    const section = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === result.sectionId);
    expect(section?.type).toBe("custom-block");
    const tree = customBlockTreeFromSection(section!);
    const root = tree.nodes[result.sectionId];
    expect(root.type).toBe("heading");
    expect(root.props.text).toBe("Your heading");
    expect(result.blockId).toBe(result.sectionId);
  });

  it("creates exactly one history entry and selects the section", () => {
    const historyBefore = useEditorStore.getState().history.past.length;
    const result = insertLibraryElement({ type: "button", pageId: "page-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(useEditorStore.getState().history.past.length).toBe(historyBefore + 1);
    expect(useEditorStore.getState().selectedSectionId).toBe(result.sectionId);
  });

  it("one undo removes the inserted section", () => {
    const before = sectionCount();
    const result = insertLibraryElement({ type: "image", pageId: "page-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sectionCount()).toBe(before + 1);
    useEditorStore.getState().undo();
    expect(sectionCount()).toBe(before);
  });

  it("inserts after a targeted non-custom-block section", () => {
    const result = insertLibraryElement({ type: "container", pageId: "page-1", targetSectionId: "s-hero" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = useEditorStore.getState().project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf(result.sectionId)).toBeGreaterThan(ids.indexOf("s-hero"));
  });

  it("uses the selected section when no target is passed", () => {
    act(() => useEditorStore.getState().selectSection("s-hero"));
    const result = insertLibraryElement({ type: "divider", pageId: "page-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = useEditorStore.getState().project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf(result.sectionId)).toBeGreaterThan(ids.indexOf("s-hero"));
  });
});

describe("insertLibraryElement — inside-custom-block placement", () => {
  it("appends the element under the custom-block section root", () => {
    const historyBefore = useEditorStore.getState().history.past.length;
    const result = insertLibraryElement({ type: "paragraph", pageId: "page-1", targetSectionId: "s-custom" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("inside-selected");
    expect(result.sectionId).toBe("s-custom");

    const section = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-custom")!;
    const tree = customBlockTreeFromSection(section);
    const root = tree.nodes["s-custom"];
    expect(root.children).toContain(result.blockId);
    const added = tree.nodes[result.blockId];
    expect(added.type).toBe("paragraph");
    expect(added.parentId).toBe("s-custom");

    // One history entry.
    expect(useEditorStore.getState().history.past.length).toBe(historyBefore + 1);
  });

  it("selects the section and highlights the new block", () => {
    const result = insertLibraryElement({ type: "badge", pageId: "page-1", targetSectionId: "s-custom" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(useEditorStore.getState().selectedSectionId).toBe("s-custom");
    expect(useBlockEditorStore.getState().selectedBlockId).toBe(result.blockId);
  });

  it("one undo removes the inserted block only", () => {
    const result = insertLibraryElement({ type: "spacer", pageId: "page-1", targetSectionId: "s-custom" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    let tree = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-custom")!,
    );
    expect(Object.keys(tree.nodes).length).toBe(3);
    useEditorStore.getState().undo();
    tree = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === "s-custom")!,
    );
    expect(Object.keys(tree.nodes).length).toBe(2);
    expect(tree.nodes[result.blockId]).toBeUndefined();
  });
});

describe("insertLibraryElement — failure is a no-op", () => {
  it("rejects an unknown element type without touching the project", () => {
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = insertLibraryElement({ type: "nope" as never, pageId: "page-1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_ELEMENT");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });

  it("rejects a missing page", () => {
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = insertLibraryElement({ type: "heading", pageId: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Minimal act helper (no React needed — zustand setState is synchronous)
// ---------------------------------------------------------------------------

function act(fn: () => void): void {
  fn();
}
