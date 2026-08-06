// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — canonical insertion tests
//
//   - loads + validates the stored record before insertion
//   - every inserted node gets a fresh, independent id
//   - exactly ONE history entry; one undo removes the whole copy
//   - failed insertion is a complete no-op
//   - usage metadata bumps AFTER commit (library metadata only)
//   - editing one inserted copy never affects another
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { registerDefaultBlocks, isDefaultBlocksRegistered } from "@/features/blocks/registry/block-registry";
import { customBlockTreeFromSection } from "@/features/blocks/adapters/section-block-adapter";
import { insertMyBlock } from "../services/insert-my-block";
import { InMemoryMyBlocksAdapter, makeProject, makeTree } from "./helpers";

let adapter: InMemoryMyBlocksAdapter;

beforeEach(() => {
  if (!isDefaultBlocksRegistered()) registerDefaultBlocks();
  useEditorStore.getState().hydrateProject(makeProject(), 1);
  useEditorStore.getState().setDirty(false);
  adapter = new InMemoryMyBlocksAdapter();
});

function sectionCount(): number {
  return useEditorStore.getState().project.pages[0].sections.length;
}

async function seedBlock(name = "Saved hero"): Promise<string> {
  const created = await adapter.createMyBlock({ name, category: "layout", tree: makeTree() });
  if (!created.ok) throw new Error("seed failed");
  return created.value.id;
}

describe("insertMyBlock — new section placement", () => {
  it("inserts the saved block with fresh independent ids", async () => {
    const blockId = await seedBlock();
    const storedTree = (await adapter.getMyBlock(blockId));
    const storedIds = storedTree.ok ? Object.keys(storedTree.value.tree.nodes) : [];

    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const section = useEditorStore.getState().project.pages[0].sections.find((s) => s.id === result.sectionId);
    expect(section).toBeDefined();
    expect(section?.type).toBe("custom-block");

    const tree = customBlockTreeFromSection(section!);
    // No stored library id is reused — every persisted id is fresh.
    for (const id of storedIds) {
      expect(Object.keys(tree.nodes)).not.toContain(id);
    }
    // Internal relationships preserved.
    const root = tree.nodes[tree.rootIds[0]];
    expect(root.children.length).toBe(2);
  });

  it("creates exactly one history entry", async () => {
    const blockId = await seedBlock();
    const before = useEditorStore.getState().history.past.length;
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().history.past.length).toBe(before + 1);
  });

  it("one undo removes the whole inserted copy", async () => {
    const blockId = await seedBlock();
    const beforeCount = sectionCount();
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    expect(sectionCount()).toBe(beforeCount + 1);

    useEditorStore.getState().undo();
    expect(sectionCount()).toBe(beforeCount);
    expect(useEditorStore.getState().project.pages[0].sections.some((s) => s.type === "custom-block")).toBe(false);
  });

  it("one redo restores the whole inserted copy", async () => {
    const blockId = await seedBlock();
    const beforeCount = sectionCount();
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const insertedSectionId = result.sectionId;

    useEditorStore.getState().undo();
    expect(sectionCount()).toBe(beforeCount);

    useEditorStore.getState().redo();
    expect(sectionCount()).toBe(beforeCount + 1);
    const restored = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === insertedSectionId,
    );
    expect(restored).toBeDefined();
    expect(restored?.type).toBe("custom-block");
  });

  it("two insertions never share node ids (collision avoidance)", async () => {
    const blockId = await seedBlock();
    const a = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    const b = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    const treeA = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === a.sectionId)!,
    );
    const treeB = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === b.sectionId)!,
    );
    const idsA = new Set(Object.keys(treeA.nodes));
    for (const idB of Object.keys(treeB.nodes)) {
      expect(idsA.has(idB)).toBe(false);
    }
    // Neither copy shares ids with the stored library tree.
    const stored = await adapter.getMyBlock(blockId);
    if (stored.ok) {
      const storedIds = new Set(Object.keys(stored.value.tree.nodes));
      for (const id of [...Object.keys(treeA.nodes), ...Object.keys(treeB.nodes)]) {
        expect(storedIds.has(id)).toBe(false);
      }
    }
  });

  it("bumps usage metadata only after a successful commit", async () => {
    const blockId = await seedBlock();
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    // Fire-and-forget metadata bump resolves on the microtask queue.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updated = await adapter.getMyBlock(blockId);
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.useCount).toBe(1);
      expect(updated.value.lastUsedAt).toBeDefined();
    }
  });

  it("skipUsageBump leaves the record metadata untouched", async () => {
    const blockId = await seedBlock();
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
      skipUsageBump: true,
    });
    expect(result.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updated = await adapter.getMyBlock(blockId);
    expect(updated.ok).toBe(true);
    if (updated.ok) expect(updated.value.useCount).toBe(0);
  });
});

