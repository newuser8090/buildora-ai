// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — .buildora-block.json transfer tests
//
//   - buildBlockFile: no local record id, no timestamps, no usage metadata
//   - parseBlockFileJson: rejects non-JSON, wrong format, unsupported version,
//     oversized payloads — with user-safe messages
//   - importBlockFile: fresh library id + fresh timestamps + duplicate-safe
//     name + independent deep-cloned tree
//   - import never mixes with project export
//
// Phase P5 — bulk .buildora-blocks.json format:
//   - buildBlocksFile: deterministic ordering, no local ids/timestamps/blobs
//   - parseBlocksFileJson: validation + single-file upgrade path
//   - importBlocksFile: fresh ids, duplicate-safe names, per-item results,
//     partial import, collection reconstruction
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildBlockFile,
  validateBlockFile,
  parseBlockFileJson,
  importBlockFile,
  importBlockFileJson,
  buildBlocksFile,
  validateBlocksFile,
  parseBlocksFileJson,
  importBlocksFile,
  estimateBulkFileBytes,
  type BulkImportItemResult,
} from "../services/my-block-file";
import {
  MY_BLOCK_MAX_FILE_SIZE_BYTES,
  MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES,
  MY_BLOCK_MAX_BULK_BLOCKS,
  type BuildoraBlocksFile,
} from "../schemas/my-block-schema";
import { InMemoryMyBlocksAdapter, makeNode, makeRecord, makeTree } from "./helpers";

describe("buildBlockFile", () => {
  it("excludes local ids, timestamps, and usage metadata", () => {
    const record = makeRecord({
      id: "myblock-local-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      lastUsedAt: "2026-08-01T00:00:00.000Z",
      useCount: 7,
    });
    const file = buildBlockFile(record);
    expect(file.format).toBe("buildora-block");
    expect(file.version).toBe(1);
    expect(file.block.name).toBe(record.name);
    expect("id" in file).toBe(false);
    expect("createdAt" in JSON.parse(JSON.stringify(file))).toBe(false);
    expect("updatedAt" in JSON.parse(JSON.stringify(file))).toBe(false);
    expect("useCount" in file.block).toBe(false);
    expect("lastUsedAt" in file.block).toBe(false);
    expect("previewMetadata" in file.block).toBe(false);
  });

  it("produces a schema-valid payload", () => {
    expect(validateBlockFile(buildBlockFile(makeRecord()))).toBe(true);
  });
});

describe("parseBlockFileJson", () => {
  it("parses a valid JSON block file", () => {
    const file = buildBlockFile(makeRecord());
    const result = parseBlockFileJson(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.block.name).toBe("Test block");
  });

  it("rejects invalid JSON with a user-safe message", () => {
    const result = parseBlockFileJson("{ not json !!");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not valid JSON");
  });

  it("rejects a wrong format (project files never mix)", () => {
    const projectPayload = { format: "buildora-project", version: 2, project: {} };
    const result = parseBlockFileJson(JSON.stringify(projectPayload));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not a Buildora block file");
  });

  it("rejects an unsupported version", () => {
    const file = buildBlockFile(makeRecord());
    (file as { version: number }).version = 99;
    const result = parseBlockFileJson(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("unsupported version");
  });

  it("rejects oversized payloads before parsing", () => {
    const huge = " ".repeat(MY_BLOCK_MAX_FILE_SIZE_BYTES * 2 + 10);
    const result = parseBlockFileJson(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("too large");
  });

  it("rejects a file whose block tree is invalid", () => {
    const file = buildBlockFile(makeRecord());
    file.block.tree = {
      rootIds: ["r"],
      nodes: { r: makeNode("r", { type: "nope" as never }) },
    };
    const result = parseBlockFileJson(JSON.stringify(file));
    expect(result.ok).toBe(false);
  });
});

describe("importBlockFile", () => {
  it("assigns a fresh id and duplicate-safe name on import", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });

    // File without sourceMetadata → import marks provenance as "imported".
    const file = buildBlockFile(makeRecord({ name: "Hero", id: "should-not-survive" }));
    delete file.block.sourceMetadata;
    const result = await importBlockFile(adapter, file, ["Hero"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).not.toBe("should-not-survive");
      expect(result.value.name).toBe("Hero 2");
      expect(result.value.sourceMetadata?.source).toBe("imported");
      expect(result.value.useCount).toBe(0);
    }
  });

  it("preserves provenance carried by the file", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const file = buildBlockFile(
      makeRecord({ sourceMetadata: { source: "created" } }),
    );
    const result = await importBlockFile(adapter, file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sourceMetadata?.source).toBe("created");
    }
  });

  it("creates an independent deep-cloned tree", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const file = buildBlockFile(makeRecord());
    const result = await importBlockFile(adapter, file);
    if (!result.ok) throw new Error("import failed");
    result.value.tree.nodes[result.value.tree.rootIds[0]].props.name = "changed";
    // The in-memory source file's tree is untouched (import clones it).
    expect(file.block.tree.nodes[file.block.tree.rootIds[0]].props.name).toBe("Pricing section");
  });

  it("importBlockFileJson parses + imports in one step", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const result = await importBlockFileJson(adapter, JSON.stringify(buildBlockFile(makeRecord())));
    expect(result.ok).toBe(true);
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(1);
  });

  it("importBlockFileJson surfaces parse errors as INVALID_RECORD", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const result = await importBlockFileJson(adapter, "garbage");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_RECORD");
  });
});

