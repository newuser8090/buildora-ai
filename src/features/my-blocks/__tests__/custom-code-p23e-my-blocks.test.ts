import { describe, expect, it } from "vitest";
import type { StoredCustomBlockNode } from "@/features/code-import/schemas/custom-block-schema";
import { prepareTreeForStorage } from "../services/my-blocks-service";

/**
 * A custom-block tree whose nodes may carry schema-level customCode (P23-C).
 * CustomCodeTree is structurally assignable to BlockTree because
 * StoredCustomBlockNode extends BlockNode, so the fixture feeds the storage
 * preparation directly while exposing customCode for assertions.
 */
type CustomCodeTree = {
  rootIds: string[];
  nodes: Record<string, StoredCustomBlockNode>;
};

function makeTree(): CustomCodeTree {
  return {
    rootIds: ["heading-1"],
    nodes: {
      "heading-1": {
        id: "heading-1",
        type: "heading",
        parentId: null,
        children: [],
        props: { text: "Hello" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        customCode: { enabled: true, html: "<script>bad()</script>", css: ".x{}", js: "bad()" },
      },
    },
  };
}

describe("P23-E My Blocks boundary", () => {
  it("strips customCode before a reusable block is validated/stored", () => {
    const tree = makeTree();
    const result = prepareTreeForStorage(tree);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The stored result is a plain BlockTree (customCode stripped) — the
    // optional runtime key is read through a narrow cast.
    expect((result.value.nodes["heading-1"] as { customCode?: unknown }).customCode).toBeUndefined();
    expect(tree.nodes["heading-1"].customCode).toBeDefined();
  });
});