describe("insertMyBlock — inside-custom-block placement", () => {
  it("merges a fresh-id subtree into an existing design", async () => {
    // First insert creates the host custom-block section.
    const blockId = await seedBlock();
    const host = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(host.ok).toBe(true);
    if (!host.ok) return;
    const hostSectionId = host.sectionId;

    const beforeNodes = Object.keys(
      customBlockTreeFromSection(
        useEditorStore.getState().project.pages[0].sections.find((s) => s.id === hostSectionId)!,
      ).nodes,
    ).length;

    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: {
        kind: "inside-custom-block",
        pageId: "page-1",
        sectionId: hostSectionId,
        parentBlockId: hostSectionId,
      },
      adapter,
    });
    expect(result.ok).toBe(true);

    const tree = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === hostSectionId)!,
    );
    expect(Object.keys(tree.nodes).length).toBe(beforeNodes + 3);

    // One undo removes the merged subtree, restoring the host.
    useEditorStore.getState().undo();
    const afterUndo = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === hostSectionId)!,
    );
    expect(Object.keys(afterUndo.nodes).length).toBe(beforeNodes);
  });
});

describe("insertMyBlock — failure is a no-op", () => {
  it("returns BLOCK_NOT_FOUND for a missing block and changes nothing", async () => {
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId: "missing",
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BLOCK_NOT_FOUND");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
    expect(useEditorStore.getState().history.past.length).toBe(0);
  });

  it("rejects a corrupt stored record before touching the project", async () => {
    // Inject a corrupt record directly.
    adapter.putRawForTests({ id: "corrupt-block", garbage: true });
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId: "corrupt-block",
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RECORD");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });

  it("rejects a missing page without touching the project", async () => {
    const blockId = await seedBlock();
    const before = JSON.stringify(useEditorStore.getState().project);
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "ghost-page" },
      adapter,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PAGE_NOT_FOUND");
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(before);
  });
});

describe("insertMyBlock — copy isolation", () => {
  it("editing one inserted copy never affects another", async () => {
    const blockId = await seedBlock();
    const a = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    const b = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // Mutate a child block of copy A through a commit (the root name is
    // synced to the section name, so a child's content is the real probe).
    const page = useEditorStore.getState().project.pages[0];
    const treeA = customBlockTreeFromSection(page.sections.find((s) => s.id === a.sectionId)!);
    const childA = treeA.nodes[treeA.rootIds[0]].children[0];
    treeA.nodes[childA].props.text = "Edited copy content";
    const committed = useEditorStore.getState().commitBlockTree(page.id, a.sectionId, treeA);
    expect(committed.ok).toBe(true);

    const treeB = customBlockTreeFromSection(
      useEditorStore.getState().project.pages[0].sections.find((s) => s.id === b.sectionId)!,
    );
    const childB = treeB.nodes[treeB.rootIds[0]].children[0];
    expect(treeB.nodes[childB].props.text).toBe("Simple pricing");

    // The library record is also untouched by copy edits.
    const stored = await adapter.getMyBlock(blockId);
    if (stored.ok) {
      const storedChild = stored.value.tree.nodes[stored.value.tree.rootIds[0]].children[0];
      expect(stored.value.tree.nodes[storedChild].props.text).toBe("Simple pricing");
    }
  });
});

describe("insertMyBlock — library record management leaves project copies intact", () => {
  it("renaming the library record never renames inserted copies", async () => {
    const blockId = await seedBlock("Saved hero");
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const sectionBefore = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === result.sectionId,
    );
    const treeBefore = customBlockTreeFromSection(sectionBefore!);
    const rootPropsBefore = JSON.stringify(treeBefore.nodes[treeBefore.rootIds[0]].props);

    const renamed = await adapter.updateMyBlock(blockId, { name: "Renamed hero" });
    expect(renamed.ok).toBe(true);

    // The project copy is untouched by the library rename.
    const sectionAfter = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === result.sectionId,
    );
    const treeAfter = customBlockTreeFromSection(sectionAfter!);
    expect(JSON.stringify(treeAfter.nodes[treeAfter.rootIds[0]].props)).toBe(rootPropsBefore);
    expect(sectionAfter?.props?.name).not.toBe("Renamed hero");
  });

  it("deleting the library record leaves the inserted copy intact", async () => {
    const blockId = await seedBlock("Saved hero");
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const deleted = await adapter.deleteMyBlock(blockId);
    expect(deleted.ok).toBe(true);
    const gone = await adapter.getMyBlock(blockId);
    expect(gone.ok).toBe(false);

    // The project copy still exists and still commits/edits normally.
    const section = useEditorStore.getState().project.pages[0].sections.find(
      (s) => s.id === result.sectionId,
    );
    expect(section).toBeDefined();
    const tree = customBlockTreeFromSection(section!);
    expect(tree.rootIds.length).toBe(1);
    expect(sectionCount()).toBe(2);
  });

  it("library management never dirties project history or dirty state", async () => {
    const blockId = await seedBlock("Saved hero");
    const result = await insertMyBlock({
      projectId: "proj-myblocks",
      blockId,
      placement: { kind: "end-of-page", pageId: "page-1" },
      adapter,
    });
    expect(result.ok).toBe(true);

    useEditorStore.getState().setDirty(false);
    const historyBefore = useEditorStore.getState().history.past.length;
    const projectBefore = JSON.stringify(useEditorStore.getState().project);

    await adapter.updateMyBlock(blockId, { name: "Renamed", tags: ["a", "b"] });
    await adapter.duplicateMyBlock(blockId);
    await adapter.deleteMyBlock(blockId);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useEditorStore.getState().history.past.length).toBe(historyBefore);
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(JSON.stringify(useEditorStore.getState().project)).toBe(projectBefore);
  });
});
