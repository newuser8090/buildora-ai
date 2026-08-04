// ---------------------------------------------------------------------------
// Guided section language — registry tests (Phase N, spec §25)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  getGuidedSectionLabel,
  getGuidedSectionExplanation,
  getGuidedSectionExample,
  getGuidedSynonyms,
  getGuidedCategory,
  getGuidedCategoryLabel,
  getSectionNameForMode,
  listGuidedSectionLanguage,
  resolveBeginnerSearch,
  GUIDED_BLOCK_CATEGORIES,
} from "../guided-section-language";

const ALL_SECTION_TYPES = [
  "header",
  "hero",
  "features",
  "pricing",
  "faq",
  "cta",
  "footer",
];

// Technical jargon that must never appear in guided labels (spec §2 list).
const JARGON = [
  "hero",
  "cta",
  "faq",
  "breakpoint",
  "padding",
  "margin",
  "flex",
  "grid",
  "component",
  "schema",
  "route",
  "metadata",
];

describe("guided section language", () => {
  it("gives every built-in section a guided label and explanation", () => {
    for (const type of ALL_SECTION_TYPES) {
      expect(getGuidedSectionLabel(type).length).toBeGreaterThan(0);
      expect(getGuidedSectionExplanation(type).length).toBeGreaterThan(0);
    }
  });

  it("gives every built-in section an example", () => {
    for (const type of ALL_SECTION_TYPES) {
      expect(getGuidedSectionExample(type).length).toBeGreaterThan(0);
    }
  });

  it("maps the expected friendly names", () => {
    expect(getGuidedSectionLabel("header")).toBe("Top navigation");
    expect(getGuidedSectionLabel("hero")).toBe("Main message");
    expect(getGuidedSectionLabel("features")).toBe("What you offer");
    expect(getGuidedSectionLabel("pricing")).toBe("Plans and pricing");
    expect(getGuidedSectionLabel("faq")).toBe("Common questions");
    expect(getGuidedSectionLabel("cta")).toBe("Action section");
    expect(getGuidedSectionLabel("footer")).toBe("Bottom information");
  });

  it("uses no technical jargon in guided labels", () => {
    for (const type of ALL_SECTION_TYPES) {
      const label = getGuidedSectionLabel(type).toLowerCase();
      for (const word of JARGON) {
        expect(label.includes(word)).toBe(false);
      }
    }
  });

  it("keeps conventional labels in standard and advanced modes", () => {
    expect(getSectionNameForMode("standard", "hero")).toBe("Hero");
    expect(getSectionNameForMode("advanced", "cta")).toBe("CTA");
    expect(getSectionNameForMode("standard", "faq")).toBe("FAQ");
  });

  it("uses guided labels only in guided mode", () => {
    expect(getSectionNameForMode("guided", "hero")).toBe("Main message");
    expect(getSectionNameForMode("guided", "footer")).toBe("Bottom information");
  });

  it("is safe for malformed/unknown section types", () => {
    expect(getGuidedSectionLabel("not-a-section")).toBe("Not-a-section");
    expect(getGuidedSectionExplanation("not-a-section")).toBe("");
    expect(getGuidedSectionExample("not-a-section")).toBe("");
    expect(getGuidedCategory("not-a-section")).toBe("explain");
    expect(getGuidedSynonyms("not-a-section")).toEqual([]);
    // Empty/malformed input never throws
    expect(getGuidedSectionLabel("")).toBe("");
    expect(getGuidedSectionExplanation(null as unknown as string)).toBe("");
  });

  it("assigns every category at least one section", () => {
    const assigned = new Set(
      ALL_SECTION_TYPES.map((t) => getGuidedCategory(t)),
    );
    for (const category of GUIDED_BLOCK_CATEGORIES) {
      expect(assigned.has(category)).toBe(true);
    }
    expect(getGuidedCategoryLabel("start")).toBe("Start");
  });

  it("lists entries deterministically", () => {
    const a = listGuidedSectionLanguage();
    const b = listGuidedSectionLanguage();
    expect(a.map((e) => e.type)).toEqual(b.map((e) => e.type));
    expect(a).toHaveLength(ALL_SECTION_TYPES.length);
  });

  it("does not mutate input and is deterministic", () => {
    const before = JSON.stringify(listGuidedSectionLanguage());
    listGuidedSectionLanguage();
    getGuidedSectionLabel("hero");
    expect(JSON.stringify(listGuidedSectionLanguage())).toBe(before);
  });
});

describe("resolveBeginnerSearch", () => {
  it("resolves beginner queries to section types", () => {
    expect(resolveBeginnerSearch("customer reviews").map((r) => r.type)).toContain("features");
    expect(resolveBeginnerSearch("menu").map((r) => r.type)).toContain("features");
    expect(resolveBeginnerSearch("contact").map((r) => r.type)).toContain("footer");
    expect(resolveBeginnerSearch("prices").map((r) => r.type)).toContain("pricing");
    expect(resolveBeginnerSearch("questions").map((r) => r.type)).toContain("faq");
    expect(resolveBeginnerSearch("top bar").map((r) => r.type)).toContain("header");
  });

  it("returns results ordered by relevance (deterministic)", () => {
    const a = resolveBeginnerSearch("contact");
    const b = resolveBeginnerSearch("contact");
    expect(a.map((r) => r.type)).toEqual(b.map((r) => r.type));
    for (let i = 1; i < a.length; i += 1) {
      expect(a[i - 1].score).toBeGreaterThanOrEqual(a[i].score);
    }
  });

  it("returns an empty list for empty or unmatched queries", () => {
    expect(resolveBeginnerSearch("")).toEqual([]);
    expect(resolveBeginnerSearch("zzz")).toEqual([]);
  });
});
