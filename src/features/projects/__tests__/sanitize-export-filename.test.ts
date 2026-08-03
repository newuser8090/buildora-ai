// ---------------------------------------------------------------------------
// sanitizeExportFilename tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { sanitizeExportFilename, MAX_FILENAME_LENGTH } from "../utils/sanitize-export-filename";
import { BUILDORA_EXTENSION, DEFAULT_EXPORT_FILENAME } from "../types/project-transfer";

describe("sanitizeExportFilename", () => {
  it("converts to lowercase and replaces spaces with hyphens", () => {
    expect(sanitizeExportFilename("Landing Page")).toBe("landing-page.buildora.json");
  });

  it("removes forbidden filesystem characters", () => {
    expect(sanitizeExportFilename("My / Project?")).toBe("my-project.buildora.json");
    expect(sanitizeExportFilename("Test: File* Name")).toBe("test-file-name.buildora.json");
    expect(sanitizeExportFilename('Hello <World> "Test"')).toBe("hello-world-test.buildora.json");
  });

  it("collapses repeated whitespace", () => {
    expect(sanitizeExportFilename("  HELLO  WORLD  ")).toBe("hello-world.buildora.json");
  });

  it("returns default filename for empty/blank name", () => {
    expect(sanitizeExportFilename("")).toBe(DEFAULT_EXPORT_FILENAME);
    expect(sanitizeExportFilename("   ")).toBe(DEFAULT_EXPORT_FILENAME);
    expect(sanitizeExportFilename("/?<>")).toBe(DEFAULT_EXPORT_FILENAME);
  });

  it("limits filename length", () => {
    const longName = "a".repeat(200);
    const result = sanitizeExportFilename(longName);
    expect(result.length).toBeLessThanOrEqual(MAX_FILENAME_LENGTH);
    expect(result.endsWith(BUILDORA_EXTENSION)).toBe(true);
  });

  it("trims trailing hyphens after length truncation", () => {
    // Name that would end with hyphen after truncation
    const nameWithTrailingHyphen = "a".repeat(MAX_FILENAME_LENGTH - BUILDORA_EXTENSION.length) + "---";
    const result = sanitizeExportFilename(nameWithTrailingHyphen);
    expect(result.endsWith("---")).toBe(false);
    expect(result.endsWith(BUILDORA_EXTENSION)).toBe(true);
  });

  it("does not duplicate extension", () => {
    const result = sanitizeExportFilename("test.buildora.json");
    // Should not produce "test.buildora.json.buildora.json"
    const extensionCount = (result.match(/\.buildora\.json/g) || []).length;
    expect(extensionCount).toBe(1);
  });

  it("preserves non-forbidden special characters", () => {
    // Emoji characters are valid in filenames on modern OSes
    const result = sanitizeExportFilename("My✨Project");
    expect(result).toMatch(/^my.*project\.buildora\.json$/);
    expect(result).toContain("buildora.json");
    // Underscore is preserved (not in forbidden set)
    expect(sanitizeExportFilename("Hello_World")).toBe("hello_world.buildora.json");
  });

  it("preserves readable casing relative to input", () => {
    const result = sanitizeExportFilename("My Awesome Site");
    expect(result).toBe("my-awesome-site.buildora.json");
  });
});
