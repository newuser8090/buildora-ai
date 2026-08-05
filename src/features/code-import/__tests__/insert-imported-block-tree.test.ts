// ---------------------------------------------------------------------------
// Phase P3 — canonical insertion operation
//   - end-of-page / before / after / new-page / inside-custom-block
//   - fresh ids at insertion time, no reuse of preview ids
//   - exactly ONE history entry; undo removes the whole import; redo restores
//   - failed insertion changes nothing
//   - selection moves to the inserted section
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import {
  insertImportedBlockTree,
  buildCustomBlockSection,
  prepareSectionTree,
  prepareSubtreeTree,
  canPlaceInside,
  type ImportPlacement,
} from "@/features/code-import/services/insert-imported-block-tree";
import { createConversionIdFactory } from "@/features/code-import/conversion/conversion-errors";
import type { Project } from "@/types/project";

function makeProject(): Project {
  return {
    id: "proj-import",
    name: "Import test",
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
            id: "s-faq",
            type: "faq",
            order: 2,
            visible: true,
            props: { title: "Common questions", items: [{ question: "Q", answer: "A" }] },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeNode(id: string, overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id,
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

/** A realistic converted tree: root + heading + paragraph (preview ids). */
function makeImportedTree(): BlockTree {
  return {
    rootIds: ["preview-root"],
    nodes: {
      "preview-root": makeNode("preview-root", {
        props: { name: "Pricing" },
        children: ["preview-head", "preview-text"],
      }),
      "preview-head": makeNode("preview-head", {
        parentId: "preview-root",
        type: "heading",
        props: { text: "Simple pricing" },
      }),
      "preview-text": makeNode("preview-text", {
        parentId: "preview-root",
        type: "paragraph",
        props: { text: "Pick a plan" },
      }),
    },
  };
}

const BASE_PLACEMENT: ImportPlacement = { kind: "end-of-page", pageId: "page-1" };

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
});

function sectionCount(): number {
  return useEditorStore.getState().project.pages[0].sections.length;
}

describe("insertImportedBlockTree — new section placements", () => {
  it("inserts an end-of-page custom-block section with fresh ids", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Pricing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const page = useEditorStore.getState().project.pages[0];
    const section = page.sections.find((s) => s.id === result.sectionId);
    expect(section).toBeDefined();
    expect(section?.type).toBe("custom-block");

    const tree = customBlockTreeFromSection(section!);
    // Root is pinned to the section id — the tree is editable directly.
    expect(tree.rootIds[0]).toBe(result.sectionId);
    // No converter preview ids are REUSED — every persisted id is fresh and
    // disjoint from the converted tree's original ids.
    const originalIds = Object.keys(makeImportedTree().nodes);
    for (const id of originalIds) {
      expect(Object.keys(tree.nodes)).not.toContain(id);
    }
    // Internal relationships preserved.
    const root = tree.nodes[result.sectionId];
    expect(root.parentId).toBeNull();
    expect(root.children.length).toBe(2);
    expect(tree.nodes[root.children[0]].parentId).toBe(result.sectionId);
  });

  it("creates exactly one history entry", () => {
    const before = useEditorStore.getState().history.past.length;
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Pricing",
    });
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });

  it("one undo removes the whole import; one redo restores it", () => {
    const beforeCount = sectionCount();
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Pricing",
    });
    expect(result.ok).toBe(true);
    expect(sectionCount()).toBe(beforeCount + 1);

    useEditorStore.getState().undo();
    expect(sectionCount()).toBe(beforeCount);
    const afterUndo = useEditorStore.getState().project.pages[0].sections;
    expect(afterUndo.some((s) => s.type === "custom-block")).toBe(false);

    useEditorStore.getState().redo();
    expect(sectionCount()).toBe(beforeCount + 1);
    const afterRedo = useEditorStore.getState().project.pages[0].sections;
    expect(afterRedo.some((s) => s.type === "custom-block")).toBe(true);
  });

  it("selects the inserted section", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Pricing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(useEditorStore.getState().selectedSectionId).toBe(result.sectionId);
  });

  it("inserts before and after a target section", () => {
    const beforeResult = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "before-section", pageId: "page-1", sectionId: "s-faq" },
      tree: makeImportedTree(),
      name: "Before FAQ",
    });
    expect(beforeResult.ok).toBe(true);
    let ids = useEditorStore.getState().project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf(beforeResult.ok ? beforeResult.sectionId : "")).toBeLessThan(ids.indexOf("s-faq"));

    const afterResult = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "after-section", pageId: "page-1", sectionId: "s-faq" },
      tree: makeImportedTree(),
      name: "After FAQ",
    });
    expect(afterResult.ok).toBe(true);
    ids = useEditorStore.getState().project.pages[0].sections.map((s) => s.id);
    expect(ids.indexOf(afterResult.ok ? afterResult.sectionId : "")).toBeGreaterThan(ids.indexOf("s-faq"));
  });
});

describe("insertImportedBlockTree — new-page placement", () => {
  it("adds a page containing the imported section as ONE history entry", () => {
    const beforePages = useEditorStore.getState().project.pages.length;
    const beforeHistory = useEditorStore.getState().history.past.length;
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "new-page", pageId: "page-1" },
      tree: makeImportedTree(),
      name: "Pricing",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pages = useEditorStore.getState().project.pages;
    expect(pages.length).toBe(beforePages + 1);
    const newPage = pages.find((p) => p.id === result.pageId);
    expect(newPage).toBeDefined();
    expect(newPage?.sections.some((s) => s.id === result.sectionId)).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(beforeHistory + 1);

    // One undo removes the page and its section together.
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().project.pages.length).toBe(beforePages);
    expect(useEditorStore.getState().project.pages.some((p) => p.sections.some((s) => s.type === "custom-block"))).toBe(false);
  });
});

