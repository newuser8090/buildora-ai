// ---------------------------------------------------------------------------
// Inspector mutation adapter tests (Phase P22-C)
// Covers: style base/override writes, resets, geometry/props/node fields,
// validation failures, spacing per-side writes, atomic-valid results.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../../registry/register-default-elements";
import { validateElementTree } from "../../engine/element-validation";
import type { ElementNode, ElementTree } from "../../types";
import { getInspectorSchema } from "../schemas";
import {
  applyInspectorFieldChange,
  applySpacingSideChange,
  clearViewportOverride,
  deleteStyleTokens,
  resetInspectorField,
  validateInspectorFieldValue,
} from "../mutate";
import { allFieldsOf } from "../resolver";
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

function treeWithRoot(overrides: Partial<ElementNode> = {}): ElementTree {
  const root: ElementNode = {
    id: "n1",
    type: "heading",
    parentId: null,
    children: [],
    props: { text: "Hello" },
    style: { fontSize: 24 },
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
  return { rootIds: ["n1"], nodes: { n1: root } };
}

function expectValid(tree: ElementTree): void {
  const result = validateElementTree(tree);
  expect(result.valid).toBe(true);
}

describe("applyInspectorFieldChange — style (base)", () => {
  it("writes a style token at the base breakpoint", () => {
    const result = applyInspectorFieldChange(
      treeWithRoot(),
      "n1",
      fieldById("fontSize"),
      32,
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.fontSize).toBe(32);
    expectValid(result.value);
  });

  it("normalizes '20px' strings to numbers", () => {
    const result = applyInspectorFieldChange(
      treeWithRoot(),
      "n1",
      fieldById("fontSize"),
      "20px",
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.fontSize).toBe(20);
  });

  it("clamps to field bounds", () => {
    const result = applyInspectorFieldChange(
      treeWithRoot(),
      "n1",
      fieldById("fontSize"),
      9999,
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.fontSize).toBe(200);
  });

  it("deletes the key on reset (undefined value)", () => {
    const tree = treeWithRoot();
    const result = applyInspectorFieldChange(tree, "n1", fieldById("fontSize"), undefined, "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.fontSize).toBeUndefined();
  });

  it("rejects malformed / dangerous values", () => {
    const result = applyInspectorFieldChange(
      treeWithRoot(),
      "n1",
      fieldById("color"),
      "javascript:alert(1)",
      "base",
    );
    expect(result.ok).toBe(false);
  });
});

describe("applyInspectorFieldChange — responsive overrides", () => {
  it("writes a mobile override without touching the base", () => {
    const tree = treeWithRoot();
    const result = applyInspectorFieldChange(tree, "n1", fieldById("fontSize"), 18, "mobile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.fontSize).toBe(24); // base untouched
    expect(result.value.nodes.n1.viewport?.mobile?.fontSize).toBe(18);
    expectValid(result.value);
  });

  it("clears a viewport override on reset", () => {
    const tree = treeWithRoot({
      style: { fontSize: 24 },
      viewport: { mobile: { fontSize: 18 } },
    });
    const result = applyInspectorFieldChange(tree, "n1", fieldById("fontSize"), undefined, "mobile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.viewport?.mobile).toBeUndefined();
    expect(result.value.nodes.n1.style.fontSize).toBe(24);
  });
});

describe("applyInspectorFieldChange — geometry / props / node", () => {
  it("writes geometry width", () => {
    const result = applyInspectorFieldChange(treeWithRoot(), "n1", fieldById("width"), 320, "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.geometry).toMatchObject({ mode: "flow", width: 320 });
    expectValid(result.value);
  });

  it("deletes a geometry key on reset", () => {
    const tree = treeWithRoot({ geometry: { mode: "absolute", width: 320, x: 10 } });
    const result = applyInspectorFieldChange(tree, "n1", fieldById("width"), undefined, "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.geometry?.width).toBeUndefined();
    expect(result.value.nodes.n1.geometry?.x).toBe(10); // untouched
  });

  it("writes props content", () => {
    const result = applyInspectorFieldChange(treeWithRoot(), "n1", fieldById("content-text"), "New text", "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.props.text).toBe("New text");
  });

  it("toggles node-level hidden and locked", () => {
    const hidden = applyInspectorFieldChange(treeWithRoot(), "n1", fieldById("hidden"), true, "base");
    expect(hidden.ok).toBe(true);
    if (hidden.ok) expect(hidden.value.nodes.n1.hidden).toBe(true);
    const locked = applyInspectorFieldChange(treeWithRoot(), "n1", fieldById("locked"), true, "base");
    expect(locked.ok).toBe(true);
    if (locked.ok) expect(locked.value.nodes.n1.locked).toBe(true);
  });
});

describe("resetInspectorField", () => {
  it("reset at base deletes the base key", () => {
    const tree = treeWithRoot();
    const result = resetInspectorField(tree, "n1", fieldById("fontSize"), "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.fontSize).toBeUndefined();
  });

  it("reset at mobile clears only the override", () => {
    const tree = treeWithRoot({ viewport: { mobile: { fontSize: 18 } } });
    const result = resetInspectorField(tree, "n1", fieldById("fontSize"), "mobile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.viewport?.mobile).toBeUndefined();
  });
});

describe("deleteStyleTokens / clearViewportOverride", () => {
  it("deleteStyleTokens removes keys and validates the record", () => {
    const tree = treeWithRoot({ style: { fontSize: 24, color: "#111" } });
    const result = deleteStyleTokens(tree, "n1", ["color"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.color).toBeUndefined();
    expect(result.value.nodes.n1.style.fontSize).toBe(24);
    expectValid(result.value);
  });

  it("clearViewportOverride drops the record when it empties", () => {
    const tree = treeWithRoot({ viewport: { mobile: { fontSize: 18 }, tablet: { color: "red" } } });
    const result = clearViewportOverride(tree, "n1", "mobile", ["fontSize"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.viewport?.mobile).toBeUndefined();
    expect(result.value.nodes.n1.viewport?.tablet).toEqual({ color: "red" });
  });

  it("missing element returns a structured error", () => {
    const result = deleteStyleTokens(treeWithRoot(), "missing", ["color"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_NOT_FOUND");
  });
});

describe("validateInspectorFieldValue", () => {
  it("bounds numeric input per field min/max", () => {
    const result = validateInspectorFieldValue(fieldById("opacity"), 150);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(100);
  });

  it("accepts plausible CSS lengths as strings", () => {
    const result = validateInspectorFieldValue(fieldById("fontSize"), "1.5rem");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("1.5rem");
  });

  it("rejects garbage numeric input", () => {
    const result = validateInspectorFieldValue(fieldById("fontSize"), "oops");
    expect(result.ok).toBe(false);
  });

  it("rejects unsafe colors at validation time", () => {
    const result = validateInspectorFieldValue(fieldById("color"), "expression(alert(1))");
    expect(result.ok).toBe(false);
  });
});

describe("applySpacingSideChange", () => {
  it("writes a single side as a longhand and removes the shorthand", () => {
    const tree = treeWithRoot({ style: { padding: "1rem" } });
    const result = applySpacingSideChange(tree, "n1", fieldById("padding"), "left", "3rem", "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.padding).toBeUndefined();
    expect(result.value.nodes.n1.style.paddingLeft).toBe("3rem");
    expectValid(result.value);
  });

  it("writes a mismatched side as a longhand (shorthand removed)", () => {
    const tree = treeWithRoot({ style: { padding: "1rem" } });
    const result = applySpacingSideChange(tree, "n1", fieldById("padding"), "top", "2rem", "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.padding).toBeUndefined();
    expect(result.value.nodes.n1.style.paddingTop).toBe("2rem");
  });

  it("collapses equal sides back to the shorthand", () => {
    const tree = treeWithRoot({
      style: { paddingTop: "1rem", paddingRight: "1rem", paddingBottom: "1rem" },
    });
    const result = applySpacingSideChange(tree, "n1", fieldById("padding"), "left", "1rem", "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.style.padding).toBe("1rem");
    expect(result.value.nodes.n1.style.paddingTop).toBeUndefined();
  });

  it("writes per-side spacing at a viewport override", () => {
    const tree = treeWithRoot({ style: { padding: "1rem" }, viewport: { mobile: {} } });
    const result = applySpacingSideChange(tree, "n1", fieldById("padding"), "top", "0.5rem", "mobile");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.n1.viewport?.mobile?.paddingTop).toBe("0.5rem");
    expect(result.value.nodes.n1.viewport?.mobile?.padding).toBeUndefined();
    expect(result.value.nodes.n1.style.padding).toBe("1rem"); // base untouched
    expectValid(result.value);
  });

  it("rejects unsafe side values", () => {
    const result = applySpacingSideChange(
      treeWithRoot(),
      "n1",
      fieldById("padding"),
      "top",
      "url(javascript:alert(1))",
      "base",
    );
    expect(result.ok).toBe(false);
  });
});
