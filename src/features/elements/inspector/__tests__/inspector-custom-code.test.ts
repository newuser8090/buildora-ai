// ---------------------------------------------------------------------------
// Phase P23-D — inspector custom-code support
//   - the Custom Code section exists ONLY for leaf content blocks
//     (heading/paragraph/button/badge/image/video/icon) and never for
//     containers, composites, or custom-component
//   - the customCode field factory is a "custom-code" kind field sourced from
//     node.customCode
//   - the resolver reads node.customCode as the field value
//   - mutate validates through the shared ElementCustomCodeSchema (caps +
//     enabled default) and routes writes through updateElementCustomCode
//   - null clears customCode; editing preserves the enabled flag
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import { registerDefaultElements } from "../../registry/register-default-elements";
import {
  ELEMENT_MAX_CUSTOM_CODE_LENGTH,
  ELEMENT_MAX_CUSTOM_CODE_TOTAL,
} from "../../schemas/element-schemas";
import { customCodeField } from "../fields";
import { clearInspectorSchemaCache, getInspectorSchema } from "../schemas";
import {
  applyInspectorFieldChange,
  resetInspectorField,
  validateInspectorFieldValue,
} from "../mutate";
import { readRawFieldValue, resolveFieldValue } from "../resolver";
import type { ElementNode, ElementTree } from "../../types";
import { createElement, updateElementCustomCode } from "../../engine/element-operations";
import type { InspectorFieldDef } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
  clearInspectorSchemaCache();
});

function schemaField(type: string): InspectorFieldDef {
  const schema = getInspectorSchema(type as never);
  const field = schema.sections
    .flatMap((s) => s.fields)
    .find((f) => f.id === "customCode");
  if (!field) throw new Error(`Missing customCode field for ${type}`);
  return field;
}

function headingNodeWithCustomCode(customCode: unknown): ElementNode {
  return {
    id: "h1",
    type: "heading",
    parentId: null,
    children: [],
    props: { text: "Hi" },
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    customCode: customCode as ElementNode["customCode"],
  };
}

function headingTree(): ElementTree {
  return {
    rootIds: ["h1"],
    nodes: { h1: createElement("heading", { id: "h1" }) },
  };
}

// ---------------------------------------------------------------------------
// Schema — Custom Code section gating
// ---------------------------------------------------------------------------

describe("getInspectorSchema — Custom Code section (P23-D)", () => {
  it("adds the custom-code section for every curated leaf content block", () => {
    for (const type of ["heading", "paragraph", "button", "badge", "image", "video", "icon"]) {
      const schema = getInspectorSchema(type as never);
      const section = schema.sections.find((s) => s.id === "custom-code");
      expect(section, `missing custom-code section for ${type}`).toBeDefined();
      expect(section?.label).toBe("Custom Code");
      expect(section?.fields).toHaveLength(1);
      expect(section?.fields[0].kind).toBe("custom-code");
    }
  });

  it("never adds the section for containers, composites, or custom-component", () => {
    for (const type of ["container", "card", "form", "navbar", "custom-component", "section", "text"]) {
      const schema = getInspectorSchema(type as never);
      expect(
        schema.sections.some((s) => s.id === "custom-code"),
        `unexpected custom-code section for ${type}`,
      ).toBe(false);
    }
  });

  it("sits after the universal groups and is the only custom-code field", () => {
    const schema = getInspectorSchema("heading");
    const ids = schema.sections.map((s) => s.id);
    expect(ids.indexOf("custom-code")).toBe(ids.length - 1);
  });
});

// ---------------------------------------------------------------------------
// Field factory
// ---------------------------------------------------------------------------

describe("customCodeField — factory (P23-D)", () => {
  it("declares kind custom-code with source customCode", () => {
    const field = customCodeField();
    expect(field.kind).toBe("custom-code");
    expect(field.source).toBe("customCode");
    expect(field.key).toBe("customCode");
    expect(field.id).toBe("customCode");
  });
});

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

