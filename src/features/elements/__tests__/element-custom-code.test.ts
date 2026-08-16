// ---------------------------------------------------------------------------
// Custom code model/validation tests (Phase P23-A)
//
// P23-A adds the explicit `enabled` opt-in flag and enforces per-field plus
// aggregate size caps at the schema/authoring boundary, keeping custom code
// strictly INERT (no execution, no rendering, no export emission yet):
//   - enabled defaults to false for legacy payloads and round-trips when true
//   - html/css/js each capped at 20,000; aggregate (html+css+js) at 48,000
//   - attributes stay bounded (16 keys, key <=128, value <=2048)
//   - the operation boundary stores the schema-parsed value (enabled defaulted
//     or preserved) and rejects oversized payloads with ELEMENT_CUSTOM_CODE_INVALID
//   - clone (duplicateElement) preserves enabled + the code payload
//   - the normalizer clamps custom-code strings to the 20k code cap (not the
//     4k prose cap), preserves booleans, and strips dangerous metadata as before
//   - the registry exposes the opt-in capability for the curated LEAF content
//     blocks only (P23-D); custom-component is not an authoring vehicle
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { registerDefaultBlocks } from "@/features/blocks/registry/block-registry";
import {
  ELEMENT_MAX_ATTRIBUTES,
  ELEMENT_MAX_CUSTOM_CODE_LENGTH,
  ELEMENT_MAX_CUSTOM_CODE_TOTAL,
  ElementCustomCodeSchema,
} from "../schemas/element-schemas";
import { normalizeElementTree } from "../serialization/element-normalizer";
import {
  applyElementOperation,
  createElement,
  duplicateElement,
  updateElementCustomCode,
} from "../engine/element-operations";
import { validateElementTree } from "../engine/element-validation";
import { registerDefaultElements } from "../registry/register-default-elements";
import { elementSupportsCustomCode } from "../registry/element-registry";
import type { ElementTree } from "../types";

