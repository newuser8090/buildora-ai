// ---------------------------------------------------------------------------
// Phase P3 — custom-block section schema
//   - valid trees pass / invalid trees fail
//   - size caps (nodes / depth / children / text / style keys)
//   - dangerous keys + unsafe CSS values rejected
//   - unknown block types rejected
//   - orphan/cycle/missing-child detection
//   - deterministic repair / normalization
//   - metadata stores no source code
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BlockNode, BlockTree } from "@/features/blocks/types";
import {
  CustomBlockTreeSchema,
  CustomBlockSectionPropsSchema,
  CustomBlockSourceMetadataSchema,
  validateCustomBlockTree,
  findDangerousKeys,
  isSafeCustomBlockPayload,
  normalizeCustomBlockTree,
  normalizeCustomBlockSectionProps,
  buildSourceMetadata,
  MAX_CUSTOM_BLOCK_NODES,
  MAX_CUSTOM_BLOCK_DEPTH,
  MAX_CUSTOM_BLOCK_TEXT_LENGTH,
  CONVERTER_VERSION,
} from "@/features/code-import/schemas/custom-block-schema";

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

function makeTree(rootIds: string[], nodes: Record<string, BlockNode>): BlockTree {
  return { rootIds, nodes };
}

describe("findDangerousKeys / isSafeCustomBlockPayload", () => {
  it("rejects prototype-pollution keys at any depth", () => {
    // NOTE: an object literal `{ __proto__: … }` sets the prototype instead of
    // creating an own key, so the payload is built via JSON.parse here.
    const payload = JSON.parse('{"node": {"__proto__": {"polluted": true}}}');
    const problems = findDangerousKeys(payload);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toContain("__proto__");
    expect(isSafeCustomBlockPayload(JSON.parse('{"node": {"__proto__": 1}}'))).toBe(false);
  });

  it("rejects constructor and prototype keys", () => {
    expect(isSafeCustomBlockPayload({ constructor: {} })).toBe(false);
    expect(isSafeCustomBlockPayload({ prototype: "x" })).toBe(false);
  });

  it("rejects unsafe CSS values (javascript:, expression(), vbscript:) in strings", () => {
    expect(isSafeCustomBlockPayload({ background: "url(javascript:alert(1))" })).toBe(false);
    expect(isSafeCustomBlockPayload({ width: "expression(alert(1))" })).toBe(false);
    expect(isSafeCustomBlockPayload({ cursor: "vbscript:x" })).toBe(false);
  });

  it("accepts ordinary values", () => {
    expect(
      isSafeCustomBlockPayload({
        text: "Hello world",
        href: "https://example.com",
        style: { color: "#fff", padding: "1rem" },
      }),
    ).toBe(true);
  });
});

describe("CustomBlockTreeSchema — structural validation", () => {
  it("accepts a valid tree", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root", { children: ["h"] }),
      h: makeNode("h", { type: "heading", parentId: "root", props: { text: "Hi" } }),
    });
    expect(CustomBlockTreeSchema.safeParse(tree).success).toBe(true);
    expect(validateCustomBlockTree(tree).valid).toBe(true);
  });

  it("rejects an unknown block type", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root", { type: "mystery" as never }),
    });
    const result = validateCustomBlockTree(tree);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("unknown type"))).toBe(true);
    expect(CustomBlockTreeSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects a root with a parent", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root", { parentId: "elsewhere" }),
    });
    const result = validateCustomBlockTree(tree);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("must not have a parent"))).toBe(true);
  });

  it("rejects a missing root", () => {
    const tree = makeTree(["ghost"], { root: makeNode("root") });
    expect(validateCustomBlockTree(tree).valid).toBe(false);
  });

  it("rejects a missing child and a broken back-reference", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root", { children: ["missing"] }),
    });
    const result = validateCustomBlockTree(tree);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("missing child"))).toBe(true);
  });

  it("rejects a cycle", () => {
    const tree = makeTree(["a"], {
      a: makeNode("a", { children: ["b"] }),
      b: makeNode("b", { parentId: "a", children: ["a"] }),
    });
    const result = validateCustomBlockTree(tree);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("Cycle detected"))).toBe(true);
  });

  it("rejects orphaned nodes", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root"),
      orphan: makeNode("orphan"),
    });
    const result = validateCustomBlockTree(tree);
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("orphaned"))).toBe(true);
  });

  it("rejects an empty tree", () => {
    const tree = makeTree([], {});
    expect(validateCustomBlockTree(tree).valid).toBe(false);
  });
});

