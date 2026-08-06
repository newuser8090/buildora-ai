// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — schema validation tests
//
//   - valid record parses
//   - dangerous keys rejected (prototype pollution, unsafe values)
//   - tree limits (node cap / depth cap / unknown types)
//   - unsupported file versions rejected
//   - oversized files rejected
//   - sanitization (name/description/tags)
//   - duplicate-safe names
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  MyBlockRecordSchema,
  MyBlockCollectionSchema,
  parseMyBlockRecord,
  parseMyBlockCollection,
  isUsableMyBlockRecord,
  parseBuildoraBlockFile,
  sanitizeMyBlockName,
  sanitizeMyBlockDescription,
  sanitizeMyBlockTags,
  sanitizeMyBlockCollectionName,
  sanitizeMyBlockCollectionDescription,
  sanitizeMyBlockCollectionIds,
  generateUniqueName,
  generateUniqueCollectionName,
  MY_BLOCK_CURRENT_VERSION,
  MY_BLOCK_MAX_TAGS,
  MY_BLOCK_MAX_COLLECTIONS,
  MY_BLOCK_MAX_COLLECTION_NAME_LENGTH,
  MY_BLOCK_FILE_FORMAT_VERSION,
} from "../schemas/my-block-schema";
import { makeNode, makeRecord, makeTree } from "./helpers";

// ---------------------------------------------------------------------------
// Record schema
// ---------------------------------------------------------------------------

