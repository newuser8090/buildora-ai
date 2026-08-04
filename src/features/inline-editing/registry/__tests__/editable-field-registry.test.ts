// ---------------------------------------------------------------------------
// Editable field registry tests (Phase M spec §26)
//   - every supported section type
//   - every safe field
//   - nested array fields
//   - no href / AssetRef / price paths
//   - stable descriptors
//   - malformed props safe
//   - deterministic output
//   - no mutation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { BaseSection } from "@/types/section";
import {
  getFieldDefinitions,
  hasEditableFields,
  isSupportedFieldPath,
  buildDescriptors,
  buildDescriptorFromFieldId,
  resolveDescriptor,
  getStringValueAtPath,
} from "../editable-field-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(type: string, props: Record<string, unknown>): BaseSection {
  return {
    id: `s-${type}`,
    type: type as BaseSection["type"],
    order: 1,
    visible: true,
    props,
    styles: {},
  };
}

const HERO = makeSection("hero", {
  headline: "Build faster",
  subheadline: "Ship in minutes",
  primaryCta: { text: "Start", href: "#" },
  secondaryCta: { text: "Learn", href: "#" },
});

// ---------------------------------------------------------------------------
// Supported section types
// ---------------------------------------------------------------------------

describe("editable field registry — section coverage", () => {
  it("registers editable fields for every supported section type", () => {
    const types = ["header", "hero", "features", "pricing", "faq", "cta", "footer"];
    for (const type of types) {
      expect(hasEditableFields(type)).toBe(true);
      expect(getFieldDefinitions(type).length).toBeGreaterThan(0);
    }
  });

  it("returns an empty list for unknown section types", () => {
    expect(getFieldDefinitions("unknown-type")).toEqual([]);
    expect(hasEditableFields("unknown-type")).toBe(false);
  });

  it("header registers logo, nav link text, and CTA", () => {
    const ids = getFieldDefinitions("header").map((d) => d.id);
    expect(ids).toEqual(["header.logoText", "header.navLinks.text", "header.ctaText"]);
  });

  it("hero registers headline, subheadline, and both CTAs", () => {
    const ids = getFieldDefinitions("hero").map((d) => d.id);
    expect(ids).toEqual([
      "hero.headline",
      "hero.subheadline",
      "hero.primaryCta.text",
      "hero.secondaryCta.text",
    ]);
  });

  it("pricing registers nested plan fields including per-plan features", () => {
    const ids = getFieldDefinitions("pricing").map((d) => d.id);
    expect(ids).toContain("pricing.plan.name");
    expect(ids).toContain("pricing.plan.description");
    expect(ids).toContain("pricing.plan.cta");
    expect(ids).toContain("pricing.plan.feature");
  });
});

// ---------------------------------------------------------------------------
// Safety — no dangerous fields exposed
// ---------------------------------------------------------------------------

