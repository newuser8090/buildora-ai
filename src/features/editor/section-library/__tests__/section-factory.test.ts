// ---------------------------------------------------------------------------
// SectionFactory — tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { SectionFactory, type SectionIdFactory } from "../services/section-factory";
import { SectionLibraryRegistry } from "../registry/section-library-registry";
import {
  registerDefaultSectionLibrary,
  resetSectionLibraryRegistration,
} from "../registry/register-default-section-library";
import { sectionLibraryRegistry } from "../registry/section-library-registry";
import type { BaseSection } from "@/types/section";

describe("SectionFactory", () => {
  let factory: SectionFactory;

  beforeEach(() => {
    resetSectionLibraryRegistration();
    sectionLibraryRegistry.clear();
    registerDefaultSectionLibrary();
    factory = new SectionFactory();
  });

  it("creates every supported section type", () => {
    const types = ["header", "hero", "features", "pricing", "faq", "cta", "footer"];
    for (const type of types) {
      const result = factory.create({ type: type as never });
      expect(result.ok, type).toBe(true);
      if (result.ok) {
        expect(result.section.type).toBe(type);
        expect(result.section.visible).toBe(true);
      }
    }
  });

  it("uses the injected sectionId when provided", () => {
    const result = factory.create({ type: "hero", sectionId: "my-custom-id" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.section.id).toBe("my-custom-id");
  });

  it("assigns the requested order", () => {
    const result = factory.create({ type: "hero", order: 42 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.section.order).toBe(42);
  });

  it("uses the injected ID factory", () => {
    const idFactory: SectionIdFactory = (type) => `factory-${type}`;
    const custom = new SectionFactory({ idFactory });
    const result = custom.create({ type: "hero" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.section.id).toBe("factory-hero");
  });

  it("detects ID conflicts", () => {
    const result = factory.create({
      type: "hero",
      sectionId: "dup",
      existingIds: ["dup"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_ID_CONFLICT");
  });

  it("rejects unknown section types with SECTION_DEFINITION_NOT_FOUND", () => {
    const result = factory.create({ type: "bogus" as never });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_DEFINITION_NOT_FOUND");
  });

  it("produces sections that pass schema validation", () => {
    for (const type of ["header", "hero", "features", "pricing", "faq", "cta", "footer"]) {
      const result = factory.create({ type: type as never });
      expect(result.ok).toBe(true);
    }
  });

  it("returns deeply independent sections across creations", () => {
    const a = factory.create({ type: "features" });
    const b = factory.create({ type: "features" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.section).not.toBe(b.section);
    expect(a.section.props).not.toBe(b.section.props);
    const aProps = a.section.props as { features: unknown[] };
    const bProps = b.section.props as { features: unknown[] };
    expect(aProps.features).not.toBe(bProps.features);
    aProps.features.push({ title: "mutated" } as never);
    expect(bProps.features).toHaveLength(3);
  });

  it("props are independent from the definition", () => {
    const def = sectionLibraryRegistry.get("hero")!;
    const propsBefore = def.createProps();
    const result = factory.create({ type: "hero" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const created = result.section.props as unknown as Record<string, string>;
    created.headline = "MUTATED";
    const propsAfter = def.createProps() as unknown as Record<string, string>;
    expect(propsAfter.headline).not.toBe("MUTATED");
    expect(propsBefore).not.toBe(created);
  });

  it("styles are independent objects", () => {
    const a = factory.create({ type: "hero" });
    const b = factory.create({ type: "hero" });
    if (!a.ok || !b.ok) return;
    a.section.styles.test = "x";
    expect(b.section.styles).not.toHaveProperty("test");
  });

  it("does not mutate the definition", () => {
    const def = sectionLibraryRegistry.get("pricing")!;
    const serializedBefore = JSON.stringify(def);
    factory.create({ type: "pricing" });
    expect(JSON.stringify(def)).toBe(serializedBefore);
  });

  it("maps creation failures to structured errors", () => {
    // Force a definition that throws in createProps
    const registry = new SectionLibraryRegistry();
    registry.register({
      type: "hero",
      name: "Broken",
      description: "x",
      category: "hero",
      keywords: [],
      iconKey: "sparkles",
      createProps: () => {
        throw new Error("boom");
      },
      createStyles: () => ({}),
    });
    const custom = new SectionFactory({ registry });
    const result = custom.create({ type: "hero" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SECTION_CREATION_FAILED");
  });

  it("is deterministic for the same inputs (no hidden randomness in content)", () => {
    const a = factory.create({ type: "features", sectionId: "x" });
    const b = factory.create({ type: "features", sectionId: "x" });
    if (!a.ok || !b.ok) return;
    expect(a.section.props).toEqual(b.section.props);
    expect(a.section.styles).toEqual(b.section.styles);
    expect(a.section.order).toBe(b.section.order);
  });

  it("creates sections of type BaseSection shape with all required fields", () => {
    const result = factory.create({ type: "cta" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const section: BaseSection = result.section;
    expect(section.id).toBeTruthy();
    expect(typeof section.order).toBe("number");
    expect(typeof section.visible).toBe("boolean");
    expect(typeof section.props).toBe("object");
    expect(typeof section.styles).toBe("object");
  });
});
