// ---------------------------------------------------------------------------
// readProjectFile — Phase E.2 tests
//
// Covers the documented extension policy and the 10 MB size boundary:
//   - .buildora.json accepted; .BUILDORA.JSON accepted (case-insensitive)
//   - .json accepted
//   - .txt, no extension, .buildora, .buildora.json.backup rejected
//   - multiple dots handled correctly
//   - empty MIME accepted when the extension is valid
//   - application/json accepted; application/octet-stream does not override
//     a valid extension; a misleading JSON MIME does not permit an invalid
//     extension
//   - size boundary: just below 10 MB accepted, exactly 10 MB accepted,
//     greater than 10 MB rejected with structured details
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { readProjectFile } from "../utils/read-project-file";
import { MAX_IMPORT_FILE_SIZE } from "../types/project-transfer";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, size: number, type = "text/plain"): File {
  // Create a File of an exact byte size using a Uint8Array.
  const bytes = new Uint8Array(size);
  return new File([bytes], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readProjectFile — extension policy", () => {
  it("accepts .buildora.json", async () => {
    const result = await readProjectFile(makeFile("project.buildora.json", 10));
    expect(result.ok).toBe(true);
  });

  it("accepts .BUILDORA.JSON (case-insensitive)", async () => {
    const result = await readProjectFile(makeFile("PROJECT.BUILDORA.JSON", 10));
    expect(result.ok).toBe(true);
  });

  it("accepts .json", async () => {
    const result = await readProjectFile(makeFile("project.json", 10));
    expect(result.ok).toBe(true);
  });

  it("rejects .txt", async () => {
    const result = await readProjectFile(makeFile("project.txt", 10));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_EXTENSION");
    }
  });

  it("rejects a file with no extension", async () => {
    const result = await readProjectFile(makeFile("project", 10));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_EXTENSION");
    }
  });

  it("rejects .buildora", async () => {
    const result = await readProjectFile(makeFile("project.buildora", 10));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_EXTENSION");
    }
  });

  it("rejects project.buildora.json.backup", async () => {
    const result = await readProjectFile(makeFile("project.buildora.json.backup", 10));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_EXTENSION");
    }
  });

  it("handles multiple dots correctly", async () => {
    // "archive.v1.buildora.json" ends in ".json" → accepted.
    const ok = await readProjectFile(makeFile("archive.v1.buildora.json", 10));
    expect(ok.ok).toBe(true);

    // "archive.buildora.json.tar.gz" ends in ".gz" → rejected.
    const bad = await readProjectFile(makeFile("archive.buildora.json.tar.gz", 10));
    expect(bad.ok).toBe(false);
  });

  it("accepts an empty MIME type when the extension is valid", async () => {
    const result = await readProjectFile(makeFile("project.buildora.json", 10, ""));
    expect(result.ok).toBe(true);
  });

  it("accepts application/json", async () => {
    const result = await readProjectFile(makeFile("project.buildora.json", 10, "application/json"));
    expect(result.ok).toBe(true);
  });

  it("application/octet-stream does not override a valid extension", async () => {
    const result = await readProjectFile(
      makeFile("project.buildora.json", 10, "application/octet-stream"),
    );
    expect(result.ok).toBe(true);
  });

  it("a misleading JSON MIME does not permit an invalid extension", async () => {
    const result = await readProjectFile(makeFile("project.txt", 10, "application/json"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_FILE_EXTENSION");
    }
  });
});

describe("readProjectFile — 10 MB size boundary", () => {
  it("accepts a file just below 10 MB", async () => {
    const result = await readProjectFile(
      makeFile("below.buildora.json", MAX_IMPORT_FILE_SIZE - 1),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a file of exactly 10 MB", async () => {
    const result = await readProjectFile(
      makeFile("exact.buildora.json", MAX_IMPORT_FILE_SIZE),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a file greater than 10 MB with structured details", async () => {
    const result = await readProjectFile(
      makeFile("over.buildora.json", MAX_IMPORT_FILE_SIZE + 1),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FILE_TOO_LARGE");
      expect(result.error.details).toMatchObject({
        limit: "FILE_SIZE",
        actual: MAX_IMPORT_FILE_SIZE + 1,
        max: MAX_IMPORT_FILE_SIZE,
        path: "file",
      });
    }
  });
});
