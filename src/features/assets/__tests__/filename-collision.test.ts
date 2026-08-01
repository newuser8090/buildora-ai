import { describe, it, expect } from "vitest";
import { sanitiseFilename, normalizeExtension, buildFilenameMap } from "../utils/filename-collision";

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

describe("Filename collision — sanitiseFilename", () => {
  it("preserves a normal filename with extension", () => {
    expect(sanitiseFilename("logo.png")).toBe("logo.png");
  });

  it("preserves filenames with hyphens and underscores", () => {
    expect(sanitiseFilename("hero-bg_image.png")).toBe("hero-bg_image.png");
  });

  it("preserves filenames with spaces", () => {
    expect(sanitiseFilename("my image.png")).toBe("my image.png");
  });

  it("removes path traversal segments", () => {
    const result = sanitiseFilename("../etc/passwd.png");
    expect(result).toBe("etc-passwd.png");
    expect(result).not.toContain("..");
  });

  it("removes directory separators", () => {
    const result = sanitiseFilename("subdir/hero.png");
    expect(result).not.toContain("/");
    expect(result).toBe("subdir-hero.png");
  });

  it("removes backslash directory separators", () => {
    const result = sanitiseFilename("subdir\\hero.png");
    expect(result).not.toContain("\\");
    expect(result).toBe("subdir-hero.png");
  });

  it("removes unsafe special characters", () => {
    const result = sanitiseFilename("hello<>:\"|?*.png");
    // Only the extension dot is preserved; others are removed
    expect(result).toBe("hello.png");
  });

  it("normalizes extension to lowercase", () => {
    expect(sanitiseFilename("Logo.PNG")).toBe("Logo.png");
    expect(sanitiseFilename("Image.JPEG")).toBe("Image.jpeg");
    expect(sanitiseFilename("icon.SVG")).toBe("icon.svg");
  });

  it("returns 'file' for an empty string", () => {
    expect(sanitiseFilename("")).toBe("file");
  });

  it("returns 'file' for a path-only string", () => {
    const result = sanitiseFilename("../../../");
    expect(result).toBe("file");
  });

  it("handles filenames with multiple dots", () => {
    expect(sanitiseFilename("image.test.png")).toBe("image.test.png");
    expect(sanitiseFilename("my.file.name.svg")).toBe("my.file.name.svg");
  });

  it("handles filenames with no extension", () => {
    expect(sanitiseFilename("readme")).toBe("readme");
  });

  it("handles filenames with only an extension", () => {
    expect(sanitiseFilename(".png")).toBe("file.png");
  });

  it("truncates long filenames", () => {
    const longName = "a".repeat(100) + ".png";
    expect(sanitiseFilename(longName).length).toBeLessThanOrEqual(68); // 64 stem + 4 ext
  });

  it("collapses multiple consecutive hyphens", () => {
    expect(sanitiseFilename("a---b---c.png")).toBe("a-b-c.png");
  });

  it("removes leading hyphens", () => {
    expect(sanitiseFilename("---logo.png")).toBe("logo.png");
  });

  it("removes trailing hyphens", () => {
    expect(sanitiseFilename("logo---.png")).toBe("logo.png");
  });
});

// ---------------------------------------------------------------------------
// Extension normalisation
// ---------------------------------------------------------------------------

describe("Filename collision — normalizeExtension", () => {
  it("lowercases the extension", () => {
    expect(normalizeExtension("Logo.PNG")).toBe("Logo.png");
    expect(normalizeExtension("IMAGE.JPEG")).toBe("IMAGE.jpeg");
    expect(normalizeExtension("icon.SVG")).toBe("icon.svg");
    expect(normalizeExtension("photo.JPG")).toBe("photo.jpg");
  });

  it("preserves the stem case", () => {
    expect(normalizeExtension("My Logo.PNG")).toBe("My Logo.png");
  });

  it("handles filenames without extension", () => {
    expect(normalizeExtension("readme")).toBe("readme");
  });

  it("handles multiple dots correctly", () => {
    expect(normalizeExtension("image.test.PNG")).toBe("image.test.png");
  });

  it("handles empty string", () => {
    expect(normalizeExtension("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Collision handling
// ---------------------------------------------------------------------------

describe("Filename collision — buildFilenameMap", () => {
  it("returns unique filenames when there are no collisions", () => {
    const assets = [
      { id: "a1", name: "logo.png" },
      { id: "a2", name: "hero.png" },
      { id: "a3", name: "bg.svg" },
    ];

    const map = buildFilenameMap(assets);
    expect(map.get("a1")).toBe("logo.png");
    expect(map.get("a2")).toBe("hero.png");
    expect(map.get("a3")).toBe("bg.svg");
    expect(map.size).toBe(3);
  });

  it("produces deterministic numbered variants for collisions", () => {
    const assets = [
      { id: "a1", name: "logo.png" },
      { id: "a2", name: "logo.png" },
      { id: "a3", name: "logo.png" },
    ];

    const map = buildFilenameMap(assets);
    expect(map.get("a1")).toBe("logo.png");
    expect(map.get("a2")).toBe("logo-2.png");
    expect(map.get("a3")).toBe("logo-3.png");
  });

  it("handles collisions with multiple dots", () => {
    const assets = [
      { id: "a1", name: "image.test.png" },
      { id: "a2", name: "image.test.png" },
    ];

    const map = buildFilenameMap(assets);
    expect(map.get("a1")).toBe("image.test.png");
    expect(map.get("a2")).toBe("image.test-2.png");
  });

  it("handles collisions with different extension case", () => {
    const assets = [
      { id: "a1", name: "logo.PNG" },
      { id: "a2", name: "logo.png" },
    ];

    const map = buildFilenameMap(assets);
    // After normalizeExtension: both become "logo.png"
    // First → "logo.png", second → "logo-2.png"
    expect(map.get("a1")).toBe("logo.png");
    expect(map.get("a2")).toBe("logo-2.png");
  });

  it("handles mixed extensions (same stem, different ext)", () => {
    const assets = [
      { id: "a1", name: "logo.png" },
      { id: "a2", name: "logo.jpg" },
    ];

    const map = buildFilenameMap(assets);
    expect(map.get("a1")).toBe("logo.png");
    expect(map.get("a2")).toBe("logo.jpg");
  });

  it("sanitizes filenames during mapping", () => {
    const assets = [
      { id: "a1", name: "../images/logo.png" },
      { id: "a2", name: "normal.png" },
    ];

    const map = buildFilenameMap(assets);
    expect(map.get("a1")).toBe("images-logo.png");
    expect(map.get("a2")).toBe("normal.png");
  });

  it("handles empty assets array", () => {
    const map = buildFilenameMap([]);
    expect(map.size).toBe(0);
  });

  it("produces unique output values for all entries", () => {
    const assets = [
      { id: "a1", name: "same.png" },
      { id: "a2", name: "same.png" },
      { id: "a3", name: "same.png" },
      { id: "a4", name: "same.png" },
      { id: "a5", name: "same.png" },
    ];

    const map = buildFilenameMap(assets);
    const values = Array.from(map.values());
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    expect(values).toEqual([
      "same.png",
      "same-2.png",
      "same-3.png",
      "same-4.png",
      "same-5.png",
    ]);
  });
});
