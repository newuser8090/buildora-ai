import { describe, it, expect } from "vitest";
import {
  validateFile,
  getCanonicalExtension,
  getMimeForExtension,
  MIME_TO_EXTENSION,
  EXTENSION_TO_MIME,
} from "../services/file-validator";

// ---------------------------------------------------------------------------
// Mapping integrity
// ---------------------------------------------------------------------------

describe("File validator — mapping integrity", () => {
  it("every MIME_TO_EXTENSION entry has a reverse in EXTENSION_TO_MIME", () => {
    for (const [mime, ext] of Object.entries(MIME_TO_EXTENSION)) {
      expect(EXTENSION_TO_MIME[ext]).toBe(mime);
    }
  });

  it("every EXTENSION_TO_MIME entry has a forward mapping (.jpeg is an alias for .jpg)", () => {
    for (const [ext, mime] of Object.entries(EXTENSION_TO_MIME)) {
      // .jpeg is a valid alias for .jpg; MIME_TO_EXTENSION stores .jpg as canonical
      if (ext === ".jpeg") {
        expect(MIME_TO_EXTENSION[mime]).toBe(".jpg");
      } else {
        expect(MIME_TO_EXTENSION[mime]).toBe(ext);
      }
    }
  });

  it("getCanonicalExtension returns correct extensions", () => {
    expect(getCanonicalExtension("image/png")).toBe(".png");
    expect(getCanonicalExtension("image/jpeg")).toBe(".jpg");
    expect(getCanonicalExtension("image/webp")).toBe(".webp");
    expect(getCanonicalExtension("image/svg+xml")).toBe(".svg");
  });

  it("getCanonicalExtension returns undefined for unknown MIME", () => {
    expect(getCanonicalExtension("image/gif")).toBeUndefined();
  });

  it("getMimeForExtension is case-insensitive", () => {
    expect(getMimeForExtension(".PNG")).toBe("image/png");
    expect(getMimeForExtension(".JPG")).toBe("image/jpeg");
    expect(getMimeForExtension(".WebP")).toBe("image/webp");
    expect(getMimeForExtension(".SVG")).toBe("image/svg+xml");
  });

  it("getMimeForExtension handles extensions without leading dot", () => {
    expect(getMimeForExtension("png")).toBe("image/png");
  });
});

// ---------------------------------------------------------------------------
// Valid files
// ---------------------------------------------------------------------------

describe("File validator — valid files", () => {
  it("accepts PNG with correct MIME and extension", () => {
    const result = validateFile({
      name: "logo.png",
      type: "image/png",
      size: 1024 * 500, // 500 KB
    });
    expect(result.valid).toBe(true);
  });

  it("accepts JPEG with .jpg extension", () => {
    const result = validateFile({
      name: "photo.jpg",
      type: "image/jpeg",
      size: 1024 * 1024, // 1 MB
    });
    expect(result.valid).toBe(true);
  });

  it("accepts JPEG with .jpeg extension", () => {
    const result = validateFile({
      name: "photo.jpeg",
      type: "image/jpeg",
      size: 1024 * 1024,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts WebP with correct MIME and extension", () => {
    const result = validateFile({
      name: "image.webp",
      type: "image/webp",
      size: 1024 * 300,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts SVG with correct MIME and extension", () => {
    const result = validateFile({
      name: "icon.svg",
      type: "image/svg+xml",
      size: 2048,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts uppercase extensions", () => {
    const result = validateFile({
      name: "LOGO.PNG",
      type: "image/png",
      size: 1024,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts mixed-case extensions", () => {
    const result = validateFile({
      name: "Image.WebP",
      type: "image/webp",
      size: 1024,
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Size validation
// ---------------------------------------------------------------------------

describe("File validator — size validation", () => {
  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

  it("accepts a file exactly at the limit", () => {
    const result = validateFile({
      name: "exact-limit.png",
      type: "image/png",
      size: MAX_BYTES,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a file above the limit", () => {
    const result = validateFile({
      name: "too-large.png",
      type: "image/png",
      size: MAX_BYTES + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("FILE_TOO_LARGE");
    expect(result.error).toContain("5 MB");
  });

  it("rejects a significantly oversized file", () => {
    const result = validateFile({
      name: "huge.png",
      type: "image/png",
      size: 50 * 1024 * 1024, // 50 MB
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("FILE_TOO_LARGE");
  });

  it("rejects empty file", () => {
    const result = validateFile({
      name: "empty.png",
      type: "image/png",
      size: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("FILE_EMPTY");
    expect(result.error).toContain("empty");
  });
});

// ---------------------------------------------------------------------------
// MIME type validation
// ---------------------------------------------------------------------------

describe("File validator — MIME type validation", () => {
  it("rejects unsupported MIME type", () => {
    const result = validateFile({
      name: "file.gif",
      type: "image/gif",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_MIME_TYPE");
  });

  it("rejects unsupported MIME with valid extension", () => {
    const result = validateFile({
      name: "file.png",
      type: "application/octet-stream",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_MIME_TYPE");
  });

  it("rejects PDF", () => {
    const result = validateFile({
      name: "file.pdf",
      type: "application/pdf",
      size: 1024,
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extension validation
// ---------------------------------------------------------------------------

describe("File validator — extension validation", () => {
  it("rejects unsupported extension", () => {
    const result = validateFile({
      name: "file.gif",
      type: "image/gif",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_MIME_TYPE");
  });

  it("rejects file with no extension", () => {
    const result = validateFile({
      name: "filewithoutExtension",
      type: "image/png",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_EXTENSION");
  });

  it("rejects file with unknown extension", () => {
    const result = validateFile({
      name: "file.exe",
      type: "image/png",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_EXTENSION");
  });
});

// ---------------------------------------------------------------------------
// MIME/extension mismatch
// ---------------------------------------------------------------------------

describe("File validator — MIME/extension mismatch", () => {
  it("rejects PNG extension with JPEG MIME", () => {
    const result = validateFile({
      name: "image.png",
      type: "image/jpeg",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MIME_EXTENSION_MISMATCH");
  });

  it("rejects JPG extension with PNG MIME", () => {
    const result = validateFile({
      name: "image.jpg",
      type: "image/png",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MIME_EXTENSION_MISMATCH");
  });

  it("rejects WebP extension with SVG MIME", () => {
    const result = validateFile({
      name: "image.webp",
      type: "image/svg+xml",
      size: 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("MIME_EXTENSION_MISMATCH");
  });
});
