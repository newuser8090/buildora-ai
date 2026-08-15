// ---------------------------------------------------------------------------
// Inspector resolver tests (Phase P22-C)
// Covers: base/override/inherited resolution, geometry/props/node sources,
// spacing shorthand + longhand merging, hasFieldOverride.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../../registry/register-default-elements";
import type { ElementNode } from "../../types";
import { getInspectorSchema } from "../schemas";
import {
  hasFieldOverride,
  resolveFieldValue,
  resolveInspectorModel,
  resolveSpacingSides,
  allFieldsOf,
} from "../resolver";
import type { InspectorFieldDef } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

function fieldById(id: string): InspectorFieldDef {
  const schema = getInspectorSchema("heading");
  const field = allFieldsOf(schema).find((f) => f.id === id);
  if (!field) throw new Error(`Missing field ${id}`);
  return field;
}

function nodeWith(overrides: Partial<ElementNode>): ElementNode {
  return {
    id: "n1",
    type: "heading",
    parentId: null,
    children: [],
    props: { text: "Hello" },
    style: { fontSize: 24, color: "#111111" },
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

describe("resolveFieldValue — base values", () => {
  it("reads style tokens at the base breakpoint", () => {
    const node = nodeWith({});
    const resolved = resolveFieldValue(node, fieldById("fontSize"), "base");
    expect(resolved.value).toBe(24);
    expect(resolved.origin).toBe("base");
    expect(resolved.overridden).toBe(false);
  });

  it("reports absent values", () => {
    const node = nodeWith({ style: {} });
    const resolved = resolveFieldValue(node, fieldById("fontSize"), "base");
    expect(resolved.value).toBeUndefined();
    expect(resolved.origin).toBe("absent");
  });

  it("reads geometry, props and node sources", () => {
    const node = nodeWith({
      geometry: { mode: "absolute", width: 320, x: 12 },
      props: { text: "Hello" },
      hidden: true,
    });
    expect(resolveFieldValue(node, fieldById("width"), "base").value).toBe(320);
    expect(resolveFieldValue(node, fieldById("x"), "base").value).toBe(12);
    expect(resolveFieldValue(node, fieldById("hidden"), "base").value).toBe(true);
  });
});

describe("resolveFieldValue — responsive overrides", () => {
  it("override wins over base at the matching breakpoint", () => {
    const node = nodeWith({
      style: { fontSize: 24 },
      viewport: { mobile: { fontSize: 18 } },
    });
    const mobile = resolveFieldValue(node, fieldById("fontSize"), "mobile");
    expect(mobile.value).toBe(18);
    expect(mobile.origin).toBe("override");
    expect(mobile.overridden).toBe(true);
    expect(mobile.inherited).toBe(false);
  });

  it("inherits the base value when no override exists", () => {
    const node = nodeWith({ style: { fontSize: 24 } });
    const tablet = resolveFieldValue(node, fieldById("fontSize"), "tablet");
    expect(tablet.value).toBe(24);
    expect(tablet.origin).toBe("base");
    expect(tablet.inherited).toBe(true);
    expect(tablet.overridden).toBe(false);
  });

  it("does not change the base value when only a mobile override exists", () => {
    const node = nodeWith({
      style: { fontSize: 24 },
      viewport: { mobile: { fontSize: 18 } },
    });
    const base = resolveFieldValue(node, fieldById("fontSize"), "base");
    expect(base.value).toBe(24);
    expect(base.overridden).toBe(false);
  });

  it("non-responsive-capable fields ignore breakpoints", () => {
    const node = nodeWith({ style: { fontSize: 24 } });
    // width is a geometry field — never breakpoint-scoped.
    const base = resolveFieldValue(node, fieldById("width"), "mobile");
    expect(base.origin).toBe("absent");
    expect(base.overridden).toBe(false);
  });
});

describe("hasFieldOverride", () => {
  it("true only when an override exists at the exact breakpoint", () => {
    const node = nodeWith({ viewport: { mobile: { fontSize: 18 } } });
    expect(hasFieldOverride(node, fieldById("fontSize"), "mobile")).toBe(true);
    expect(hasFieldOverride(node, fieldById("fontSize"), "tablet")).toBe(false);
    expect(hasFieldOverride(node, fieldById("width"), "mobile")).toBe(false);
  });
});

describe("resolveSpacingSides", () => {
  it("expands 1/2/4-part shorthand", () => {
    expect(resolveSpacingSides({ padding: "1rem" }, fieldById("padding"))).toEqual({
      top: "1rem",
      right: "1rem",
      bottom: "1rem",
      left: "1rem",
    });
    expect(resolveSpacingSides({ padding: "1rem 2rem" }, fieldById("padding"))).toEqual({
      top: "1rem",
      right: "2rem",
      bottom: "1rem",
      left: "2rem",
    });
  });

  it("longhand tokens override their side", () => {
    expect(
      resolveSpacingSides({ padding: "1rem", paddingLeft: "3rem" }, fieldById("padding")),
    ).toEqual({ top: "1rem", right: "1rem", bottom: "1rem", left: "3rem" });
  });

  it("returns null when nothing is set", () => {
    expect(resolveSpacingSides({}, fieldById("padding"))).toBeNull();
  });
});

describe("resolveInspectorModel", () => {
  it("resolves every field of the schema", () => {
    const node = nodeWith({});
    const model = resolveInspectorModel(node, "base");
    const schemaFieldIds = allFieldsOf(model.schema).map((f) => f.id);
    expect(Object.keys(model.values).sort()).toEqual([...schemaFieldIds].sort());
    expect(model.schema.elementType).toBe("heading");
  });
});