describe("editable field registry — safety", () => {
  it("never registers href paths", () => {
    for (const type of ["header", "hero", "features", "pricing", "faq", "cta", "footer"]) {
      for (const def of getFieldDefinitions(type)) {
        expect(def.path).not.toContain("href");
        expect(def.id).not.toMatch(/href/i);
      }
    }
  });

  it("never registers price paths", () => {
    for (const type of ["header", "hero", "features", "pricing", "faq", "cta", "footer"]) {
      for (const def of getFieldDefinitions(type)) {
        expect(def.path).not.toContain("price");
        expect(def.path).not.toContain("amount");
        expect(def.id).not.toMatch(/price/i);
      }
    }
  });

  it("never registers AssetRef or id paths", () => {
    for (const type of ["header", "hero", "features", "pricing", "faq", "cta", "footer"]) {
      for (const def of getFieldDefinitions(type)) {
        expect(def.path).not.toContain("assetId");
        expect(def.path).not.toContain("image");
        expect(def.path).not.toContain("id");
      }
    }
  });

  it("hero primary CTA href is not a supported field path", () => {
    expect(isSupportedFieldPath("hero", ["primaryCta", "href"])).toBe(false);
    expect(isSupportedFieldPath("hero", ["primaryCta", "text"])).toBe(true);
  });

  it("pricing plan price is not a supported field path", () => {
    expect(isSupportedFieldPath("pricing", ["plans", 0, "price"])).toBe(false);
    expect(isSupportedFieldPath("pricing", ["plans", 0, "name"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Descriptor building
// ---------------------------------------------------------------------------

describe("editable field registry — descriptors", () => {
  it("builds stable descriptors for a hero section", () => {
    const descriptors = buildDescriptors("page-1", HERO);
    const headline = descriptors.find((d) => d.fieldPath[0] === "headline");
    expect(headline).toMatchObject({
      pageId: "page-1",
      sectionId: "s-hero",
      sectionType: "hero",
      fieldPath: ["headline"],
      kind: "heading",
      label: "Headline",
      currentValue: "Build faster",
      maxLength: 300,
      aiEditable: true,
    });
  });

  it("enumerates nested array fields with concrete indices", () => {
    const section = makeSection("features", {
      title: "Features",
      features: [
        { title: "One", description: "First" },
        { title: "Two", description: "Second" },
      ],
    });
    const descriptors = buildDescriptors("p1", section);
    const titles = descriptors.filter((d) => d.fieldPath[0] === "features" && d.fieldPath[2] === "title");
    expect(titles).toHaveLength(2);
    expect(titles[0].fieldPath).toEqual(["features", 0, "title"]);
    expect(titles[1].fieldPath).toEqual(["features", 1, "title"]);
    expect(titles[1].currentValue).toBe("Two");
  });

  it("buildDescriptorFromFieldId resolves array index fields", () => {
    const section = makeSection("features", {
      features: [{ title: "One" }, { title: "Two" }],
    });
    const desc = buildDescriptorFromFieldId("p1", section, "features.feature.title", 1);
    expect(desc).not.toBeNull();
    expect(desc!.fieldPath).toEqual(["features", 1, "title"]);
    expect(desc!.currentValue).toBe("Two");
  });

  it("handles pricing plan feature with two indices", () => {
    const section = makeSection("pricing", {
      plans: [{ name: "Free", features: ["a", "b"] }],
    });
    const desc = buildDescriptorFromFieldId("p1", section, "pricing.plan.feature", [0, 1]);
    expect(desc).not.toBeNull();
    expect(desc!.fieldPath).toEqual(["plans", 0, "features", 1]);
    expect(desc!.currentValue).toBe("b");
  });

  it("returns null for unknown field ids", () => {
    expect(buildDescriptorFromFieldId("p1", HERO, "hero.nonexistent")).toBeNull();
  });

  it("returns null when the value is not a string", () => {
    const section = makeSection("hero", { headline: 123 as unknown as string });
    expect(resolveDescriptor("p1", section, ["headline"])).toBeNull();
  });

  it("returns null when the concrete path does not match the template", () => {
    expect(resolveDescriptor("p1", HERO, ["headline", 0])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Malformed props + determinism + no mutation
// ---------------------------------------------------------------------------

describe("editable field registry — robustness", () => {
  it("never crashes on malformed props", () => {
    const malformed = makeSection("features", {
      title: null,
      features: "not-an-array",
    } as unknown as Record<string, unknown>);
    expect(() => buildDescriptors("p1", malformed)).not.toThrow();
    expect(buildDescriptors("p1", malformed)).toHaveLength(0);
  });

  it("never crashes on deeply malformed arrays", () => {
    const malformed = makeSection("pricing", {
      plans: [{ name: 42 }, { features: [1, null] }, null],
    } as unknown as Record<string, unknown>);
    expect(() => buildDescriptors("p1", malformed)).not.toThrow();
  });

  it("is deterministic for a given section", () => {
    const a = buildDescriptors("p1", HERO);
    const b = buildDescriptors("p1", HERO);
    expect(a).toEqual(b);
  });

  it("does not mutate the input section", () => {
    const before = JSON.stringify(HERO.props);
    buildDescriptors("p1", HERO);
    expect(JSON.stringify(HERO.props)).toBe(before);
  });

  it("getStringValueAtPath is prototype-pollution safe", () => {
    const props = Object.create({ __proto__: { evil: "x" } });
    expect(getStringValueAtPath(props, ["evil"])).toBeUndefined();
  });
});
