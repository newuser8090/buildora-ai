// ---------------------------------------------------------------------------
// Site settings — favicon/site icon validator tests (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  validateFaviconFile,
  canAssetBeFavicon,
  FAVICON_MIME_TYPES,
  FAVICON_MAX_SIZE_BYTES,
} from "../services/favicon-validator";

describe("validateFaviconFile", () => {
  it("accepts safe image MIME types", () => {
    for (const type of FAVICON_MIME_TYPES) {
      expect(validateFaviconFile({ type, size: 100 }).valid).toBe(true);
    }
  });

  it("rejects unsafe MIME types", () => {
    const result = validateFaviconFile({ type: "text/html", size: 100 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("PNG, JPG, WebP, or SVG");
  });

  it("rejects oversized files", () => {
    const result = validateFaviconFile({
      type: "image/png",
      size: FAVICON_MAX_SIZE_BYTES + 1,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("5 MB");
  });

  it("accepts files exactly at the size limit", () => {
    expect(
      validateFaviconFile({ type: "image/png", size: FAVICON_MAX_SIZE_BYTES }).valid,
    ).toBe(true);
  });
});

describe("canAssetBeFavicon", () => {
  it("returns true only for allowed image MIME types", () => {
    expect(canAssetBeFavicon("image/png")).toBe(true);
    expect(canAssetBeFavicon("image/svg+xml")).toBe(true);
    expect(canAssetBeFavicon("image/gif")).toBe(false);
    expect(canAssetBeFavicon("application/pdf")).toBe(false);
  });
});