describe("MyBlockRecordSchema", () => {
  it("accepts a valid record", () => {
    const record = makeRecord();
    const result = MyBlockRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("rejects a record with an unknown category", () => {
    const record = makeRecord({ category: "totally-new" as never });
    const result = MyBlockRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it("rejects an empty or missing tree", () => {
    const empty = makeRecord({ tree: { rootIds: [], nodes: {} } });
    expect(MyBlockRecordSchema.safeParse(empty).success).toBe(false);

    const missing = makeRecord();
    delete (missing as { tree?: unknown }).tree;
    expect(MyBlockRecordSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects an unknown node type", () => {
    const tree = makeTree();
    tree.nodes[tree.rootIds[0]] = makeNode(tree.rootIds[0], { type: "warp-drive" as never });
    expect(MyBlockRecordSchema.safeParse(makeRecord({ tree })).success).toBe(false);
  });

  it("rejects over-long names and descriptions", () => {
    expect(MyBlockRecordSchema.safeParse(makeRecord({ name: "x".repeat(81) })).success).toBe(false);
    expect(MyBlockRecordSchema.safeParse(makeRecord({ description: "x".repeat(281) })).success).toBe(false);
  });

  it("rejects too many tags", () => {
    const tags = Array.from({ length: MY_BLOCK_MAX_TAGS + 1 }, (_, i) => `tag-${i}`);
    expect(MyBlockRecordSchema.safeParse(makeRecord({ tags })).success).toBe(false);
  });

  it("rejects an unsupported future version", () => {
    expect(
      MyBlockRecordSchema.safeParse(makeRecord({ version: MY_BLOCK_CURRENT_VERSION + 1 })).success,
    ).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(MyBlockRecordSchema.safeParse(makeRecord({ name: "   " })).success).toBe(false);
  });

  it("rejects unknown extra keys (strict)", () => {
    const record = makeRecord() as unknown as Record<string, unknown>;
    record.rawSource = "<script>alert(1)</script>";
    expect(MyBlockRecordSchema.safeParse(record).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dangerous keys / values
// ---------------------------------------------------------------------------

describe("dangerous content rejection", () => {
  it("rejects __proto__ keys inside node props", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId] = makeNode(rootId, {
      props: JSON.parse('{"__proto__": {"polluted": true}}'),
    });
    expect(parseMyBlockRecord(makeRecord({ tree }))).toBeNull();
  });

  it("rejects constructor keys inside node props", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId] = makeNode(rootId, { props: { constructor: { prototype: {} } } });
    expect(parseMyBlockRecord(makeRecord({ tree }))).toBeNull();
  });

  it("rejects unsafe CSS values (javascript: URLs)", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId] = makeNode(rootId, {
      props: { href: "javascript:alert(1)" },
    });
    expect(parseMyBlockRecord(makeRecord({ tree }))).toBeNull();
  });

  it("rejects dangerous style keys (binding)", () => {
    const tree = makeTree();
    const rootId = tree.rootIds[0];
    tree.nodes[rootId] = makeNode(rootId, { style: { binding: "url(data:text/html;base64,...)" } });
    expect(parseMyBlockRecord(makeRecord({ tree }))).toBeNull();
  });

  it("rejects trees over the node cap", () => {
    const nodes: Record<string, ReturnType<typeof makeNode>> = {};
    const ids: string[] = [];
    for (let i = 0; i < 401; i++) {
      const id = `n-${i}`;
      ids.push(id);
      nodes[id] = makeNode(id);
    }
    const tree = { rootIds: ids, nodes };
    expect(parseMyBlockRecord(makeRecord({ tree }))).toBeNull();
  });

  it("rejects trees nested deeper than the depth cap", () => {
    // Chain 30 deep — each node is the child of the previous one.
    let prevId = "d0";
    const nodes: Record<string, ReturnType<typeof makeNode>> = { d0: makeNode("d0") };
    for (let i = 1; i < 30; i++) {
      const id = `d${i}`;
      nodes[id] = makeNode(id, { parentId: prevId });
      nodes[prevId].children.push(id);
      prevId = id;
    }
    const tree = { rootIds: ["d0"], nodes };
    expect(parseMyBlockRecord(makeRecord({ tree }))).toBeNull();
  });

  it("isUsableMyBlockRecord requires a non-empty root", () => {
    expect(isUsableMyBlockRecord(makeRecord())).toBe(true);
    expect(isUsableMyBlockRecord(makeRecord({ tree: { rootIds: [], nodes: {} } }))).toBe(false);
    expect(isUsableMyBlockRecord("garbage")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Block file format
// ---------------------------------------------------------------------------

describe("parseBuildoraBlockFile", () => {
  function makeFilePayload() {
    return {
      format: "buildora-block",
      version: MY_BLOCK_FILE_FORMAT_VERSION,
      block: {
        name: "Hero",
        category: "layout",
        tags: ["hero"],
        tree: makeTree(),
      },
    };
  }

  it("parses a valid block file", () => {
    const result = parseBuildoraBlockFile(makeFilePayload());
    expect(result.ok).toBe(true);
  });

  it("rejects a non-block payload", () => {
    const result = parseBuildoraBlockFile({ format: "buildora-project", version: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not a Buildora block file");
  });

  it("rejects an unsupported version with a user-safe message", () => {
    const payload = makeFilePayload();
    payload.version = MY_BLOCK_FILE_FORMAT_VERSION + 1;
    const result = parseBuildoraBlockFile(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("unsupported version");
  });

  it("rejects an invalid block payload with the offending path", () => {
    const payload = makeFilePayload();
    (payload.block as { name?: unknown }).name = "";
    const result = parseBuildoraBlockFile(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("block.name");
  });

  it("rejects dangerous tree content inside a file", () => {
    const payload = makeFilePayload();
    const rootId = payload.block.tree.rootIds[0];
    payload.block.tree.nodes[rootId] = makeNode(rootId, { props: { __proto__: {} } });
    expect(parseBuildoraBlockFile(payload).ok).toBe(false);
  });

  it("rejects null / non-object payloads", () => {
    expect(parseBuildoraBlockFile(null).ok).toBe(false);
    expect(parseBuildoraBlockFile("string").ok).toBe(false);
    expect(parseBuildoraBlockFile(42).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

describe("sanitization", () => {
  it("trims and caps names; empty → null", () => {
    expect(sanitizeMyBlockName("  Hero  ")).toBe("Hero");
    expect(sanitizeMyBlockName("x".repeat(200))!.length).toBe(80);
    expect(sanitizeMyBlockName("   ")).toBeNull();
    expect(sanitizeMyBlockName(42)).toBeNull();
  });

  it("trims and caps descriptions; empty → undefined", () => {
    expect(sanitizeMyBlockDescription("  A block  ")).toBe("A block");
    expect(sanitizeMyBlockDescription("x".repeat(500))!.length).toBe(280);
    expect(sanitizeMyBlockDescription("  ")).toBeUndefined();
  });

  it("dedupes tags case-insensitively, caps count and length", () => {
    const tags = sanitizeMyBlockTags(["Hero", "hero", "  Pricing  ", "pricing", "x".repeat(100), "", 42]);
    expect(tags).toEqual(["Hero", "Pricing", "x".repeat(24)]);
  });

  it("returns [] for non-array tag input", () => {
    expect(sanitizeMyBlockTags("hero")).toEqual([]);
    expect(sanitizeMyBlockTags(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Duplicate-safe names
// ---------------------------------------------------------------------------

describe("generateUniqueName", () => {
  it("keeps a base name when free", () => {
    expect(generateUniqueName("Hero", ["Nav", "Footer"])).toBe("Hero");
  });

  it("suffixes 2, 3, … for taken names (case-insensitive)", () => {
    expect(generateUniqueName("Hero", ["hero"])).toBe("Hero 2");
    expect(generateUniqueName("Hero", ["Hero", "HERO 2"])).toBe("Hero 3");
  });

  it("falls back to a safe default for empty input", () => {
    expect(generateUniqueName("   ", [])).toBe("Saved block");
    expect(generateUniqueName("   ", ["Saved block"])).toBe("Saved block 2");
  });

  it("never returns a name already in the list", () => {
    const existing = ["Pricing", "Pricing 2", "Pricing 3"];
    const next = generateUniqueName("Pricing", existing);
    expect(existing.map((n) => n.toLowerCase())).not.toContain(next.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Phase P5 — backward compatibility with Phase P4 records
// ---------------------------------------------------------------------------

describe("Phase P4 record backward compatibility", () => {
  it("a P4 record (no Phase P5 fields) remains valid", () => {
    const p4 = makeRecord();
    // Remove every optional Phase P5 field explicitly.
    delete p4.favorite;
    delete p4.collectionIds;
    delete p4.thumbnail;
    delete p4.contentRevision;
    expect(parseMyBlockRecord(p4)).not.toBeNull();
  });

  it("records with Phase P5 optional fields parse and default absent fields away", () => {
    const record = makeRecord({
      favorite: true,
      collectionIds: ["col-1"],
      thumbnail: {
        revision: 1,
        generatedAt: "2026-08-01T00:00:00.000Z",
        mimeType: "image/webp",
        width: 480,
        height: 300,
        byteSize: 1024,
        hash: "abc123",
      },
      contentRevision: 2,
    });
    const parsed = parseMyBlockRecord(record);
    expect(parsed).not.toBeNull();
    expect(parsed!.favorite).toBe(true);
    expect(parsed!.collectionIds).toEqual(["col-1"]);
    expect(parsed!.contentRevision).toBe(2);
    expect(parsed!.thumbnail?.byteSize).toBe(1024);
  });

  it("rejects a thumbnail with an unsupported mimeType or negative bytes", () => {
    const bad = makeRecord({
      thumbnail: {
        revision: 1,
        generatedAt: "2026-08-01T00:00:00.000Z",
        mimeType: "image/gif" as never,
        width: 480,
        height: 300,
        byteSize: 1024,
        hash: "abc",
      },
    });
    expect(parseMyBlockRecord(bad)).toBeNull();
    const negative = makeRecord({
      thumbnail: {
        revision: 1,
        generatedAt: "2026-08-01T00:00:00.000Z",
        mimeType: "image/png",
        width: 480,
        height: 300,
        byteSize: -5,
        hash: "abc",
      },
    });
    expect(parseMyBlockRecord(negative)).toBeNull();
  });

  it("rejects a non-positive contentRevision", () => {
    expect(
      parseMyBlockRecord(makeRecord({ contentRevision: 0 })),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase P5 — collections schema
// ---------------------------------------------------------------------------

describe("MyBlockCollectionSchema", () => {
  function makeCollection(overrides: Record<string, unknown> = {}) {
    return {
      id: "col-1",
      version: 1,
      name: "Landing pages",
      description: "Heroes and navigation",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      sortOrder: 0,
      ...overrides,
    };
  }

  it("accepts a valid collection", () => {
    expect(MyBlockCollectionSchema.safeParse(makeCollection()).success).toBe(true);
  });

  it("rejects unknown extra keys (strict) and future versions", () => {
    const extra = makeCollection({ blocks: [] });
    expect(MyBlockCollectionSchema.safeParse(extra).success).toBe(false);
    expect(MyBlockCollectionSchema.safeParse(makeCollection({ version: 2 })).success).toBe(false);
  });

  it("rejects empty names, over-long names, and negative sortOrder", () => {
    expect(MyBlockCollectionSchema.safeParse(makeCollection({ name: "  " })).success).toBe(false);
    expect(
      MyBlockCollectionSchema.safeParse(makeCollection({ name: "x".repeat(61) })).success,
    ).toBe(false);
    expect(MyBlockCollectionSchema.safeParse(makeCollection({ sortOrder: -1 })).success).toBe(false);
  });

  it("parseMyBlockCollection returns null for corrupt input", () => {
    expect(parseMyBlockCollection(null)).toBeNull();
    expect(parseMyBlockCollection("string")).toBeNull();
    expect(parseMyBlockCollection({ id: "x" })).toBeNull();
  });

  it("sanitizeMyBlockCollectionName trims + caps; empty → null", () => {
    expect(sanitizeMyBlockCollectionName("  Landing  ")).toBe("Landing");
    expect(sanitizeMyBlockCollectionName("x".repeat(200))!.length).toBe(MY_BLOCK_MAX_COLLECTION_NAME_LENGTH);
    expect(sanitizeMyBlockCollectionName("   ")).toBeNull();
    expect(sanitizeMyBlockCollectionName(42)).toBeNull();
  });

  it("sanitizeMyBlockCollectionDescription trims + caps; empty → undefined", () => {
    expect(sanitizeMyBlockCollectionDescription("  A folder  ")).toBe("A folder");
    expect(sanitizeMyBlockCollectionDescription("   ")).toBeUndefined();
  });

  it("sanitizeMyBlockCollectionIds dedupes, trims, and caps", () => {
    const ids = sanitizeMyBlockCollectionIds([" col-1 ", "col-1", "col-2", "", 42, "col-3"]);
    expect(ids).toEqual(["col-1", "col-2", "col-3"]);
    const many = sanitizeMyBlockCollectionIds(Array.from({ length: MY_BLOCK_MAX_COLLECTIONS + 5 }, (_, i) => `c${i}`));
    expect(many.length).toBe(MY_BLOCK_MAX_COLLECTIONS);
  });
});

describe("generateUniqueCollectionName", () => {
  it("keeps a free name and suffixes duplicates deterministically", () => {
    expect(generateUniqueCollectionName("Landing", ["Nav"])).toBe("Landing");
    expect(generateUniqueCollectionName("Landing", ["landing"])).toBe("Landing 2");
    expect(generateUniqueCollectionName("Landing", ["Landing", "LANDING 2"])).toBe("Landing 3");
  });

  it("fits the suffix inside the collection name limit", () => {
    const long = "x".repeat(MY_BLOCK_MAX_COLLECTION_NAME_LENGTH);
    const next = generateUniqueCollectionName(long, [long]);
    expect(next.length).toBeLessThanOrEqual(MY_BLOCK_MAX_COLLECTION_NAME_LENGTH);
    expect(next).toMatch(/x+ 2$/);
  });

  it("falls back to a safe default for empty input", () => {
    expect(generateUniqueCollectionName("   ", [])).toBe("Collection");
    expect(generateUniqueCollectionName("   ", ["Collection"])).toBe("Collection 2");
  });
});
