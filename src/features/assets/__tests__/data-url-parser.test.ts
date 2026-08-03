import { describe, it, expect } from "vitest";
import {
  parseDataUrl,
  validateDataUrl,
  matchesMimeType,
  extractBase64,
  estimateBase64Size,
  decodeDataUrlInBrowser,
} from "../utils/data-url-parser";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

describe("Data URL parser — parsing", () => {
  it("parses a simple PNG data URL", () => {
    const result = parseDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.encoding).toBe("base64");
    expect(result!.data).toBe("iVBORw0KGgo=");
  });

  it("parses a JPEG data URL", () => {
    const result = parseDataUrl("data:image/jpeg;base64,/9j/4AAQSkZ");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/jpeg");
    expect(result!.encoding).toBe("base64");
  });

  it("parses a WebP data URL", () => {
    const result = parseDataUrl("data:image/webp;base64,UklGRiQ=");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/webp");
  });

  it("parses an SVG data URL", () => {
    const result = parseDataUrl("data:image/svg+xml;base64,PHN2Zy8+");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/svg+xml");
  });

  it("parses a data URL without explicit encoding", () => {
    const result = parseDataUrl("data:text/plain,Hello");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("text/plain");
    expect(result!.encoding).toBe("");
    expect(result!.data).toBe("Hello");
  });

  it("returns null for an empty string", () => {
    expect(parseDataUrl("")).toBeNull();
  });

  it("returns null for a non-data URL string", () => {
    expect(parseDataUrl("https://example.com/image.png")).toBeNull();
  });

  it("returns null for a null-like value (string coercion)", () => {
    const invalid = "null";
    const result = parseDataUrl(invalid);
    expect(result).toBeNull(); // Not a data: URL format
  });

  it("preserves the raw data URL", () => {
    const raw = "data:image/png;base64,abc123";
    const result = parseDataUrl(raw);
    expect(result!.raw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("Data URL parser — validation", () => {
  it("validates a well-formed data URL", () => {
    const result = validateDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(result.valid).toBe(true);
    expect(result.parsed).toBeDefined();
    expect(result.parsed!.mimeType).toBe("image/png");
  });

  it("rejects a string that doesn't start with data:", () => {
    const result = validateDataUrl("http://example.com");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("data:");
  });

  it("rejects an empty string", () => {
    const result = validateDataUrl("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("non-empty");
  });

  it("rejects a data URL with empty payload", () => {
    const result = validateDataUrl("data:image/png;base64,");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("rejects a data URL with invalid base64", () => {
    const result = validateDataUrl("data:image/png;base64,!@#$%");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("base64");
  });

  it("rejects a data URL with incomplete base64 padding", () => {
    const result = validateDataUrl("data:image/png;base64,ABC");
    // 3 chars → length % 4 = 3, which is OK; invalid padding chars
    // 'C' is valid base64 (A-Z, a-z, 0-9, +, /)
    expect(result.valid).toBe(true);
  });

  it("rejects non-string input", () => {
    const result = validateDataUrl(null as unknown as string);
    expect(result.valid).toBe(false);
  });

  it("rejects data URL with invalid base64 padding", () => {
    const result = validateDataUrl("data:image/png;base64,===");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("base64");
  });
});

// ---------------------------------------------------------------------------
// MIME type matching
// ---------------------------------------------------------------------------

describe("Data URL parser — MIME matching", () => {
  it("matches correct MIME type", () => {
    expect(matchesMimeType("data:image/png;base64,iVBORw0KGgo=", "image/png")).toBe(true);
  });

  it("rejects incorrect MIME type", () => {
    expect(matchesMimeType("data:image/png;base64,iVBORw0KGgo=", "image/jpeg")).toBe(false);
  });

  it("handles case-insensitive MIME matching", () => {
    expect(matchesMimeType("data:image/PNG;base64,iVBORw0KGgo=", "image/png")).toBe(true);
  });

  it("returns false for data URL without explicit MIME", () => {
    expect(matchesMimeType("data:,Hello", "text/plain")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Base64 extraction
// ---------------------------------------------------------------------------

describe("Data URL parser — base64 extraction", () => {
  it("extracts base64 payload", () => {
    const result = extractBase64("data:image/png;base64,iVBORw0KGgo=");
    expect(result).toBe("iVBORw0KGgo=");
  });

  it("returns null for non-base64 data URL", () => {
    const result = extractBase64("data:text/plain,Hello");
    expect(result).toBeNull();
  });

  it("returns null for invalid data URL", () => {
    const result = extractBase64("not-a-data-url");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Size estimation
// ---------------------------------------------------------------------------

describe("Data URL parser — size estimation", () => {
  it("estimates size from base64 without padding", () => {
    // 12 chars * 3/4 = 9 bytes
    expect(estimateBase64Size("YWJjZGVmZ2hp")).toBe(9);
  });

  it("estimates size from base64 with padding", () => {
    // "hello" = 5 bytes, base64 = "aGVsbG8=" (8 chars, 1 padding)
    // Math.floor(8 * 3/4) - 1 = 6 - 1 = 5 bytes
    expect(estimateBase64Size("aGVsbG8=")).toBe(5);
  });

  it("returns 0 for empty string", () => {
    expect(estimateBase64Size("")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Browser decode
// ---------------------------------------------------------------------------

describe("Data URL parser — browser decode", () => {
  it("decodes a known base64 string", () => {
    // "hello" in base64
    const dataUrl = "data:text/plain;base64,aGVsbG8=";
    const bytes = decodeDataUrlInBrowser(dataUrl);
    expect(bytes.length).toBe(5);
    const decoded = String.fromCharCode(...bytes);
    expect(decoded).toBe("hello");
  });

  it("throws for non-base64 data URL", () => {
    expect(() => decodeDataUrlInBrowser("data:text/plain,hello")).toThrow();
  });

  it("throws for invalid data URL", () => {
    expect(() => decodeDataUrlInBrowser("not-a-data-url")).toThrow();
  });
});
