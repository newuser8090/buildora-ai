// ---------------------------------------------------------------------------
// Phase P24-C — durable section-tree custom-code export
//
// Covers (docs/phase-p24c-spec.md, decisions D4/D5, REQ-5..REQ-9):
//   - custom code on a NESTED node of a durable `section.tree` is discovered
//     recursively and emitted as a validated sandboxed srcdoc
//   - the section is exported through the bounded tree runtime and the
//     `srcdocs` map travels with it
//   - REQ-6 anti-regression: the export projection PRESERVES customCode (and
//     viewport/animation/interaction), unlike `elementTreeToBlockTree()`
//   - disabled / schema-invalid custom code emits NOTHING
//   - the emitted srcdoc is the authoritative builder's (re-validated +
//     re-clamped) document, never the stored bytes
//   - sections without enabled custom code keep byte-identical props output
//   - the parent page never contains directly executable user code
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import type { BaseSection } from "@/types/section";
import type { ElementCustomCode, ElementTree } from "@/features/elements/types";
import type { BlockTree } from "@/features/blocks/types";
import { computePageRoutes } from "@/features/routing/routes";
import { buildValidatedCustomCodeSrcdoc } from "@/features/elements/custom-code/srcdoc";
import { elementTreeToBlockTree } from "@/features/elements/adapters/section-element-adapter";
import { ELEMENT_MAX_CUSTOM_CODE_LENGTH } from "@/features/elements/schemas/element-schemas";
import { generatePageFile } from "../generators/page-generator";
import { generateExportProject } from "../generators/project-generator";
import { generateCustomBlockComponent } from "../generators/section-generators/custom-block-generator";
import {
  buildSrcdocsForTreeRecord,
  projectNodeForExport,
  projectSectionTreeForExport,
} from "../generators/section-tree-export";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ENABLED_CODE: ElementCustomCode = {
  enabled: true,
  css: ".hero-note { color: #7c5cfc; }",
  js: "console.log('p24c-hero')",
  html: "<span class=\"hero-note\">Made with custom code</span>",
};

/**
 * The exported tree is block-shaped, so its optional runtime keys (customCode,
 * viewport, animation) are read through a narrow cast in assertions — the
 * editor BlockNode type does not model them, but the generated BlockNode does.
 */
function nodeOf(tree: BlockTree, id: string): Record<string, unknown> {
  return tree.nodes[id] as unknown as Record<string, unknown>;
}

/** A durable-tree hero whose NESTED heading carries custom code. */
function durableHeroTree(customCode?: ElementCustomCode): ElementTree {
  return {
    rootIds: ["s-hero"],
    nodes: {
      "s-hero": {
        id: "s-hero",
        type: "container",
        parentId: null,
        children: ["h-hero"],
        props: { _sectionType: "hero", _sectionId: "s-hero" },
        style: {},
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
      },
      "h-hero": {
        id: "h-hero",
        type: "heading",
        parentId: "s-hero",
        children: [],
        props: { text: "Durable headline", level: 1 },
        style: { fontSize: 40 },
        responsive: {},
        visible: true,
        locked: false,
        hidden: false,
        // Runtime-consumed element-only fields the export must PRESERVE.
        viewport: { mobile: { fontSize: 28 } },
        animation: { trigger: "load", type: "fade" },
        interaction: { hover: { scale: 1.05 } },
        // Element-only fields with no export consumer (dropped by projection).
        geometry: { mode: "absolute", x: 4, y: 8, width: 120, height: 48, rotation: 2, zIndex: 3 },
        binding: { source: "page", field: "title" },
        a11y: { alt: "headline" },
        ...(customCode === undefined ? {} : { customCode }),
      },
    },
  };
}

function heroSection(id: string, overrides: Partial<BaseSection> = {}): BaseSection {
  return {
    id,
    type: "hero",
    order: 1,
    visible: true,
    props: {
      headline: "Durable headline",
      subheadline: "",
      primaryCta: { text: "Go", href: "#" },
    },
    styles: {},
    ...overrides,
  };
}