describe("CustomBlockTreeSchema — size caps", () => {
  it("rejects more than the node cap", () => {
    const nodes: Record<string, BlockNode> = {};
    const roots: string[] = [];
    for (let i = 0; i < MAX_CUSTOM_BLOCK_NODES + 1; i += 1) {
      const id = `n-${i}`;
      nodes[id] = makeNode(id);
      roots.push(id);
    }
    const result = validateCustomBlockTree(makeTree(roots, nodes));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("at most"))).toBe(true);
  });

  it("rejects nesting deeper than the depth cap", () => {
    const nodes: Record<string, BlockNode> = {};
    let previous: string | null = null;
    const roots: string[] = [];
    for (let i = 0; i < MAX_CUSTOM_BLOCK_DEPTH + 2; i += 1) {
      const id = `d-${i}`;
      nodes[id] = makeNode(id, { parentId: previous, children: [] });
      if (previous) {
        const parent = nodes[previous];
        if (parent) parent.children = [id];
      } else {
        roots.push(id);
      }
      previous = id;
    }
    const result = validateCustomBlockTree(makeTree(roots, nodes));
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.message.includes("nested deeper"))).toBe(true);
  });

  it("rejects over-long text values in props", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root", {
        type: "paragraph",
        props: { text: "x".repeat(MAX_CUSTOM_BLOCK_TEXT_LENGTH + 1) },
      }),
    });
    expect(CustomBlockTreeSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects dangerous keys inside node props", () => {
    // JSON.parse builds a real own "__proto__" key (literal syntax would set
    // the prototype instead).
    const tree = makeTree(["root"], {
      root: makeNode("root", { props: JSON.parse('{"__proto__": "polluted"}') }),
    });
    expect(CustomBlockTreeSchema.safeParse(tree).success).toBe(false);
  });

  it("rejects style records with unsafe CSS values", () => {
    const tree = makeTree(["root"], {
      root: makeNode("root", { style: { background: "url(javascript:alert(1))" } }),
    });
    expect(CustomBlockTreeSchema.safeParse(tree).success).toBe(false);
  });
});

