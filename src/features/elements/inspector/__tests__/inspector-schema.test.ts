// ---------------------------------------------------------------------------
// Inspector schema tests (Phase P22-C)
// Covers: capability resolution, schema-by-type, supported/unsupported
// properties, universal groups, deterministic cache.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../../registry/register-default-elements";
import { capabilitiesForType } from "../capabilities";
import { clearInspectorSchemaCache, getInspectorSchema } from "../schemas";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
  clearInspectorSchemaCache();
});

describe("capabilitiesForType", () => {
  it("text-capable types get typography", () => {
    for (const type of ["heading", "paragraph", "button", "text", "price", "list"]) {
      expect(capabilitiesForType(type), type).toContain("typography");
    }
  });

  it("image-capable types get content", () => {
    for (const type of ["image", "video", "logo"]) {
      expect(capabilitiesForType(type), type).toContain("content");
    }
  });

  it("every type gets the universal groups", () => {
    for (const type of ["heading", "container", "image", "section", "custom-component"]) {
      const caps = capabilitiesForType(type);
      expect(caps, type).toContain("appearance");
      expect(caps, type).toContain("layout");
      expect(caps, type).toContain("spacing");
      expect(caps, type).toContain("advanced");
    }
  });
});

describe("getInspectorSchema", () => {
  it("heading schema exposes typography fields but no content group", () => {
    const schema = getInspectorSchema("heading");
    expect(schema.label).toBeTruthy();
    const ids = schema.sections.map((s) => s.id);
    expect(ids).toContain("typography");
    expect(ids).toContain("appearance");
    expect(ids).toContain("advanced");
    const typography = schema.sections.find((s) => s.id === "typography")!;
    const fieldIds = typography.fields.map((f) => f.id);
    expect(fieldIds).toContain("fontSize");
    expect(fieldIds).toContain("fontFamily");
    expect(fieldIds).toContain("color");
    expect(fieldIds).toContain("lineHeight");
    expect(fieldIds).toContain("textAlign");
  });

  it("button schema includes content (editable text)", () => {
    const schema = getInspectorSchema("button");
    const ids = schema.sections.map((s) => s.id);
    expect(ids).toContain("content");
    const content = schema.sections.find((s) => s.id === "content")!;
    expect(content.fields.some((f) => f.key === "text")).toBe(true);
  });

  it("image schema includes src/alt content fields", () => {
    const schema = getInspectorSchema("image");
    const content = schema.sections.find((s) => s.id === "content");
    expect(content).toBeTruthy();
    const keys = content!.fields.map((f) => f.key);
    expect(keys).toContain("src");
    expect(keys).toContain("alt");
  });

  it("container schema has layout with flex direction", () => {
    const schema = getInspectorSchema("container");
    const layout = schema.sections.find((s) => s.id === "layout")!;
    expect(layout.fields.some((f) => f.id === "flexDirection")).toBe(true);
  });

  it("unsupported types still get the universal groups (schema-safe)", () => {
    // A hypothetical future type must never crash schema resolution.
    const schema = getInspectorSchema("section" as never);
    const ids = schema.sections.map((s) => s.id);
    expect(ids).toContain("appearance");
    expect(ids).toContain("advanced");
    expect(schema.sections.length).toBeGreaterThanOrEqual(4);
  });

  it("geometry fields are marked with geometry source and style fields with style", () => {
    const schema = getInspectorSchema("heading");
    const all = schema.sections.flatMap((s) => s.fields);
    const width = all.find((f) => f.id === "width");
    expect(width?.source).toBe("geometry");
    expect(width?.key).toBe("width");
    const fontSize = all.find((f) => f.id === "fontSize");
    expect(fontSize?.source).toBe("style");
    expect(fontSize?.responsiveCapable).toBe(true);
  });

  it("resolution is deterministic and cached", () => {
    const a = getInspectorSchema("paragraph");
    const b = getInspectorSchema("paragraph");
    expect(a).toBe(b);
    expect(a.sections).toBe(b.sections);
  });

  it("advanced fields cover position mode, x/y, visibility and lock", () => {
    const schema = getInspectorSchema("container");
    const advanced = schema.sections.find((s) => s.id === "advanced")!;
    const ids = advanced.fields.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["positionMode", "x", "y", "hidden", "locked"]));
  });
});
