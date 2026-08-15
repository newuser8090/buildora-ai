// ---------------------------------------------------------------------------
// Responsive grid columns field tests (Phase P22-F)
//
// The grid Columns control is the architecture's named responsive property:
// base (desktop) writes props.columns (the block renderer's default); tablet/
// mobile write/read a `gridTemplateColumns` viewport override through the
// existing viewport model — no new resolution system, no CSS authoring.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../../registry/register-default-elements";
import { validateElementTree } from "../../engine/element-validation";
import type { ElementNode, ElementTree } from "../../types";
import { getInspectorSchema } from "../schemas";
import {
  applyInspectorFieldChange,
  resetInspectorField,
  validateInspectorFieldValue,
} from "../mutate";
import { hasFieldOverride, resolveFieldValue, allFieldsOf } from "../resolver";
import type { InspectorFieldDef } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

function gridNode(overrides: Partial<ElementNode> = {}): ElementNode {
  return {
    id: "g",
    type: "grid",
    parentId: null,
    children: [],
    props: { columns: 3 },
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function treeWithGrid(overrides: Partial<ElementNode> = {}): ElementTree {
  const root = gridNode(overrides);
  return { rootIds: ["g"], nodes: { g: root } };
}

function columnsField(): InspectorFieldDef {
  const schema = getInspectorSchema("grid");
  const field = allFieldsOf(schema).find((f) => f.id === "columns");
  if (!field) throw new Error("Grid schema missing columns field");
  return field;
}

function expectValid(tree: ElementTree): void {
  const result = validateElementTree(tree);
  expect(result.valid).toBe(true);
}

describe("grid schema", () => {
  it("exposes a responsive grid-columns field in Layout for grid elements", () => {
    const field = columnsField();
    expect(field.kind).toBe("grid-columns");
    expect(field.source).toBe("props");
    expect(field.responsiveCapable).toBe(true);
    expect(field.options?.map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("does not expose the columns field for non-grid elements", () => {
    const heading = getInspectorSchema("heading");
    expect(allFieldsOf(heading).some((f) => f.id === "columns")).toBe(false);
  });
});

describe("grid-columns validation", () => {
  it("accepts numbers and numeric strings, clamped to 1..6", () => {
    const field = columnsField();
    expect(validateInspectorFieldValue(field, "2")).toEqual({ ok: true, value: 2 });
    expect(validateInspectorFieldValue(field, 4)).toEqual({ ok: true, value: 4 });
    expect(validateInspectorFieldValue(field, "99")).toEqual({ ok: true, value: 6 });
    expect(validateInspectorFieldValue(field, "0")).toEqual({ ok: true, value: 1 });
  });

  it("rejects garbage and treats empty as reset", () => {
    const field = columnsField();
    expect(validateInspectorFieldValue(field, "abc").ok).toBe(false);
    expect(validateInspectorFieldValue(field, "")).toEqual({ ok: true, value: undefined });
    expect(validateInspectorFieldValue(field, undefined)).toEqual({ ok: true, value: undefined });
  });
});

describe("grid-columns mutation", () => {
  it("base writes props.columns", () => {
    const result = applyInspectorFieldChange(treeWithGrid(), "g", columnsField(), 2, "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.g.props.columns).toBe(2);
    expect(result.value.nodes.g.viewport).toBeUndefined();
    expectValid(result.value);
  });

  it("tablet/mobile writes a gridTemplateColumns override without touching base", () => {
    const result = applyInspectorFieldChange(treeWithGrid(), "g", columnsField(), 2, "mobile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.g.props.columns).toBe(3);
    expect(result.value.nodes.g.viewport?.mobile?.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
    expectValid(result.value);
  });

  it("reset at tablet deletes only the override", () => {
    const base = treeWithGrid({ viewport: { tablet: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } } });
    const result = resetInspectorField(base, "g", columnsField(), "tablet");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.g.viewport).toBeUndefined();
    expect(result.value.nodes.g.props.columns).toBe(3);
    expectValid(result.value);
  });

  it("base reset restores the default column count", () => {
    const result = resetInspectorField(treeWithGrid({ props: { columns: 6 } }), "g", columnsField(), "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.g.props.columns).toBe(3);
    expect(result.value.nodes.g.viewport).toBeUndefined();
    expectValid(result.value);
  });
});

describe("grid-columns resolution", () => {
  it("base reads props.columns (default 3)", () => {
    const resolved = resolveFieldValue(gridNode(), columnsField(), "base");
    expect(resolved.value).toBe(3);
    expect(resolved.overridden).toBe(false);

    const noProp = resolveFieldValue(gridNode({ props: {} }), columnsField(), "base");
    expect(noProp.value).toBe(3);
    expect(noProp.origin).toBe("absent");
  });

  it("tablet/mobile reads the override parsed back to a count", () => {
    const node = gridNode({ viewport: { mobile: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } } });
    const resolved = resolveFieldValue(node, columnsField(), "mobile");
    expect(resolved.value).toBe(2);
    expect(resolved.origin).toBe("override");
    expect(resolved.overridden).toBe(true);
  });

  it("inherits the base count when no override exists", () => {
    const resolved = resolveFieldValue(gridNode(), columnsField(), "mobile");
    expect(resolved.value).toBe(3);
    expect(resolved.inherited).toBe(true);
    expect(resolved.overridden).toBe(false);
  });

  it("hasFieldOverride detects the gridTemplateColumns override", () => {
    expect(hasFieldOverride(gridNode(), columnsField(), "mobile")).toBe(false);
    const overridden = gridNode({ viewport: { mobile: { gridTemplateColumns: "repeat(1, minmax(0, 1fr))" } } });
    expect(hasFieldOverride(overridden, columnsField(), "mobile")).toBe(true);
  });
});
