import { describe, expect, it } from "vitest";
import type { BlockTree } from "@/features/blocks/types";
import { prepareTreeForStorage } from "../services/my-blocks-service";

function makeTree(): BlockTree {
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
      } as BlockTree["nodes"][string],
    },
  };
}

describe("P23-E My Blocks boundary", () => {
  it("strips customCode before a reusable block is validated/stored", () => {
    const tree = makeTree();
    const result = prepareTreeForStorage(tree);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes["heading-1"].customCode).toBeUndefined();
    expect(tree.nodes["heading-1"].customCode).toBeDefined();
  });
});