// ---------------------------------------------------------------------------
// Phase P5 — bulk .buildora-blocks.json format
// ---------------------------------------------------------------------------

describe("buildBlocksFile", () => {
  it("orders blocks deterministically (name A–Z) and excludes local ids/timestamps/blobs", () => {
    const zebra = makeRecord({
      id: "local-zebra",
      name: "Zebra",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      lastUsedAt: "2026-08-01T00:00:00.000Z",
      useCount: 9,
      favorite: true,
      thumbnail: {
        revision: 1,
        generatedAt: "2026-08-01T00:00:00.000Z",
        mimeType: "image/webp",
        width: 480,
        height: 300,
        byteSize: 1024,
        hash: "abc",
      },
    });
    const alpha = makeRecord({ id: "local-alpha", name: "Alpha" });

    const file = buildBlocksFile([zebra, alpha]);
    expect(file.format).toBe("buildora-blocks");
    expect(file.version).toBe(1);
    expect(file.blocks.map((b) => b.name)).toEqual(["Alpha", "Zebra"]);

    // No local ids / usage / preview metadata leak into the file.
    for (const block of file.blocks) {
      expect("id" in block).toBe(false);
      expect("createdAt" in block).toBe(false);
      expect("updatedAt" in block).toBe(false);
      expect("lastUsedAt" in block).toBe(false);
      expect("useCount" in block).toBe(false);
      expect("favorite" in block).toBe(false);
      expect("thumbnail" in block).toBe(false);
      expect("collectionIds" in block).toBe(false);
      expect("previewMetadata" in block).toBe(false);
    }
    const serialized = JSON.stringify(file);
    expect(serialized).not.toContain("local-zebra");
    expect(serialized).not.toContain("local-alpha");
  });

  it("is deterministic across two builds", () => {
    const records = [
      makeRecord({ name: "Zebra" }),
      makeRecord({ name: "Alpha" }),
      makeRecord({ name: "Beta" }),
    ];
    const a = JSON.stringify(buildBlocksFile(records));
    const b = JSON.stringify(buildBlocksFile([...records].reverse()));
    expect(a).toBe(b);
  });

  it("produces a schema-valid payload with optional collections by index", () => {
    const hero = makeRecord({ name: "Hero", collectionIds: ["col-1"] });
    const nav = makeRecord({ name: "Nav", collectionIds: ["col-1", "col-2"] });
    const file = buildBlocksFile([hero, nav], [
      { id: "col-1", version: 1, name: "Landing", createdAt: "", updatedAt: "", sortOrder: 0 },
      { id: "col-2", version: 1, name: "Empty", createdAt: "", updatedAt: "", sortOrder: 1 },
    ]);
    expect(validateBlocksFile(file)).toBe(true);
    // Deterministic block order: Hero (index 0), Nav (index 1).
    expect(file.collections).toEqual([
      { name: "Landing", blockIndexes: [0, 1] },
      { name: "Empty", blockIndexes: [1] },
    ]);
  });

  it("never embeds thumbnail blobs or raw source", () => {
    const file = buildBlocksFile([makeRecord()]);
    const serialized = JSON.stringify(file);
    expect(serialized).not.toContain("image/webp");
    expect(serialized).not.toContain("data:");
    expect(serialized).not.toContain("<script");
  });
});