describe("insertImportedBlockTree — inside-custom-block placement", () => {
  function insertBaseSection(): string {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Base",
    });
    if (!result.ok) throw new Error("setup failed");
    return result.sectionId;
  }

  it("inserts a subtree inside an existing custom-block section", () => {
    const sectionId = insertBaseSection();
    const beforeHistory = useEditorStore.getState().history.past.length;

    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "inside-custom-block", pageId: "page-1", sectionId, parentBlockId: sectionId },
      tree: makeImportedTree(),
      name: "Inner",
    });
    expect(result.ok).toBe(true);

    const section = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === sectionId)!;
    const tree = customBlockTreeFromSection(section);
    expect(Object.keys(tree.nodes).length).toBe(6); // 3 base + 3 inserted
    // Inserted nodes have fresh ids — none of the converter preview ids reused.
    const originalIds = Object.keys(makeImportedTree().nodes);
    for (const id of originalIds) {
      expect(Object.keys(tree.nodes)).not.toContain(id);
    }
    // One history entry.
    expect(useEditorStore.getState().history.past.length).toBe(beforeHistory + 1);

    // One undo removes the subtree entirely.
    useEditorStore.getState().undo();
    const afterUndo = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === sectionId)!,
    );
    expect(Object.keys(afterUndo.nodes).length).toBe(3);
  });

  it("rejects inserting inside a non-custom-block section", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "inside-custom-block", pageId: "page-1", sectionId: "s-hero", parentBlockId: "s-hero" },
      tree: makeImportedTree(),
      name: "Inner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_TARGET");
  });

  it("rejects a missing parent block", () => {
    const sectionId = insertBaseSection();
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "inside-custom-block", pageId: "page-1", sectionId, parentBlockId: "nope" },
      tree: makeImportedTree(),
      name: "Inner",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("TARGET_NOT_FOUND");
  });
});

describe("insertImportedBlockTree — failure is a no-op", () => {
  it("rejects a project mismatch and changes nothing", () => {
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = insertImportedBlockTree({
      projectId: "other-project",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "X",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROJECT_MISMATCH");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("rejects a missing page", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "end-of-page", pageId: "nope" },
      tree: makeImportedTree(),
      name: "X",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
  });

  it("rejects an unknown placement kind", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: { kind: "warp" as never, pageId: "page-1" },
      tree: makeImportedTree(),
      name: "X",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_PLACEMENT");
  });

  it("rejects an invalid tree without touching the project", () => {
    const before = JSON.stringify(useEditorStore.getState().project);
    const invalid = { rootIds: ["root"], nodes: { root: makeNode("root", { type: "nope" as never }) } };
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: invalid,
      name: "X",
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });
});

describe("pure builders", () => {
  it("buildCustomBlockSection validates and returns a section", () => {
    const tree = makeImportedTree();
    const result = buildCustomBlockSection({
      tree,
      name: "Pricing",
      sectionId: "sec-1",
      sourceMetadata: {
        language: "html",
        importedAt: "2026-01-01T00:00:00.000Z",
        sourceHash: "abcd1234",
        converterVersion: 1,
        warningCount: 0,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("custom-block");
      expect(result.value.id).toBe("sec-1");
      expect((result.value.props as { name: string }).name).toBe("Pricing");
    }
  });

  it("buildCustomBlockSection rejects an invalid tree", () => {
    const result = buildCustomBlockSection({
      tree: { rootIds: ["r"], nodes: { r: makeNode("r", { type: "nope" as never }) } },
      name: "X",
      sectionId: "sec-1",
    });
    expect(result.ok).toBe(false);
  });

  it("prepareSectionTree pins the root to the section id", () => {
    const result = prepareSectionTree({
      tree: makeImportedTree(),
      sectionId: "sec-pinned",
      existingIds: [],
      idFactory: createConversionIdFactory("test"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rootIds).toEqual(["sec-pinned"]);
      expect(result.value.nodes["sec-pinned"]).toBeDefined();
    }
  });

  it("prepareSubtreeTree remaps every node with fresh ids", () => {
    const result = prepareSubtreeTree({
      tree: makeImportedTree(),
      existingIds: [],
      idFactory: createConversionIdFactory("test"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const originalIds = Object.keys(makeImportedTree().nodes);
      for (const id of originalIds) {
        expect(Object.keys(result.value.nodes)).not.toContain(id);
      }
      expect(result.value.rootIds.length).toBe(1);
    }
  });
});

describe("canPlaceInside", () => {
  it("allows inserting into a custom-block section root", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Base",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = useEditorStore.getState().project;
    const compat = canPlaceInside(project, "page-1", result.sectionId, result.sectionId, makeImportedTree());
    expect(compat.ok).toBe(true);
  });

  it("rejects inserting into built-in sections with an explanation", () => {
    const project = useEditorStore.getState().project;
    const compat = canPlaceInside(project, "page-1", "s-hero", "s-hero", makeImportedTree());
    expect(compat.ok).toBe(false);
    expect(compat.reason).toContain("built-in layout");
  });

  it("rejects a missing parent block", () => {
    const result = insertImportedBlockTree({
      projectId: "proj-import",
      placement: BASE_PLACEMENT,
      tree: makeImportedTree(),
      name: "Base",
    });
    if (!result.ok) return;
    const project = useEditorStore.getState().project;
    const compat = canPlaceInside(project, "page-1", result.sectionId, "ghost", makeImportedTree());
    expect(compat.ok).toBe(false);
  });
});