beforeEach(() => {
  registerDefaultBlocks();
  registerDefaultElements();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Raw (un-normalized) one-node custom-component tree for normalizer tests. */
function rawCustomComponentTree(customCode: unknown): Record<string, unknown> {
  return {
    rootIds: ["sec"],
    nodes: {
      sec: {
        id: "sec",
        type: "custom-component",
        parentId: null,
        children: [],
        props: {},
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        customCode,
      },
    },
  };
}

function customComponentTree(): ElementTree {
  return {
    rootIds: ["cc"],
    nodes: { cc: createElement("custom-component", { id: "cc" }) },
  };
}

// ---------------------------------------------------------------------------
// Schema: enabled flag
// ---------------------------------------------------------------------------

describe("ElementCustomCodeSchema — enabled flag (P23-A)", () => {
  it("defaults enabled to false for legacy payloads", () => {
    const parsed = ElementCustomCodeSchema.safeParse({ css: "p { color: red; }" });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.enabled).toBe(false);
  });

  it("defaults enabled to false for an empty legacy payload", () => {
    const parsed = ElementCustomCodeSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.enabled).toBe(false);
  });

  it("round-trips enabled:true when explicitly set", () => {
    const parsed = ElementCustomCodeSchema.safeParse({
      css: "p { color: red; }",
      enabled: true,
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.enabled).toBe(true);
  });

  it("rejects a non-boolean enabled", () => {
    expect(ElementCustomCodeSchema.safeParse({ enabled: "yes" }).success).toBe(false);
    expect(ElementCustomCodeSchema.safeParse({ enabled: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema: per-field + aggregate caps
// ---------------------------------------------------------------------------

describe("ElementCustomCodeSchema — size caps (P23-A)", () => {
  it("rejects html over 20,000 chars", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ html: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("rejects css over 20,000 chars", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ css: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("rejects js over 20,000 chars", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ js: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1) }).success,
    ).toBe(false);
  });

  it("accepts each field exactly at 20,000 chars", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    expect(ElementCustomCodeSchema.safeParse({ html: atCap }).success).toBe(true);
    expect(ElementCustomCodeSchema.safeParse({ css: atCap }).success).toBe(true);
    expect(ElementCustomCodeSchema.safeParse({ js: atCap }).success).toBe(true);
  });

  it("rejects an aggregate over 48,000 even when every field is within 20,000", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    // 20,000 + 20,000 + 8,001 = 48,001 > 48,000 (each field individually OK).
    const overByOne = ELEMENT_MAX_CUSTOM_CODE_TOTAL - 2 * ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1;
    expect(
      ElementCustomCodeSchema.safeParse({ css: atCap, js: atCap, html: "y".repeat(overByOne) }).success,
    ).toBe(false);
  });

  it("accepts an aggregate at exactly 48,000", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    // 20,000 + 20,000 + 8,000 = 48,000.
    const atTotal = ELEMENT_MAX_CUSTOM_CODE_TOTAL - 2 * ELEMENT_MAX_CUSTOM_CODE_LENGTH;
    expect(
      ElementCustomCodeSchema.safeParse({ css: atCap, js: atCap, html: "y".repeat(atTotal) }).success,
    ).toBe(true);
  });

  it("excludes attributes from the aggregate cap", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    const atTotal = ELEMENT_MAX_CUSTOM_CODE_TOTAL - 2 * ELEMENT_MAX_CUSTOM_CODE_LENGTH;
    expect(
      ElementCustomCodeSchema.safeParse({
        css: atCap,
        js: atCap,
        html: "y".repeat(atTotal),
        attributes: { a: "1", b: "2" },
      }).success,
    ).toBe(true);
  });

  it("excludes attributes from the aggregate cap", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    expect(
      ElementCustomCodeSchema.safeParse({
        css: atCap,
        js: atCap,
        html: "y".repeat(8_000),
        attributes: { a: "1", b: "2" },
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema: attributes bounds (existing limits remain enforced)
// ---------------------------------------------------------------------------

describe("ElementCustomCodeSchema — attributes bounds", () => {
  it("rejects more than 16 attributes", () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < ELEMENT_MAX_ATTRIBUTES + 1; i += 1) {
      attributes[`k${i}`] = "v";
    }
    expect(ElementCustomCodeSchema.safeParse({ attributes }).success).toBe(false);
  });

  it("accepts exactly 16 attributes", () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < ELEMENT_MAX_ATTRIBUTES; i += 1) {
      attributes[`k${i}`] = "v";
    }
    expect(ElementCustomCodeSchema.safeParse({ attributes }).success).toBe(true);
  });

  it("rejects attribute keys over 128 chars", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ attributes: { ["k".repeat(129)]: "v" } }).success,
    ).toBe(false);
  });

  it("rejects attribute values over 2,048 chars", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ attributes: { k: "v".repeat(2_049) } }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema: attribute safety (P23-F)
// ---------------------------------------------------------------------------

describe("ElementCustomCodeSchema — attribute safety (P23-F)", () => {
  it("accepts legitimate attributes (id, aria-*, data-*, class, …)", () => {
    const parsed = ElementCustomCodeSchema.safeParse({
      attributes: {
        id: "widget",
        title: "Widget",
        "aria-label": "Widget",
        "aria-describedby": "hint",
        role: "region",
        "data-count": "3",
        class: "hero",
        target: "_blank",
        rel: "noopener",
        download: "report.pdf",
        tabindex: "0",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects event-handler attributes (case-insensitive)", () => {
    for (const name of ["onclick", "onload", "onerror", "onmouseover", "ONKEYDOWN", "OnChange"]) {
      expect(
        ElementCustomCodeSchema.safeParse({ attributes: { [name]: "x()" } }).success,
      ).toBe(false);
    }
  });

  it("rejects javascript: values for URL-bearing attributes", () => {
    for (const name of ["href", "src", "action", "formaction", "poster", "cite", "background"]) {
      expect(
        ElementCustomCodeSchema.safeParse({
          attributes: { [name]: "javascript:alert(1)" },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects whitespace/control-obfuscated javascript: values", () => {
    expect(
      ElementCustomCodeSchema.safeParse({
        attributes: { href: "java\nscript:alert(1)" },
      }).success,
    ).toBe(false);
  });

  it("accepts safe URL values for URL-bearing attributes", () => {
    expect(
      ElementCustomCodeSchema.safeParse({
        attributes: {
          href: "https://example.com",
          src: "data:image/png;base64,AA==",
          cite: "/sources/1",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed attribute names (whitespace / invalid characters)", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ attributes: { "bad key": "v" } }).success,
    ).toBe(false);
    expect(
      ElementCustomCodeSchema.safeParse({ attributes: { "1digit": "v" } }).success,
    ).toBe(false);
  });

  it("rejects reserved shell attributes (style / srcdoc)", () => {
    expect(
      ElementCustomCodeSchema.safeParse({ attributes: { style: "position:fixed" } }).success,
    ).toBe(false);
    expect(
      ElementCustomCodeSchema.safeParse({ attributes: { srcdoc: "<script>x</script>" } }).success,
    ).toBe(false);
  });

  it("keeps html/css/js intact when safe attributes round-trip", () => {
    const parsed = ElementCustomCodeSchema.safeParse({
      enabled: true,
      html: "<p>hi</p>",
      css: "p { color: red; }",
      js: "console.log(1)",
      attributes: { "data-x": "y", "aria-label": "w" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.html).toBe("<p>hi</p>");
    expect(parsed.data.css).toBe("p { color: red; }");
    expect(parsed.data.js).toBe("console.log(1)");
    expect(parsed.data.attributes).toEqual({ "data-x": "y", "aria-label": "w" });
  });
});

// ---------------------------------------------------------------------------
// Operation boundary
// ---------------------------------------------------------------------------

describe("updateElementCustomCode — authoring boundary (P23-A)", () => {
  it("stores the parsed value with enabled defaulted to false for legacy payloads", () => {
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      css: "p { color: red; }",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.cc.customCode?.enabled).toBe(false);
    expect(result.value.nodes.cc.customCode?.css).toBe("p { color: red; }");
    expect(validateElementTree(result.value).valid).toBe(true);
  });

  it("preserves enabled:true when explicitly requested", () => {
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      css: "p { color: red; }",
      enabled: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.cc.customCode?.enabled).toBe(true);
  });

  it("rejects an aggregate over 48,000 with ELEMENT_CUSTOM_CODE_INVALID", () => {
    const atCap = "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      css: atCap,
      js: atCap,
      html: "y".repeat(8_001),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_CUSTOM_CODE_INVALID");
  });

  it("rejects an individual field over 20,000 with ELEMENT_CUSTOM_CODE_INVALID", () => {
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      js: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_CUSTOM_CODE_INVALID");
  });

  it("removes customCode when set to null", () => {
    const seeded = updateElementCustomCode(customComponentTree(), "cc", { css: "x" });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const removed = updateElementCustomCode(seeded.value, "cc", null);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.nodes.cc.customCode).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Operation boundary: attribute safety (P23-F)
// ---------------------------------------------------------------------------

describe("updateElementCustomCode — attribute safety (P23-F)", () => {
  it("stores safe attributes and keeps html/css/js", () => {
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      enabled: true,
      html: "<p>hi</p>",
      css: "p {}",
      js: "x()",
      attributes: { "data-x": "y", "aria-label": "w" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.nodes.cc.customCode?.enabled).toBe(true);
    expect(result.value.nodes.cc.customCode?.html).toBe("<p>hi</p>");
    expect(result.value.nodes.cc.customCode?.css).toBe("p {}");
    expect(result.value.nodes.cc.customCode?.js).toBe("x()");
    expect(result.value.nodes.cc.customCode?.attributes).toEqual({
      "data-x": "y",
      "aria-label": "w",
    });
    expect(validateElementTree(result.value).valid).toBe(true);
  });

  it("rejects event-handler attributes with ELEMENT_CUSTOM_CODE_INVALID", () => {
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      enabled: true,
      attributes: { onclick: "alert(1)" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_CUSTOM_CODE_INVALID");
  });

  it("rejects javascript: URL values with ELEMENT_CUSTOM_CODE_INVALID", () => {
    const result = updateElementCustomCode(customComponentTree(), "cc", {
      enabled: true,
      attributes: { href: "javascript:alert(1)" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ELEMENT_CUSTOM_CODE_INVALID");
  });

  it("does not allow attribute edits to change the code payload", () => {
    const seeded = updateElementCustomCode(customComponentTree(), "cc", {
      enabled: true,
      html: "<b>keep</b>",
      attributes: { "data-x": "1" },
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    const edited = updateElementCustomCode(seeded.value, "cc", {
      ...seeded.value.nodes.cc.customCode!,
      attributes: { "data-x": "2", "aria-label": "w" },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.value.nodes.cc.customCode?.html).toBe("<b>keep</b>");
    expect(edited.value.nodes.cc.customCode?.attributes).toEqual({
      "data-x": "2",
      "aria-label": "w",
    });
  });
});

// ---------------------------------------------------------------------------
// Clone preserves custom code + enabled
// ---------------------------------------------------------------------------

describe("duplicateElement — clone preserves custom code (P23-A)", () => {
  it("preserves enabled:true and the full payload on clone", () => {
    const seeded = updateElementCustomCode(customComponentTree(), "cc", {
      enabled: true,
      css: "p { color: red; }",
      js: "console.log(1)",
      html: "<span>hi</span>",
      attributes: { "data-x": "y" },
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const duplicated = duplicateElement(seeded.value, "cc");
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;

    const cloned = duplicated.value.tree.nodes[duplicated.value.newId];
    expect(cloned.customCode?.enabled).toBe(true);
    expect(cloned.customCode?.css).toBe("p { color: red; }");
    expect(cloned.customCode?.js).toBe("console.log(1)");
    expect(cloned.customCode?.html).toBe("<span>hi</span>");
    expect(cloned.customCode?.attributes).toEqual({ "data-x": "y" });
  });

  it("keeps a legacy (enabled-absent) payload disabled after clone", () => {
    const seeded = updateElementCustomCode(customComponentTree(), "cc", { css: "x" });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;

    const duplicated = duplicateElement(seeded.value, "cc");
    expect(duplicated.ok).toBe(true);
    if (!duplicated.ok) return;

    expect(duplicated.value.tree.nodes[duplicated.value.newId].customCode?.enabled).not.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Normalizer behavior
// ---------------------------------------------------------------------------

describe("normalizeElementTree — custom code repair (P23-A)", () => {
  it("defaults enabled to false for legacy documents", () => {
    const tree = normalizeElementTree(rawCustomComponentTree({ css: "p { color: red; }" }));
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect(tree.nodes.sec.customCode?.enabled).toBe(false);
    expect(tree.nodes.sec.customCode?.css).toBe("p { color: red; }");
  });

  it("preserves enabled:true through normalization", () => {
    const tree = normalizeElementTree(
      rawCustomComponentTree({ css: "p { color: red; }", enabled: true }),
    );
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect(tree.nodes.sec.customCode?.enabled).toBe(true);
  });

  it("clamps custom-code strings to the 20k code cap, not the 4k prose cap", () => {
    const tree = normalizeElementTree(
      rawCustomComponentTree({ js: "x".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH) }),
    );
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect(tree.nodes.sec.customCode?.js?.length).toBe(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
  });

  it("drops prototype-pollution keys inside custom code", () => {
    const hostile = JSON.parse('{"css":"x","__proto__":{"polluted":true}}');
    const tree = normalizeElementTree(rawCustomComponentTree(hostile));
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect((globalThis as Record<string, unknown>).polluted).toBeUndefined();
    expect(tree.nodes.sec.customCode?.css).toBe("x");
  });

  it("drops unsafe values inside custom code (javascript: string)", () => {
    const tree = normalizeElementTree(
      rawCustomComponentTree({ js: "javascript:alert(1)", css: "ok" }),
    );
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect(tree.nodes.sec.customCode?.js).toBeUndefined();
    expect(tree.nodes.sec.customCode?.css).toBe("ok");
  });

  it("drops the whole customCode field (not the node) when enabled is invalid", () => {
    const tree = normalizeElementTree(rawCustomComponentTree({ enabled: "yes", css: "x" }));
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect(tree.nodes.sec.customCode).toBeUndefined();
    expect(tree.nodes.sec.id).toBe("sec");
  });

  it("normalizes the stored value through the schema (enabled present after parse)", () => {
    const tree = normalizeElementTree(rawCustomComponentTree({ css: "x" }));
    expect(tree).not.toBeNull();
    if (!tree) return;
    // Every metadata field survives as schema-valid data — `enabled` is part
    // of the parsed shape, never raw input.
    expect(tree.nodes.sec.customCode).toMatchObject({ enabled: false, css: "x" });
  });

  it("preserves safe attributes through normalization", () => {
    const tree = normalizeElementTree(
      rawCustomComponentTree({
        enabled: true,
        html: "<p>hi</p>",
        attributes: { "data-x": "y", "aria-label": "w", href: "https://example.com" },
      }),
    );
    expect(tree).not.toBeNull();
    if (!tree) return;
    expect(tree.nodes.sec.customCode?.enabled).toBe(true);
    expect(tree.nodes.sec.customCode?.html).toBe("<p>hi</p>");
    expect(tree.nodes.sec.customCode?.attributes).toEqual({
      "data-x": "y",
      "aria-label": "w",
      href: "https://example.com",
    });
  });

  it("drops unsafe attribute values (javascript: strings) during normalization", () => {
    const tree = normalizeElementTree(
      rawCustomComponentTree({
        enabled: true,
        attributes: { href: "javascript:alert(1)", "data-x": "ok" },
      }),
    );
    expect(tree).not.toBeNull();
    if (!tree) return;
    // sanitizeJson drops the javascript: value; the safe sibling survives.
    expect(tree.nodes.sec.customCode?.attributes).toEqual({ "data-x": "ok" });
  });

  it("drops the whole customCode field (not the node) when attributes carry an event handler", () => {
    const tree = normalizeElementTree(
      rawCustomComponentTree({
        enabled: true,
        attributes: { onclick: "alert(1)", "data-x": "y" },
      }),
    );
    expect(tree).not.toBeNull();
    if (!tree) return;
    // The event handler fails the schema safety boundary, so the metadata
    // field is dropped while the node survives (normalizer repair policy).
    expect(tree.nodes.sec.customCode).toBeUndefined();
    expect(tree.nodes.sec.id).toBe("sec");
  });
});

// ---------------------------------------------------------------------------
// Registry capability
// ---------------------------------------------------------------------------

describe("elementSupportsCustomCode — registry capability (P23-D)", () => {
  it("is true for the curated leaf content blocks only", () => {
    for (const type of ["heading", "paragraph", "button", "badge", "image", "video", "icon"]) {
      expect(elementSupportsCustomCode(type as never)).toBe(true);
    }
  });

  it("is false for custom-component (not a custom-code vehicle)", () => {
    expect(elementSupportsCustomCode("custom-component")).toBe(false);
  });

  it("is false for every non-leaf type", () => {
    // Element-only types without the flag.
    expect(elementSupportsCustomCode("section")).toBe(false);
    expect(elementSupportsCustomCode("text")).toBe(false);
    expect(elementSupportsCustomCode("logo")).toBe(false);
    // Containers / composites / interactive / navigation — never eligible.
    expect(elementSupportsCustomCode("container")).toBe(false);
    expect(elementSupportsCustomCode("card")).toBe(false);
    expect(elementSupportsCustomCode("form")).toBe(false);
    expect(elementSupportsCustomCode("navbar")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dispatcher smoke (the op kind routes to the same validated engine)
// ---------------------------------------------------------------------------

describe("applyElementOperation — update-custom-code dispatch", () => {
  it("applies the op kind and preserves enabled", () => {
    const result = applyElementOperation(customComponentTree(), {
      kind: "update-custom-code",
      elementId: "cc",
      code: { css: "p {} ", enabled: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tree = result.value as ElementTree;
    expect(tree.nodes.cc.customCode?.enabled).toBe(true);
    expect(tree.nodes.cc.customCode?.css).toBe("p {} ");
  });
});
