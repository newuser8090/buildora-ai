import { describe, it, expect } from "vitest";
import {
  validateProjectFileMetadata,
  createProjectFilename,
  getExtension,
} from "../services/project-file-validation";

// ---------------------------------------------------------------------------
// File metadata validation tests
// ---------------------------------------------------------------------------

describe("File metadata — extension validation", () => {
  it("accepts .buildora.json extension", () => {
    const result = validateProjectFileMetadata({ filename: "project.buildora.json" });
    expect(result.valid).toBe(true);
  });

  it("accepts .json extension", () => {
    const result = validateProjectFileMetadata({ filename: "project.json" });
    expect(result.valid).toBe(true);
  });

  it("accepts uppercase extension", () => {
    const result = validateProjectFileMetadata({ filename: "PROJECT.BUILDORA.JSON" });
    expect(result.valid).toBe(true);
  });

  it("accepts mixed-case extension", () => {
    const result = validateProjectFileMetadata({ filename: "Project.Buildora.JSON" });
    expect(result.valid).toBe(true);
  });

  it("accepts multi-dot filename", () => {
    const result = validateProjectFileMetadata({ filename: "my.backup.buildora.json" });
    expect(result.valid).toBe(true);
  });

  it("rejects unsupported extension", () => {
    const result = validateProjectFileMetadata({ filename: "project.zip" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("Unsupported");
    }
  });

  it("rejects extensionless filename", () => {
    const result = validateProjectFileMetadata({ filename: "project" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("no recognizable extension");
    }
  });

  it("rejects empty filename", () => {
    const result = validateProjectFileMetadata({ filename: "" });
    expect(result.valid).toBe(false);
  });

  it("rejects missing filename", () => {
    const result = validateProjectFileMetadata({});
    expect(result.valid).toBe(false);
  });
});

describe("File metadata — size validation", () => {
  it("accepts files within size limit", () => {
    const result = validateProjectFileMetadata({
      filename: "project.buildora.json",
      size: 1024,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects oversized files", () => {
    const result = validateProjectFileMetadata({
      filename: "project.buildora.json",
      size: 20 * 1024 * 1024, // 20 MB
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("too large");
    }
  });

  it("accepts custom max size", () => {
    const result = validateProjectFileMetadata(
      { filename: "project.buildora.json", size: 1024 * 1024 },
      { maxSizeBytes: 2 * 1024 * 1024 },
    );
    expect(result.valid).toBe(true);
  });

  it("rejects negative size", () => {
    const result = validateProjectFileMetadata({
      filename: "project.buildora.json",
      size: -1,
    });
    expect(result.valid).toBe(false);
  });

  it("accepts zero size (valid empty project)", () => {
    const result = validateProjectFileMetadata({
      filename: "project.buildora.json",
      size: 0,
    });
    expect(result.valid).toBe(true);
  });
});

describe("File metadata — MIME behavior", () => {
  it("does not reject based solely on MIME type", () => {
    const result = validateProjectFileMetadata({
      filename: "project.buildora.json",
      mimeType: "application/octet-stream",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts missing MIME type", () => {
    const result = validateProjectFileMetadata({
      filename: "project.buildora.json",
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Filename generation tests
// ---------------------------------------------------------------------------

describe("createProjectFilename", () => {
  it("sanitizes project name", () => {
    const name = createProjectFilename({ name: "My Cool Project!" });
    expect(name).toBe("my-cool-project.buildora.json");
  });

  it("uses fallback for empty name", () => {
    const name = createProjectFilename({ name: "" });
    expect(name).toBe("project.buildora.json");
  });

  it("handles Unicode project name", () => {
    const name = createProjectFilename({ name: "🚀 Rocket" });
    expect(name).toMatch(/\.buildora\.json$/);
    expect(name).not.toContain("..");
  });

  it("removes path traversal from name", () => {
    const name = createProjectFilename({ name: "../etc/passwd" });
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).toMatch(/\.buildora\.json$/);
  });

  it("produces bounded length", () => {
    const name = createProjectFilename({ name: "a".repeat(200) });
    expect(name.length).toBeLessThan(100);
    expect(name).toMatch(/\.buildora\.json$/);
  });
});

// ---------------------------------------------------------------------------
// Extension extraction tests
// ---------------------------------------------------------------------------

describe("getExtension", () => {
  it("extracts .json from standard filename", () => {
    expect(getExtension("project.json")).toBe(".json");
  });

  it("extracts last extension from multi-dot filename", () => {
    expect(getExtension("project.buildora.json")).toBe(".json");
  });

  it("returns empty string for extensionless filename", () => {
    expect(getExtension("project")).toBe("");
  });

  it("returns empty string for dotfile", () => {
    expect(getExtension(".gitignore")).toBe("");
  });

  it("preserves case of extension", () => {
    expect(getExtension("Project.JSON")).toBe(".JSON");
  });
});