describe("parseBlocksFileJson", () => {
  it("parses a valid bulk file", () => {
    const file = buildBlocksFile([makeRecord({ name: "Hero" })]);
    const result = parseBlocksFileJson(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.blocks).toHaveLength(1);
  });

  it("rejects invalid JSON with a user-safe message", () => {
    const result = parseBlocksFileJson("{ nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("not valid JSON");
  });

  it("rejects a non-blocks payload", () => {
    const result = parseBlocksFileJson(JSON.stringify({ format: "buildora-project", version: 2 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not a Buildora block|Invalid block file/);
  });

  it("rejects an unsupported bulk version", () => {
    const file = buildBlocksFile([makeRecord()]);
    (file as { version: number }).version = 2;
    const result = parseBlocksFileJson(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("unsupported version");
  });

  it("rejects oversized bulk payloads before parsing", () => {
    const huge = " ".repeat(MY_BLOCK_MAX_BULK_FILE_SIZE_BYTES * 2 + 10);
    const result = parseBlocksFileJson(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("too large");
  });

  it("rejects a bulk file with more than the block cap", () => {
    const file = buildBlocksFile([makeRecord()]);
    file.blocks = Array.from({ length: MY_BLOCK_MAX_BULK_BLOCKS + 1 }, (_, i) =>
      buildBlockFile(makeRecord({ name: `B${i}` })).block,
    );
    const result = parseBlocksFileJson(JSON.stringify(file));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Invalid blocks file");
  });

  it("upgrades a single-block file into the bulk flow", () => {
    const single = buildBlockFile(makeRecord({ name: "Solo" }));
    const result = parseBlocksFileJson(JSON.stringify(single));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file.format).toBe("buildora-blocks");
      expect(result.file.blocks).toHaveLength(1);
      expect(result.file.blocks[0].name).toBe("Solo");
    }
  });
});

describe("importBlocksFile", () => {
  function makeBulk(names: string[]): BuildoraBlocksFile {
    const blocks = names.map((name) => buildBlockFile(makeRecord({ name })).block);
    return { format: "buildora-blocks", version: 1, exportedAt: "2026-08-01T00:00:00.000Z", blocks };
  }

  it("imports every block with fresh ids and reports per-item results", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const result = await importBlocksFile(adapter, makeBulk(["Hero", "Nav", "Footer"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(3);
    expect(result.value.failed).toBe(0);
    expect(result.value.skipped).toBe(0);
    expect(result.value.records).toHaveLength(3);
    expect(result.value.results.map((r) => r.outcome)).toEqual(["imported", "imported", "imported"]);

    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(3);
    if (list.ok) {
      for (const record of list.value) {
        // Fresh content epoch for the imported tree (thumbnail invalidation).
        expect(record.contentRevision).toBe(1);
      }
    }
  });

  it("renames duplicates safely (case-insensitive) and reports renamed", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    await adapter.createMyBlock({ name: "Hero", category: "layout", tree: makeTree() });
    const result = await importBlocksFile(adapter, makeBulk(["Hero", "hero", "Other"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(1);
    expect(result.value.renamed).toBe(2);
    const names = result.value.records.map((r) => r.name);
    // The generator preserves each entry's own casing while making it unique.
    expect(names).toContain("Hero 2");
    expect(names).toContain("hero 3");
    // 1 pre-seeded Hero + 3 imported = 4 total.
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(4);
    if (list.ok) {
      // 1 seeded "Hero" + "Hero 2" + "hero 3" + "Other" — all unique.
      const unique = new Set(list.value.map((r) => r.name.toLowerCase()));
      expect(unique.size).toBe(4);
    }
  });

  it("supports partial import via selectedIndexes and counts skipped", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    const result = await importBlocksFile(adapter, makeBulk(["A", "B", "C"]), {
      selectedIndexes: [0, 2],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(2);
    expect(result.value.skipped).toBe(1);
    const names = result.value.records.map((r) => r.name);
    expect(names).toEqual(["A", "C"]);
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(2);
  });

  it("isolates individual failures — valid records still import (partial import)", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    // Corrupt the second block by giving it a tree that fails validation.
    const file = makeBulk(["Good A", "Good B", "Bad C"]);
    file.blocks[2].tree = { rootIds: ["r"], nodes: { r: makeNode("r", { type: "nope" as never }) } };
    const result = await importBlocksFile(adapter, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.imported).toBe(2);
    expect(result.value.failed).toBe(1);
    const failed = result.value.results.find((r) => r.outcome === "failed") as BulkImportItemResult;
    expect(failed.originalName).toBe("Bad C");
    expect(failed.error).toBeTruthy();
    const list = await adapter.listMyBlocks();
    expect(list.ok && list.value).toHaveLength(2);
  });

  it("reconstructs collections from the file with duplicate-safe names", async () => {
    const adapter = new InMemoryMyBlocksAdapter();
    await adapter.createMyBlockCollection({ name: "Landing" });

    // Both records belong to col-1 so the file's collection metadata indexes
    // reference both blocks (hero → index 0, nav → index 1 after A–Z sort).
    const hero = makeRecord({ name: "Hero", collectionIds: ["col-1"] });
    const nav = makeRecord({ name: "Nav", collectionIds: ["col-1"] });
    const file = buildBlocksFile([hero, nav], [
      { id: "col-1", version: 1, name: "Landing", createdAt: "", updatedAt: "", sortOrder: 0 },
    ]);

    const result = await importBlocksFile(adapter, file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const collections = await adapter.listMyBlockCollections();
    expect(collections.ok).toBe(true);
    if (!collections.ok) return;
    expect(collections.value.map((c) => c.name)).toContain("Landing 2");
    const imported = collections.value.find((c) => c.name === "Landing 2");
    expect(imported).toBeDefined();
    if (!imported) return;

    // Re-read the imported records: membership is attached AFTER creation,
    // so the summary snapshot predates the collection attachment.
    const list = await adapter.listMyBlocks();
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const members = list.value.filter((r) => r.collectionIds?.includes(imported.id));
    // Both blocks belonged to col-1 → both attach to the reconstructed copy.
    expect(members).toHaveLength(2);
  });
});

describe("estimateBulkFileBytes", () => {
  it("is positive and stable", () => {
    const file = buildBlocksFile([makeRecord()]);
    const bytes = estimateBulkFileBytes(file);
    expect(bytes).toBeGreaterThan(0);
    expect(estimateBulkFileBytes(file)).toBe(bytes);
  });
});