describe("resolver — customCode source (P23-D)", () => {
  it("readRawFieldValue returns node.customCode", () => {
    const code = { enabled: true, css: "p{}" };
    const node = headingNodeWithCustomCode(code);
    expect(readRawFieldValue(node, schemaField("heading"))).toEqual(code);
  });

  it("resolveFieldValue resolves the whole object at any breakpoint", () => {
    const code = { enabled: true, css: "p{}" };
    const node = headingNodeWithCustomCode(code);
    const base = resolveFieldValue(node, schemaField("heading"), "base");
    expect(base.value).toEqual(code);
    expect(base.origin).toBe("base");
    expect(base.overridden).toBe(false);
    // Node-level metadata is never breakpoint-scoped.
    const mobile = resolveFieldValue(node, schemaField("heading"), "mobile");
    expect(mobile.value).toEqual(code);
  });

  it("resolves absent custom code as absent", () => {
    const node = headingNodeWithCustomCode(undefined);
    const resolved = resolveFieldValue(node, schemaField("heading"), "base");
    expect(resolved.value).toBeUndefined();
    expect(resolved.origin).toBe("absent");
  });
});

// ---------------------------------------------------------------------------
// Mutate — validation
// ---------------------------------------------------------------------------

describe("validateInspectorFieldValue — custom-code (P23-D)", () => {
  const field = customCodeField();

  it("null/undefined clears the field", () => {
    expect(validateInspectorFieldValue(field, null)).toEqual({ ok: true, value: null });
    expect(validateInspectorFieldValue(field, undefined)).toEqual({ ok: true, value: null });
  });

  it("valid payloads parse through the shared schema (enabled defaulted false)", () => {
    const result = validateInspectorFieldValue(field, { css: "p { color: red; }" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ css: "p { color: red; }", enabled: false });
    }
  });

  it("preserves enabled:true when explicitly requested", () => {
    const result = validateInspectorFieldValue(field, { enabled: true, js: "x()" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ enabled: true, js: "x()" });
  });

  it("rejects a per-field over the 20k cap", () => {
    const result = validateInspectorFieldValue(field, {
      js: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an aggregate over 48k even when every field is within 20k", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    const over = ELEMENT_MAX_CUSTOM_CODE_TOTAL - 2 * ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1;
    const result = validateInspectorFieldValue(field, {
      css: atCap,
      js: atCap,
      html: "y".repeat(over),
    });
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mutate — apply path (routes through updateElementCustomCode)
// ---------------------------------------------------------------------------

describe("applyInspectorFieldChange — customCode source (P23-D)", () => {
  it("writes a validated payload and keeps enabled false for legacy input", () => {
    const result = applyInspectorFieldChange(
      headingTree(),
      "h1",
      schemaField("heading"),
      { css: "p{}" },
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h1.customCode?.css).toBe("p{}");
    expect(result.value.nodes.h1.customCode?.enabled).toBe(false);
  });

  it("preserves enabled:true through the write path", () => {
    const result = applyInspectorFieldChange(
      headingTree(),
      "h1",
      schemaField("heading"),
      { enabled: true, css: "p{}" },
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h1.customCode?.enabled).toBe(true);
    expect(result.value.nodes.h1.customCode?.css).toBe("p{}");
  });

  it("editing an existing payload preserves the enabled flag", () => {
    const seeded = updateElementCustomCode(headingTree(), "h1", {
      enabled: true,
      css: "p{}",
    });
    if (!seeded.ok) throw new Error("seed failed");
    const result = applyInspectorFieldChange(
      seeded.value,
      "h1",
      schemaField("heading"),
      { enabled: true, css: "p { color: blue; }" },
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h1.customCode?.enabled).toBe(true);
    expect(result.value.nodes.h1.customCode?.css).toBe("p { color: blue; }");
  });

  it("null clears customCode entirely", () => {
    const seeded = updateElementCustomCode(headingTree(), "h1", {
      enabled: true,
      css: "p{}",
    });
    if (!seeded.ok) throw new Error("seed failed");
    const result = applyInspectorFieldChange(
      seeded.value,
      "h1",
      schemaField("heading"),
      null,
      "base",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h1.customCode).toBeUndefined();
  });

  it("rejects oversized payloads with a structured error", () => {
    const result = applyInspectorFieldChange(
      headingTree(),
      "h1",
      schemaField("heading"),
      { js: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1) },
      "base",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_TREE_INVALID");
  });

  it("resetInspectorField clears custom code", () => {
    const seeded = updateElementCustomCode(headingTree(), "h1", {
      enabled: true,
      css: "p{}",
    });
    if (!seeded.ok) throw new Error("seed failed");
    const result = resetInspectorField(seeded.value, "h1", schemaField("heading"), "base");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.h1.customCode).toBeUndefined();
  });
});