function customBlockSection(id: string, order: number): BaseSection {
  return {
    id,
    type: CUSTOM_BLOCK_SECTION_TYPE,
    order,
    visible: true,
    props: {
      name: "Design",
      tree: {
        rootIds: [id],
        nodes: {
          [id]: {
            id,
            type: "container",
            parentId: null,
            children: ["cb-h"],
            props: {},
            style: {},
            responsive: {},
            visible: true,
            locked: false,
            hidden: false,
          },
          "cb-h": {
            id: "cb-h",
            type: "heading",
            parentId: id,
            children: [],
            props: { text: "Imported" },
            style: {},
            responsive: {},
            visible: true,
            locked: false,
            hidden: false,
            customCode: ENABLED_CODE,
          },
        },
      },
    },
    styles: {},
  };
}

function makeProject(sections: BaseSection[]): Project {
  return {
    id: "proj-p24c",
    name: "P24C Export",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "a", md: "b", lg: "c", xl: "d", full: "e" },
      shadows: { sm: "a", md: "b", lg: "c", xl: "d" },
    },
    assets: [],
    pages: [{ id: "page-1", title: "Home", slug: "/", sections }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** Render the home page module for a set of sections. */
function renderHome(sections: BaseSection[]): string {
  const project = makeProject(sections);
  const routes = computePageRoutes(project.pages);
  return generatePageFile(project, project.pages[0], routes).content;
}

const encodedSrcdoc = (code: unknown) => {
  const srcdoc = buildValidatedCustomCodeSrcdoc(code);
  expect(srcdoc).not.toBeNull();
  return JSON.stringify(srcdoc).replace(/</g, "\\u003c");
};

// ---------------------------------------------------------------------------
// Projection (REQ-6)
// ---------------------------------------------------------------------------

describe("projectSectionTreeForExport — custom code preserved (P24-C REQ-6)", () => {
  it("keeps the custom-code opt-in flag on nested nodes", () => {
    const tree = projectSectionTreeForExport(durableHeroTree(ENABLED_CODE));
    expect(nodeOf(tree, "h-hero").customCode).toEqual({ enabled: true });
    // The flag ONLY — no code text ever reaches the emitted tree.
    expect(JSON.stringify(tree)).not.toContain("p24c-hero");
    expect(JSON.stringify(tree)).not.toContain("hero-note { color");
  });

  it("drops customCode that is disabled or absent", () => {
    expect(
      nodeOf(projectSectionTreeForExport(durableHeroTree({ css: ".x{}", js: "y()" })), "h-hero")
        .customCode,
    ).toBeUndefined();
    expect(
      nodeOf(projectSectionTreeForExport(durableHeroTree({ enabled: false, js: "y()" })), "h-hero")
        .customCode,
    ).toBeUndefined();
    expect(
      nodeOf(projectSectionTreeForExport(durableHeroTree()), "h-hero").customCode,
    ).toBeUndefined();
  });

  it("preserves the runtime-consumed element-only fields and drops the rest", () => {
    const node = projectNodeForExport(durableHeroTree(ENABLED_CODE).nodes["h-hero"]);
    // Consumed by the generated block runtime → preserved.
    expect(node.viewport).toEqual({ mobile: { fontSize: 28 } });
    expect(node.animation).toEqual({ trigger: "load", type: "fade" });
    expect(node.interaction).toEqual({ hover: { scale: 1.05 } });
    expect(node.style).toEqual({ fontSize: 40 });
    // No export-side consumer → dropped (keeps the emitted module type-safe).
    expect(node.geometry).toBeUndefined();
    expect(node.binding).toBeUndefined();
    expect(node.a11y).toBeUndefined();
  });

  it("REGRESSION GUARD: elementTreeToBlockTree strips customCode (never use it here)", () => {
    // This documents WHY the export projection exists: the general element→block
    // downcast deletes customCode (plus viewport/animation/interaction), which
    // would silently drop the payload this phase exports.
    const stripped = elementTreeToBlockTree(durableHeroTree(ENABLED_CODE));
    expect(nodeOf(stripped, "h-hero").customCode).toBeUndefined();
    expect(nodeOf(stripped, "h-hero").viewport).toBeUndefined();
    expect(nodeOf(stripped, "h-hero").animation).toBeUndefined();
    // ...whereas the export projection keeps all of it.
    const projected = projectSectionTreeForExport(durableHeroTree(ENABLED_CODE));
    expect(nodeOf(projected, "h-hero").customCode).toEqual({ enabled: true });
    expect(nodeOf(projected, "h-hero").viewport).toBeDefined();
  });

  it("does not mutate the source tree", () => {
    const source = durableHeroTree(ENABLED_CODE);
    const snapshot = JSON.stringify(source);
    projectSectionTreeForExport(source);
    expect(JSON.stringify(source)).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// Discovery (any tree shape, any nesting)
// ---------------------------------------------------------------------------

describe("buildSrcdocsForTreeRecord — custom-code discovery (P24-C)", () => {
  it("finds enabled custom code on a nested node of a durable section tree", () => {
    const srcdocs = buildSrcdocsForTreeRecord(durableHeroTree(ENABLED_CODE));
    expect(srcdocs).not.toBeNull();
    expect(Object.keys(srcdocs!)).toEqual(["h-hero"]);
    expect(srcdocs!["h-hero"]).toBe(buildValidatedCustomCodeSrcdoc(ENABLED_CODE));
  });

  it("returns null for trees with no enabled custom code", () => {
    expect(buildSrcdocsForTreeRecord(durableHeroTree())).toBeNull();
    expect(buildSrcdocsForTreeRecord(durableHeroTree({ css: ".x{}" }))).toBeNull();
    expect(buildSrcdocsForTreeRecord(durableHeroTree({ enabled: false, js: "y()" }))).toBeNull();
  });

  it("returns null for malformed tree shapes (never throws)", () => {
    expect(buildSrcdocsForTreeRecord(null)).toBeNull();
    expect(buildSrcdocsForTreeRecord(undefined)).toBeNull();
    expect(buildSrcdocsForTreeRecord("nope")).toBeNull();
    expect(buildSrcdocsForTreeRecord([])).toBeNull();
    expect(buildSrcdocsForTreeRecord({})).toBeNull();
    expect(buildSrcdocsForTreeRecord({ nodes: [] })).toBeNull();
    expect(buildSrcdocsForTreeRecord({ nodes: { a: null, b: 7, c: "x" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Page emission (REQ-5)
// ---------------------------------------------------------------------------

describe("generatePageFile — durable section tree custom code (P24-C REQ-5)", () => {
  it("emits the tree runtime with the validated srcdocs map for a durable hero", () => {
    const content = renderHome([heroSection("s-hero", { tree: durableHeroTree(ENABLED_CODE) })]);

    // The section is exported through the tree runtime, not the props component.
    expect(content).toContain('import { CustomBlock } from "@/components/sections/custom-block";');
    expect(content).not.toContain('import { Hero }');
    expect(content).toContain('<CustomBlock key="s-hero"');
    expect(content).toContain(`srcdocs={{"h-hero":${encodedSrcdoc(ENABLED_CODE)}}}`);
    // NavTarget resolution needs the page route map.
    expect(content).toContain("routes={");
  });

  it("emits the check only for enabled, schema-valid code", () => {
    const valid = renderHome([heroSection("s-hero", { tree: durableHeroTree(ENABLED_CODE) })]);

    // Disabled (legacy, no `enabled`) → nothing.
    const disabled = renderHome([
      heroSection("s-hero", { tree: durableHeroTree({ css: ".x{}", js: "y()" }) }),
    ]);
    expect(disabled).not.toContain("srcdocs=");
    expect(disabled).not.toContain("CustomBlock");

    // Explicitly disabled → nothing.
    const off = renderHome([
      heroSection("s-hero", { tree: durableHeroTree({ enabled: false, js: "y()" }) }),
    ]);
    expect(off).not.toContain("srcdocs=");

    // Schema-invalid (per-field cap exceeded) → nothing at all.
    const oversized = renderHome([
      heroSection("s-hero", {
        tree: durableHeroTree({ enabled: true, html: "a".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 1) }),
      }),
    ]);
    expect(oversized).not.toContain("srcdocs=");
    expect(oversized).toContain('import { Hero }');

    expect(valid).not.toBe(disabled);
  });

  it("emits the authoritative builder's document — stored bytes are re-validated and re-clamped", () => {
    // A MAX-SIZE but valid payload: emitted intact, and byte-identical to the
    // authoritative builder's own clamping output.
    const maxHtml = "<p>" + "a".repeat(ELEMENT_MAX_CUSTOM_CODE_LENGTH - 8) + "</p>";
    expect(maxHtml.length).toBeLessThanOrEqual(ELEMENT_MAX_CUSTOM_CODE_LENGTH);
    const payload = { enabled: true, html: maxHtml };
    const content = renderHome([heroSection("s-hero", { tree: durableHeroTree(payload) })]);

    const srcdoc = buildValidatedCustomCodeSrcdoc(payload);
    expect(srcdoc).not.toBeNull();
    expect(content).toContain(JSON.stringify(srcdoc).replace(/</g, "\\u003c"));
    // Bounded: the emitted frame document never exceeds the payload cap plus
    // the fixed sandbox shell.
    expect(srcdoc!.length).toBeLessThan(ELEMENT_MAX_CUSTOM_CODE_LENGTH + 5_000);
  });

  it("keeps the parent page free of directly executable user code", () => {
    const content = renderHome([heroSection("s-hero", { tree: durableHeroTree(ENABLED_CODE) })]);

    expect(content).not.toContain("<script");
    expect(content).not.toContain("<style");
    expect(content).not.toContain("dangerouslySetInnerHTML");
    expect(content).not.toContain("eval(");
    expect(content).not.toContain("new Function");
    // The user JS survives ONLY inside the \u003c-escaped srcdoc data.
    expect(content).toContain("\\u003cscript>console.log('p24c-hero')");
    // The emitted tree carries the flag, never the code text.
    expect(content).toContain('"customCode":{"enabled":true}');
    expect(content).not.toContain("\\\"css\\\"");
  });

  it("leaves a durable section WITHOUT custom code on its props-driven component (byte-identical)", () => {
    const withTreeNoCode = renderHome([heroSection("s-hero", { tree: durableHeroTree() })]);
    const legacyProps = renderHome([heroSection("s-hero")]);

    expect(withTreeNoCode).toContain('import { Hero }');
    expect(withTreeNoCode).not.toContain("CustomBlock");
    expect(withTreeNoCode).not.toContain("srcdocs=");
    // The durable tree without custom code does not change the export at all.
    expect(withTreeNoCode).toBe(legacyProps);
  });

  it("imports the tree runtime once when a page mixes custom-block and durable-tree sections", () => {
    const content = renderHome([
      customBlockSection("s-custom", 1),
      heroSection("s-hero", { order: 2, tree: durableHeroTree(ENABLED_CODE) }),
    ]);

    const importCount = content.split('import { CustomBlock } from "@/components/sections/custom-block";').length - 1;
    expect(importCount).toBe(1);
    expect(content).toContain("srcdocs=");
    expect(content).toContain('key="s-custom"');
    expect(content).toContain('key="s-hero"');
  });

  it("emits each enabled node's own srcdoc (two nodes, two independent frames)", () => {
    const tree = durableHeroTree(ENABLED_CODE);
    const second = { ...ENABLED_CODE, html: "<span>second</span>", js: "console.log('second')" };
    tree.nodes["p-hero"] = {
      id: "p-hero",
      type: "paragraph",
      parentId: "s-hero",
      children: [],
      props: { text: "Second" },
      style: {},
      responsive: {},
      visible: true,
      locked: false,
      hidden: false,
      customCode: second,
    };
    tree.nodes["s-hero"].children = ["h-hero", "p-hero"];

    const content = renderHome([heroSection("s-hero", { tree })]);

    expect(content).toContain(`"h-hero":${encodedSrcdoc(ENABLED_CODE)}`);
    expect(content).toContain(`"p-hero":${encodedSrcdoc(second)}`);
    expect(encodedSrcdoc(ENABLED_CODE)).not.toBe(encodedSrcdoc(second));
  });
});

// ---------------------------------------------------------------------------
// Generated type fidelity (P24-C closeout)
//
// A section exported through the tree runtime emits the editor's FULL P22-G
// interaction data. The generated BlockNode declaration must therefore accept
// every authored interaction target, or the generated site fails its own
// type-check on valid data. These assertions pin the declaration so it cannot
// silently regress to a narrower shape.
// ---------------------------------------------------------------------------

describe("generated BlockNode — P22-G interaction type fidelity (P24-C closeout)", () => {
  it("declares every authored click-action target", () => {
    const { content } = generateCustomBlockComponent();
    // navigate/scroll-to/toggle/open-modal/start-animation use target/elementId;
    // submit-form and custom add their own target field.
    expect(content).toContain("elementId?: string;");
    expect(content).toContain("formId?: string;");
    expect(content).toContain("handlerId?: string;");
  });

  it("declares the sticky/parallax scroll options", () => {
    const { content } = generateCustomBlockComponent();
    expect(content).toContain("offset?: number;");
    expect(content).toContain("speed?: number;");
  });

  it("declares the nested hover/focus animations", () => {
    const { content } = generateCustomBlockComponent();
    // hover, focus and scroll each accept an embedded animation payload.
    const occurrences = content.split("animation?: Record<string, unknown>;").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });

  it("keeps the widening type-only — the runtime still resolves a bounded set", () => {
    const { content } = generateCustomBlockComponent();
    // The sandbox capability model and the runtime entry points are unchanged.
    expect(content).toContain("function CustomCodeFrame");
    expect(content).toContain("event.source !== iframe.contentWindow");
    expect(content).not.toContain("allow-same-origin");
    expect(content).not.toContain("eval(");
  });
});

// ---------------------------------------------------------------------------
// Export pipeline (REQ-5 end-to-end)
// ---------------------------------------------------------------------------

describe("export pipeline — durable section tree custom code (P24-C)", () => {
  it("emits the page srcdocs plus the sandboxed tree component", () => {
    const { files } = generateExportProject(
      makeProject([heroSection("s-hero", { tree: durableHeroTree(ENABLED_CODE) })]),
    );
    const page = files.find((f) => f.path === "app/page.tsx");
    const component = files.find((f) => f.path === "components/sections/custom-block.tsx");

    expect(page?.content).toContain("srcdocs={");
    expect(page?.content).toContain("<CustomBlock");
    expect(component?.content).toContain("function CustomCodeFrame");
    expect(component?.content).toContain("sandbox={CUSTOM_CODE_SANDBOX}");
    // The sandbox capability model is unchanged by this phase.
    expect(component?.content).not.toContain("allow-same-origin");
  });

  it("keeps a project with no custom code free of tree-runtime emission", () => {
    const { files } = generateExportProject(
      makeProject([heroSection("s-hero", { tree: durableHeroTree() })]),
    );
    const page = files.find((f) => f.path === "app/page.tsx");
    expect(page?.content).toContain("<Hero");
    expect(page?.content).not.toContain("srcdocs=");
  });
});
