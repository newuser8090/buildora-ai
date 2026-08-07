// ---------------------------------------------------------------------------
// SEO preview — derivation tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  deriveGooglePreview,
  deriveSocialPreview,
  deriveFaviconGuidance,
} from "../engine/seo-preview";
import type { Asset } from "@/features/assets/types";

const ASSETS: Asset[] = [
  {
    id: "img-1",
    name: "share.png",
    type: "image",
    mimeType: "image/png",
    extension: ".png",
    size: 1000,
    width: 1200,
    height: 630,
    source: { type: "data-url", value: "data:image/png;base64,iVBORw0KGgo=" },
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("deriveGooglePreview", () => {
  it("falls back to project name when no settings", () => {
    const preview = deriveGooglePreview(undefined, "My Site", "https://x.example");
    expect(preview.title).toBe("My Site");
    expect(preview.usingFallback).toBe(true);
    expect(preview.coaching.length).toBeGreaterThan(0);
  });

  it("uses the SEO title and description when provided", () => {
    const preview = deriveGooglePreview(
      {
        siteName: "Acme",
        seo: { title: "Acme Bakery — Fresh Bread", description: "Best bread in town" },
      },
      "My Site",
      "https://x.example",
    );
    expect(preview.title).toBe("Acme Bakery — Fresh Bread");
    expect(preview.description).toBe("Best bread in town");
    expect(preview.usingFallback).toBe(false);
    expect(preview.coaching).toEqual([]);
  });

  it("coaches when the title may get cut off", () => {
    const preview = deriveGooglePreview(
      { siteName: "A", seo: { title: "x".repeat(70) } },
      "P",
      "https://x.example",
    );
    expect(preview.coaching.some((c) => c.includes("cut off"))).toBe(true);
  });

  it("coaches when the description is long", () => {
    const preview = deriveGooglePreview(
      { siteName: "A", seo: { title: "T", description: "y".repeat(200) } },
      "P",
      "https://x.example",
    );
    expect(preview.coaching.some((c) => c.includes("a little long"))).toBe(true);
  });

  it("is deterministic", () => {
    const settings = { siteName: "A", seo: { title: "T", description: "D" } };
    const a = deriveGooglePreview(settings, "P", "u");
    const b = deriveGooglePreview(settings, "P", "u");
    expect(a).toEqual(b);
  });
});

describe("deriveSocialPreview", () => {
  it("resolves the share image from project assets", () => {
    const preview = deriveSocialPreview(
      {
        siteName: "Acme",
        social: { title: "Share", description: "Desc", image: { assetId: "img-1" } },
      },
      "P",
      ASSETS,
    );
    expect(preview.imageSrc).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(preview.siteName).toBe("Acme");
    expect(preview.usingFallback).toBe(false);
  });

  it("falls back to SEO title when no social title", () => {
    const preview = deriveSocialPreview(
      {
        siteName: "Acme",
        seo: { title: "SEO Title" },
        social: { image: { assetId: "img-1" } },
      },
      "P",
      ASSETS,
    );
    expect(preview.title).toBe("SEO Title");
  });

  it("coaches to add an image when none is set", () => {
    const preview = deriveSocialPreview({ siteName: "Acme" }, "P", ASSETS);
    expect(preview.coaching.some((c) => c.includes("Add an image"))).toBe(true);
  });

  it("flags a missing asset id as needing an image", () => {
    const preview = deriveSocialPreview(
      { siteName: "Acme", social: { image: { assetId: "missing" } } },
      "P",
      ASSETS,
    );
    expect(preview.imageSrc).toBeUndefined();
    expect(preview.coaching.some((c) => c.includes("Add an image"))).toBe(true);
  });
});

describe("deriveFaviconGuidance", () => {
  it("coaches when no favicon is set", () => {
    const g = deriveFaviconGuidance(undefined, ASSETS);
    expect(g.valid).toBe(false);
    expect(g.coaching.length).toBeGreaterThan(0);
  });

  it("accepts a square favicon asset", () => {
    const square: Asset = { ...ASSETS[0], width: 512, height: 512 };
    const g = deriveFaviconGuidance(
      { siteName: "X", favicon: { assetId: "img-1" } },
      [square],
    );
    expect(g.valid).toBe(true);
    expect(g.square).toBe(true);
  });

  it("coaches non-square favicons", () => {
    const wide: Asset = { ...ASSETS[0], width: 1200, height: 630 };
    const g = deriveFaviconGuidance(
      { siteName: "X", favicon: { assetId: "img-1" } },
      [wide],
    );
    expect(g.square).toBe(false);
    expect(g.coaching.some((c) => c.includes("Square images work best"))).toBe(true);
  });
});