describe("CustomBlockSectionPropsSchema", () => {
  it("accepts name + valid tree + safe metadata", () => {
    const tree = makeTree(["root"], { root: makeNode("root") });
    const result = CustomBlockSectionPropsSchema.safeParse({
      name: "My design",
      tree,
      sourceMetadata: {
        language: "html",
        importedAt: "2026-01-01T00:00:00.000Z",
        sourceHash: "abcd1234",
        converterVersion: 1,
        warningCount: 2,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("My design");
      expect(result.data.tree.rootIds).toEqual(["root"]);
    }
  });

  it("defaults name and omits optional metadata", () => {
    const tree = makeTree(["root"], { root: makeNode("root") });
    const result = CustomBlockSectionPropsSchema.safeParse({ tree });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Imported design");
      expect(result.data.sourceMetadata).toBeUndefined();
    }
  });

  it("rejects a name over the cap", () => {
    const tree = makeTree(["root"], { root: makeNode("root") });
    const result = CustomBlockSectionPropsSchema.safeParse({ name: "x".repeat(81), tree });
    expect(result.success).toBe(false);
  });

  it("rejects metadata with an unknown language", () => {
    const result = CustomBlockSourceMetadataSchema.safeParse({
      language: "python",
      importedAt: "2026-01-01T00:00:00.000Z",
      sourceHash: "abcd1234",
    });
    expect(result.success).toBe(false);
  });

  it("metadata never stores the pasted source", () => {
    const tree = makeTree(["root"], { root: makeNode("root") });
    const result = CustomBlockSectionPropsSchema.safeParse({
      name: "x",
      tree,
      sourceMetadata: buildSourceMetadata({
        language: "html",
        sourceHash: "deadbeef",
        warningCount: 0,
        importedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const keys = Object.keys(result.data.sourceMetadata ?? {});
      expect(keys).toEqual(expect.arrayContaining(["language", "sourceHash", "importedAt", "converterVersion", "warningCount"]));
      expect(result.data.sourceMetadata?.sourceHash).toBe("deadbeef");
      expect(JSON.stringify(result.data).includes("javascript")).toBe(false);
    }
  });
});

describe("normalizeCustomBlockTree — repair", () => {
  it("drops unknown types, orphans and over-long strings", () => {
    const repaired = normalizeCustomBlockTree({
      rootIds: ["root", "ghost-root"],
      nodes: {
        root: {
          id: "root",
          type: "container",
          parentId: null,
          children: ["keep", "mystery"],
          props: { text: "x".repeat(MAX_CUSTOM_BLOCK_TEXT_LENGTH + 5) },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
        keep: {
          id: "keep",
          type: "heading",
          parentId: "root",
          children: [],
          props: { text: "Hi" },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
        mystery: {
          id: "mystery",
          type: "weird-component",
          parentId: "root",
          children: [],
          props: {},
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
        orphan: {
          id: "orphan",
          type: "paragraph",
          parentId: null,
          children: [],
          props: { text: "lost" },
          style: {},
          responsive: {},
          visible: true,
          locked: false,
          hidden: false,
        },
      },
    });
    expect(repaired).not.toBeNull();
    if (repaired) {
      expect(repaired.rootIds).toEqual(["root"]);
      expect(repaired.nodes.keep).toBeDefined();
      expect(repaired.nodes.mystery).toBeUndefined();
      expect(repaired.nodes.orphan).toBeUndefined();
      const text = repaired.nodes.root.props.text as string;
      expect(text.length).toBe(MAX_CUSTOM_BLOCK_TEXT_LENGTH);
      // No dangerous keys survived.
      expect(findDangerousKeys(repaired)).toHaveLength(0);
    }
  });

  it("returns null when nothing usable remains", () => {
    expect(normalizeCustomBlockTree({ rootIds: ["x"], nodes: {} })).toBeNull();
    expect(normalizeCustomBlockTree(null)).toBeNull();
    expect(normalizeCustomBlockTree("nope")).toBeNull();
  });

  it("does not mutate the input", () => {
    const input = {
      rootIds: ["root"],
      nodes: { root: makeNode("root") },
    };
    const snapshot = JSON.stringify(input);
    normalizeCustomBlockTree(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("normalizeCustomBlockSectionProps — legacy payloads", () => {
  it("repairs a malformed props object into a valid one", () => {
    const normalized = normalizeCustomBlockSectionProps({
      name: "  Legacy  ",
      tree: {
        rootIds: ["root"],
        nodes: { root: makeNode("root", { type: "bad-type" as never }) },
      },
    });
    expect(normalized).toBeNull(); // no usable tree survives → null
  });

  it("returns a valid props object for a repairable payload", () => {
    const normalized = normalizeCustomBlockSectionProps({
      name: "  My block  ",
      tree: {
        rootIds: ["root"],
        nodes: { root: makeNode("root") },
      },
    });
    expect(normalized).not.toBeNull();
    if (normalized) {
      expect(normalized.name).toBe("My block");
      expect(normalized.tree.rootIds).toEqual(["root"]);
    }
  });

  it("returns null for non-object input", () => {
    expect(normalizeCustomBlockSectionProps(null)).toBeNull();
    expect(normalizeCustomBlockSectionProps("x")).toBeNull();
  });
});

describe("buildSourceMetadata", () => {
  it("builds safe metadata with defaults", () => {
    const metadata = buildSourceMetadata({
      language: "jsx",
      sourceHash: "abcdef12",
      warningCount: 3,
    });
    expect(metadata.language).toBe("jsx");
    expect(metadata.sourceHash).toBe("abcdef12");
    expect(metadata.warningCount).toBe(3);
    expect(metadata.converterVersion).toBe(CONVERTER_VERSION);
    expect(typeof metadata.importedAt).toBe("string");
    expect(metadata.importedAt.length).toBeGreaterThan(0);
  });

  it("honours explicit values", () => {
    const metadata = buildSourceMetadata({
      language: "html",
      sourceHash: "12345678",
      warningCount: 0,
      importedAt: "2026-05-05T00:00:00.000Z",
      converterVersion: 2,
    });
    expect(metadata.importedAt).toBe("2026-05-05T00:00:00.000Z");
    expect(metadata.converterVersion).toBe(2);
  });
});
