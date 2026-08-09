// ---------------------------------------------------------------------------
// Share Links & Review Experience (Phase P12) — projection sanitizer tests
//
// Security-critical: the projection is the ONLY representation of a project
// ever stored server-side for viewers.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import { MOCK_PROJECT } from "@/features/editor/mock/mock-project";
import {
  buildShareProjection,
  parseProjection,
  serializeProjection,
} from "../projection/sanitize-share-projection";
import { PROJECTION_MAX_BYTES } from "../constants";

function makeProject(): Project {
  return JSON.parse(JSON.stringify(MOCK_PROJECT)) as Project;
}

describe("buildShareProjection", () => {
  it("keeps name, theme, pages (valid sections), siteSettings and assets", () => {
    const project = makeProject();
    const result = buildShareProjection(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.projection;
    expect(p.name).toBe(project.name);
    expect(p.theme).toEqual(project.theme);
    expect(p.pages.length).toBe(project.pages.length);
    expect(p.pages[0].sections.length).toBe(project.pages[0].sections.length);
    expect(p.assets).toEqual(project.assets);
    if (project.siteSettings) expect(p.siteSettings).toEqual(project.siteSettings);
  });

  it("blanks the canonical project id and strips timestamps", () => {
    const project = makeProject();
    const result = buildShareProjection(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.id).toBe("");
    expect((result.projection as Record<string, unknown>).createdAt).toBeUndefined();
    expect((result.projection as Record<string, unknown>).updatedAt).toBeUndefined();
  });

  it("drops invalid sections and invalid pages silently", () => {
    const project = makeProject();
    const badSection = {
      id: "s-bad",
      type: "hero",
      order: 99,
      visible: true,
      props: { headline: 12345 }, // wrong type → schema rejects
      styles: {},
    };
    project.pages[0].sections.push(badSection as never);
    project.pages.push({ id: "bad-page", title: "X", slug: "/x", sections: "nope" } as never);

    const result = buildShareProjection(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sections = result.projection.pages[0].sections;
    expect(sections.some((s) => s.id === "s-bad")).toBe(false);
    expect(result.projection.pages.some((p) => p.id === "bad-page")).toBe(false);
  });

  it("removes prototype-pollution keys from nested objects", () => {
    const project = makeProject();
    (project.pages[0].sections[0] as unknown as Record<string, unknown>).props = Object.defineProperty(
      {},
      "__proto__",
      { value: { evil: true }, enumerable: true, writable: true },
    ) as never;
    const result = buildShareProjection(project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.projection);
    expect(serialized).not.toContain("__proto__");
    expect(serialized).not.toContain("evil");
  });

  it("rejects an oversized projection with PROJECTION_TOO_LARGE", () => {
    const project = makeProject();
    project.assets.push({
      id: "huge",
      name: "huge.png",
      type: "image",
      mimeType: "image/png",
      extension: ".png",
      size: PROJECTION_MAX_BYTES,
      source: { type: "data-url", value: `data:image/png;base64,${"A".repeat(PROJECTION_MAX_BYTES)}` },
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const result = buildShareProjection(project);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("PROJECTION_TOO_LARGE");
  });
});

describe("serialize / parse round-trip", () => {
  it("round-trips a projection", () => {
    const result = buildShareProjection(makeProject());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseProjection(serializeProjection(result.projection));
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe(result.projection.name);
    expect(parsed?.id).toBe("");
  });

  it("rejects malformed / non-object payloads", () => {
    expect(parseProjection(null)).toBeNull();
    expect(parseProjection("")).toBeNull();
    expect(parseProjection("{not json")).toBeNull();
    expect(parseProjection(JSON.stringify({ name: 42 }))).toBeNull();
    expect(parseProjection(JSON.stringify({ name: "x", pages: "no" }))).toBeNull();
  });

  it("strips pollution keys on parse (defense-in-depth)", () => {
    const raw = JSON.stringify({
      name: "Site",
      theme: { palette: {} },
      pages: [],
      assets: [],
      __proto__: { evil: true },
    });
    const parsed = parseProjection(raw);
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("__proto__");
  });
});
