// @vitest-environment node

import { describe, it, expect, beforeEach } from "vitest";
import { resolveAsset, resetWarningCache } from "../services/asset-resolver";
import type { Asset, AssetRef } from "../types";

function makeAsset(overrides?: Partial<Asset>): Asset {
  return {
    id: "asset-1",
    name: "logo.png",
    type: "logo",
    mimeType: "image/png",
    extension: ".png",
    size: 1024,
    source: { type: "data-url", value: "data:image/png;base64,iVBOR" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const assets = [
  makeAsset({ id: "a1", name: "logo.png", type: "logo" }),
  makeAsset({ id: "a2", name: "hero.jpg", type: "image", width: 1200, height: 800 }),
  makeAsset({ id: "a3", name: "icon.svg", type: "icon", mimeType: "image/svg+xml" }),
];

describe("resolveAsset — shared resolver", () => {
  beforeEach(() => {
    resetWarningCache();
  });

  it("returns empty result for undefined ref", () => {
    const result = resolveAsset(undefined, assets);
    expect(result.src).toBeUndefined();
    expect(result.missing).toBe(false);
    expect(result.alt).toBe("");
    expect(result.decorative).toBe(false);
  });

  it("resolves valid AssetRef to src and alt", () => {
    const ref: AssetRef = { assetId: "a1" };
    const result = resolveAsset(ref, assets);
    expect(result.src).toBe("data:image/png;base64,iVBOR");
    expect(result.alt).toBe("logo.png");
    expect(result.missing).toBe(false);
    expect(result.invalid).toBe(false);
    expect(result.asset).toBeDefined();
  });

  it("uses AssetRef.altText over asset name when provided", () => {
    const ref: AssetRef = { assetId: "a2", altText: "Custom alt text" };
    const result = resolveAsset(ref, assets);
    expect(result.alt).toBe("Custom alt text");
  });

  it("marks missing asset and logs warning", () => {
    const ref: AssetRef = { assetId: "nonexistent" };
    const result = resolveAsset(ref, assets);
    expect(result.missing).toBe(true);
    expect(result.src).toBeUndefined();
    expect(result.asset).toBeUndefined();
  });

  it("marks missing asset with altText fallback", () => {
    const ref: AssetRef = { assetId: "nonexistent", altText: "My alt" };
    const result = resolveAsset(ref, assets);
    expect(result.missing).toBe(true);
    expect(result.alt).toBe("My alt");
    expect(result.decorative).toBe(false);
  });

  it("missing asset without altText is decorative", () => {
    const ref: AssetRef = { assetId: "nonexistent" };
    const result = resolveAsset(ref, assets);
    expect(result.missing).toBe(true);
    expect(result.alt).toBe("");
    expect(result.decorative).toBe(true);
  });

  it("handles malformed data URL source as invalid", () => {
    const badAsset = makeAsset({ id: "bad", name: "broken", source: { type: "data-url", value: "" } });
    const ref: AssetRef = { assetId: "bad" };
    const result = resolveAsset(ref, [badAsset]);
    expect(result.invalid).toBe(true);
    expect(result.src).toBeUndefined();
  });

  it("handles unsupported future source type as invalid", () => {
    const futureAsset = makeAsset({
      id: "fut",
      name: "future",
      source: { type: "s3" as "data-url", value: "https://..." },
    });
    const ref: AssetRef = { assetId: "fut" };
    const result = resolveAsset(ref, [futureAsset]);
    expect(result.invalid).toBe(true);
    expect(result.src).toBeUndefined();
  });

  it("decorative is false when asset has no altText but has name", () => {
    const ref: AssetRef = { assetId: "a1" };
    const result = resolveAsset(ref, assets);
    expect(result.decorative).toBe(false);
    expect(result.alt).toBe("logo.png");
  });

  it("decorative is false when AssetRef has altText even if missing", () => {
    const ref: AssetRef = { assetId: "nonexistent", altText: "desc" };
    const result = resolveAsset(ref, assets);
    expect(result.decorative).toBe(false);
  });
});

describe("resolveAsset — legacy compatibility", () => {
  beforeEach(() => resetWarningCache());

  it("works with empty assets array", () => {
    const ref: AssetRef = { assetId: "a1" };
    const result = resolveAsset(ref, []);
    expect(result.missing).toBe(true);
    expect(result.src).toBeUndefined();
  });

  it("does not crash on null ref", () => {
    const result = resolveAsset(null as unknown as undefined, assets);
    expect(result.src).toBeUndefined();
    expect(result.missing).toBe(false);
  });

  it("returns correct values for SVG assets", () => {
    const ref: AssetRef = { assetId: "a3" };
    const result = resolveAsset(ref, assets);
    expect(result.src).toBeDefined();
    expect(result.asset?.mimeType).toBe("image/svg+xml");
  });
});
