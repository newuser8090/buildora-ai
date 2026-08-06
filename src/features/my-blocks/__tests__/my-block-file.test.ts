// ---------------------------------------------------------------------------
// My Blocks Library (Phase P4) — .buildora-block.json transfer tests
//
//   - buildBlockFile: no local record id, no timestamps, no usage metadata
//   - parseBlockFileJson: rejects non-JSON, wrong format, unsupported version,
//     oversized payloads — with user-safe messages
//   - importBlockFile: fresh library id + fresh timestamps + duplicate-safe
//     name + independent deep-cloned tree
//   - import never mixes with project export
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  buildBlockFile,
  validateBlockFile,
  parseBlockFileJson,
  importBlockFile,
  importBlockFileJson,
} from "../services/my-block-file";
import { MY_BLOCK_MAX_FILE_SIZE_BYTES } from "../schemas/my-block-schema";
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
