// ---------------------------------------------------------------------------
// section-labels — tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  getSectionLabel,
  getSectionTypeLabel,
  SECTION_TYPE_LABELS,
} from "../section-labels";
import type { BaseSection } from "@/types/section";

function section(type: string, props: Record<string, unknown>): Pick<BaseSection, "type" | "props"> {
  return { type, props };
}

describe("getSectionLabel", () => {
  it("uses logoText for headers", () => {
    expect(getSectionLabel(section("header", { logoText: "Acme Co" }))).toBe("Acme Co");
  });

  it("uses headline for heroes", () => {
    expect(getSectionLabel(section("hero", { headline: "Build great things" }))).toBe(
      "Build great things",
    );
  });

  it("uses title for features", () => {
    expect(getSectionLabel(section("features", { title: "Our Features" }))).toBe("Our Features");
  });

  it("uses title for pricing", () => {
    expect(getSectionLabel(section("pricing", { title: "Plans" }))).toBe("Plans");
  });

  it("uses title for FAQ", () => {
    expect(getSectionLabel(section("faq", { title: "Questions" }))).toBe("Questions");
  });

  it("uses headline for CTA", () => {
    expect(getSectionLabel(section("cta", { headline: "Get started" }))).toBe("Get started");
  });

  it("uses copyright text for footers", () => {
    expect(getSectionLabel(section("footer", { text: "© 2026 Acme" }))).toBe("© 2026 Acme");
  });

  it("falls back to the type label when props are missing", () => {
    expect(getSectionLabel(section("hero", {}))).toBe("Hero");
    expect(getSectionLabel(section("footer", {}))).toBe("Footer");
    expect(getSectionLabel(section("header", { logoText: "" }))).toBe("Header");
  });

  it("falls back to the type label for malformed props", () => {
    expect(getSectionLabel(section("hero", { headline: 123 as never }))).toBe("Hero");
    expect(getSectionLabel(section("features", { title: null as never }))).toBe("Features");
  });

  it("handles a completely malformed props object", () => {
    expect(getSectionLabel(section("hero", null as never))).toBe("Hero");
  });

  it("falls back for unknown section types", () => {
    expect(getSectionLabel(section("bogus", { title: "X" }))).toBe("Bogus");
  });

  it("caps long labels with an ellipsis", () => {
    const long = "A".repeat(200);
    const label = getSectionLabel(section("hero", { headline: long }));
    expect(label.length).toBeLessThanOrEqual(48);
    expect(label.endsWith("…")).toBe(true);
  });

  it("collapses internal whitespace", () => {
    expect(getSectionLabel(section("hero", { headline: "Hello   \n  World" }))).toBe("Hello World");
  });

  it("is deterministic and does not mutate props", () => {
    const props = { headline: "Stable" };
    const a = getSectionLabel(section("hero", props));
    const b = getSectionLabel(section("hero", props));
    expect(a).toBe("Stable");
    expect(b).toBe("Stable");
    expect(props).toEqual({ headline: "Stable" });
  });
});

describe("getSectionTypeLabel", () => {
  it("returns friendly labels for known types", () => {
    expect(getSectionTypeLabel("header")).toBe("Header");
    expect(getSectionTypeLabel("faq")).toBe("FAQ");
    expect(getSectionTypeLabel("cta")).toBe("CTA");
  });

  it("title-cases unknown types", () => {
    expect(getSectionTypeLabel("gallery")).toBe("Gallery");
  });

  it("has an entry for every known section type", () => {
    expect(Object.keys(SECTION_TYPE_LABELS).sort()).toEqual(
      ["header", "hero", "features", "pricing", "faq", "cta", "footer"].sort(),
    );
  });
});
