// ---------------------------------------------------------------------------
// Phase P23-C — custom-code export
//   - enabled customCode produces EXACTLY ONE srcdoc entry (per enabled node)
//   - disabled customCode produces NO srcdoc entry
//   - malformed customCode produces NO runtime
//   - the srcdoc is generated through the authoritative builder
//   - the generated component renders a sandboxed iframe (allow-scripts only,
//     srcDoc, no allow-same-origin, no eval / new Function / innerHTML)
//   - the generated parent page contains no direct user script/style/html
//   - existing custom-block output stays behaviorally unchanged without
//     enabled custom code
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { Project } from "@/types/project";
import type { BlockTree } from "@/features/blocks/types";
import { generateCustomBlockComponent } from "../generators/section-generators/custom-block-generator";
import { generatePageFile, generatePageRoutes } from "../generators/page-generator";
import { generateExportProject } from "../generators/project-generator";
import { computePageRoutes } from "@/features/routing/routes";
import {
  buildCustomCodeDocument,
  buildValidatedCustomCodeSrcdoc,
} from "@/features/elements/custom-code/srcdoc";
import { SANDBOX_POLICY } from "@/features/elements/custom-code/sandbox-policy";
import {
  HEARTBEAT_DEFAULTS,
  MAX_RECOVERY_ATTEMPTS,
  RUNTIME_MESSAGE_TYPES,
} from "@/features/elements/custom-code/constants";
import { CUSTOM_BLOCK_SECTION_TYPE } from "@/features/code-import/schemas/custom-block-schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeNode(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "container",
    parentId: null,
    children: [],
    props: {},
    style: {},
    responsive: {},
    visible: true,
    locked: false,
    hidden: false,
    ...overrides,
  };
}

function treeWithNodes(nodes: Record<string, unknown>): BlockTree {
  return {
    rootIds: Object.keys(nodes),
    nodes: nodes as unknown as BlockTree["nodes"],
  };
}

const ENABLED = {
  enabled: true,
  css: "p { color: red; }",
  js: "console.log('p23c')",
  html: "<span>hello</span>",
};

function makeProject(tree: BlockTree): Project {
  return {
    id: "proj-p23c-export",
    name: "P23C Export",
    theme: {
      palette: {
        background: "#ffffff", foreground: "#0a0a0a", primary: "#7c5cfc",
        primaryForeground: "#ffffff", secondary: "#f5f5f5", secondaryForeground: "#0a0a0a",
        muted: "#f5f5f5", mutedForeground: "#737373", accent: "#7c5cfc",
        accentForeground: "#ffffff", border: "#e5e5e5", card: "#ffffff", cardForeground: "#0a0a0a",
      },
      typography: { fontFamily: "Geist", headingFont: "Geist", baseSize: "16px", scale: 1.25 },
      spacing: { sectionPadding: "6rem 0", containerMaxWidth: "1120px", gap: "1.5rem" },
      radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", xl: "1rem", full: "9999px" },
      shadows: { sm: "0 1px 2px rgba(0,0,0,0.05)", md: "0 4px 6px rgba(0,0,0,0.07)", lg: "0 10px 15px rgba(0,0,0,0.1)", xl: "0 20px 25px rgba(0,0,0,0.15)" },
    },
    assets: [],
    pages: [
      {
        id: "page-1",
        title: "Home",
        slug: "/",
        sections: [
          {
            id: "s-custom",
            type: CUSTOM_BLOCK_SECTION_TYPE,
            order: 1,
            visible: true,
            props: { name: "Design", tree },
            styles: {},
          },
        ],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Page generator — srcdocs prop
// ---------------------------------------------------------------------------

describe("generatePageFile — srcdocs prop (P23-C)", () => {
  it("enabled customCode produces exactly one srcdoc entry for the enabled node", () => {
    const tree = treeWithNodes({
      n1: makeNode("n1", { customCode: ENABLED }),
      n2: makeNode("n2", { customCode: { css: "p{}" } }), // disabled (legacy)
      n3: makeNode("n3", { type: "heading", children: [], props: { text: "plain" } }),
    });
    const routes = computePageRoutes(makeProject(tree).pages);
    const page = generatePageFile(makeProject(tree), makeProject(tree).pages[0], routes);

    expect(countOccurrences(page.content, "srcdocs={")).toBe(1);
    // The entry is exactly the authoritative builder's document, encoded with
    // every "<" escaped to its \u003c JSON escape.
    const expected = buildValidatedCustomCodeSrcdoc(ENABLED);
    expect(expected).not.toBeNull();
    const encoded = JSON.stringify(expected).replace(/</g, "\\u003c");
    expect(page.content).toContain(`srcdocs={{"n1":${encoded}}}`);
  });

  it("disabled customCode produces no srcdoc entry", () => {
    const tree = treeWithNodes({
      n1: makeNode("n1", { customCode: { css: "p{}" } }), // legacy — no enabled
      n2: makeNode("n2", { customCode: { enabled: false, js: "x()" } }),
    });
    const routes = computePageRoutes(makeProject(tree).pages);
    const page = generatePageFile(makeProject(tree), makeProject(tree).pages[0], routes);
    expect(page.content).not.toContain("srcdocs=");
  });

  it("malformed customCode produces no runtime", () => {
    const tree = treeWithNodes({
      n1: makeNode("n1", { customCode: { enabled: true, js: "x".repeat(20_001) } }),
    });
    const routes = computePageRoutes(makeProject(tree).pages);
    const page = generatePageFile(makeProject(tree), makeProject(tree).pages[0], routes);
    expect(page.content).not.toContain("srcdocs=");
  });

  it("srcdoc documents are generated through the authoritative builder", () => {
    const tree = treeWithNodes({ n1: makeNode("n1", { customCode: ENABLED }) });
    const routes = computePageRoutes(makeProject(tree).pages);
    const page = generatePageFile(makeProject(tree), makeProject(tree).pages[0], routes);
    const expected = buildCustomCodeDocument({ ...ENABLED });
    expect(expected).not.toBeNull();
    const encoded = JSON.stringify(expected).replace(/</g, "\\u003c");
    expect(page.content).toContain(encoded);
  });

  it("every emitted srcdoc carries the child-side runtime shell (P23-G)", () => {
    const tree = treeWithNodes({ n1: makeNode("n1", { customCode: ENABLED }) });
    const routes = computePageRoutes(makeProject(tree).pages);
    const page = generatePageFile(makeProject(tree), makeProject(tree).pages[0], routes);

    // The shell script is part of the validated document, delivered as
    // \u003c-escaped JSON — it never appears as literal markup in the parent
    // page, and it reports only the allowed message types.
    expect(page.content).toContain("\\u003cscript>(function () {");
    expect(page.content).toContain("window.parent.postMessage");
    expect(page.content).toContain("buildora:ready");
    expect(page.content).toContain("buildora:height");
    expect(page.content).toContain("buildora:error");
  });

  it("the generated parent page contains no direct user script/style/html execution", () => {
    const tree = treeWithNodes({ n1: makeNode("n1", { customCode: ENABLED }) });
    const routes = computePageRoutes(makeProject(tree).pages);
    const page = generatePageFile(makeProject(tree), makeProject(tree).pages[0], routes);

    // User code lives ONLY inside the \u003c-escaped srcdoc data — the parent
    // page contains no literal script/style elements and no exec mechanisms.
    expect(page.content).not.toContain("<script");
    expect(page.content).not.toContain("<style");
    expect(page.content).not.toContain("dangerouslySetInnerHTML");
    expect(page.content).not.toContain("eval(");
    expect(page.content).not.toContain("new Function");
    // The emitted tree carries no code text — only the opt-in flag.
    expect(page.content).not.toContain("customCode\":{\"css\"");
    // The user JS survives ONLY as the \u003c-escaped srcdoc data ("<" is
    // escaped; the rest of the document is ordinary JSON text).
    expect(page.content).toContain("\\u003cscript>console.log('p23c')");
  });

  it("existing custom-block output is unchanged without enabled custom code", () => {
    const plainTree = treeWithNodes({ n1: makeNode("n1", { props: { text: "Hi" } }) });
    const disabledTree = treeWithNodes({
      n1: makeNode("n1", { props: { text: "Hi" }, customCode: { css: "p{}", js: "x()" } }),
    });
    const routes = computePageRoutes(makeProject(plainTree).pages);
    const plainPage = generatePageFile(makeProject(plainTree), makeProject(plainTree).pages[0], routes);
    const disabledPage = generatePageFile(makeProject(disabledTree), makeProject(disabledTree).pages[0], routes);

    expect(plainPage.content).not.toContain("srcdocs=");
    expect(disabledPage.content).not.toContain("srcdocs=");
    expect(disabledPage.content).not.toContain("customCode");
    // Byte-identical: the disabled customCode is dropped from the emitted tree.
    expect(plainPage.content).toBe(disabledPage.content);
  });
});

// ---------------------------------------------------------------------------
// Generated component — CustomCodeFrame
// ---------------------------------------------------------------------------

describe("generateCustomBlockComponent — CustomCodeFrame (P23-C)", () => {
  it("emits a sandboxed iframe that uses the authoritative sandbox policy", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("function CustomCodeFrame");
    expect(file.content).toContain("sandbox={CUSTOM_CODE_SANDBOX}");
    expect(file.content).toContain("srcDoc={srcDoc}");
    // The sandbox constant comes from the P23-B authoritative policy.
    expect(file.content).toContain(
      `const CUSTOM_CODE_SANDBOX = ${JSON.stringify(SANDBOX_POLICY)};`,
    );
    expect(file.content).toContain("node.customCode?.enabled === true ? srcdocs[node.id] : undefined");
  });

  it("never weakens the sandbox or injects code into the parent document", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).not.toContain("allow-same-origin");
    expect(file.content).not.toContain("allow-popups");
    expect(file.content).not.toContain("dangerouslySetInnerHTML");
    expect(file.content).not.toContain("innerHTML");
    expect(file.content).not.toContain("eval(");
    expect(file.content).not.toContain("new Function");
    expect(file.content).not.toContain("<script");
  });
});

// ---------------------------------------------------------------------------
// Generated component — P23-G runtime lifecycle hardening
// ---------------------------------------------------------------------------

describe("generateCustomBlockComponent — runtime hardening (P23-G)", () => {
  it("emits the runtime protocol + heartbeat constants in lockstep with the editor", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain(
      `const CUSTOM_CODE_MESSAGE_TYPES = ${JSON.stringify(RUNTIME_MESSAGE_TYPES)};`,
    );
    expect(file.content).toContain(
      `const CUSTOM_CODE_HEARTBEAT = ${JSON.stringify(HEARTBEAT_DEFAULTS)};`,
    );
    expect(file.content).toContain(
      `const CUSTOM_CODE_MAX_RECOVERY_ATTEMPTS = ${JSON.stringify(MAX_RECOVERY_ATTEMPTS)};`,
    );
  });

  it("keyed remounts — a payload change deterministically disposes the old runtime", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("<CustomCodeFrame key={srcdoc} srcDoc={srcdoc} />");
  });

  it("validates message source identity before accepting anything", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("event.source !== iframe.contentWindow");
  });

  it("rejects unknown/malformed messages (allow-listed shape only)", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("const parseMessage");
    expect(file.content).toContain("Array.isArray(data)");
    expect(file.content).toContain("CUSTOM_CODE_MAX_FRAME_HEIGHT_PX");
    expect(file.content).toContain("CUSTOM_CODE_MAX_ERROR_MESSAGE_LENGTH");
  });

  it("bounds recovery and cleans up every listener/timer on unmount", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("recoveryAttempts >= CUSTOM_CODE_MAX_RECOVERY_ATTEMPTS");
    expect(file.content).toContain("window.removeEventListener(\"message\", onMessage)");
    expect(file.content).toContain("clearTimeout(timer)");
  });

  it("exposes the runtime status/error state without changing the sandbox", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("data-buildora-status={runtimeStatus}");
    expect(file.content).toContain("data-buildora-error={runtimeError ? \"1\" : undefined}");
    expect(file.content).not.toContain("allow-same-origin");
    expect(file.content).not.toContain("allow-popups");
  });
});

// ---------------------------------------------------------------------------
// Generated component — P23-H safe observability
// ---------------------------------------------------------------------------

describe("generateCustomBlockComponent — safe observability (P23-H)", () => {
  it("exposes bounded, sanitized state via data attributes", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("data-buildora-status={runtimeStatus}");
    expect(file.content).toContain("data-buildora-error={runtimeError ? \"1\" : undefined}");
    expect(file.content).toContain("data-buildora-height={frameHeight === null ? undefined : frameHeight}");
  });

  it("never leaks raw exception data into the observability surface", () => {
    const file = generateCustomBlockComponent();
    // The mirror records ONLY a boolean error flag — the sanitized message
    // and stack are validated internally but never rendered or emitted.
    expect(file.content).toContain("setRuntimeError(true)");
    expect(file.content).not.toContain("data-buildora-error-message");
    expect(file.content).not.toContain("data-buildora-error-stack");
    expect(file.content).not.toContain("data-buildora-last-error");
  });

  it("the exported runtime is self-contained — no editor-only imports leak", () => {
    const file = generateCustomBlockComponent();
    // The ONLY module import is React — nothing from the editor codebase
    // (the `custom-code/...` text that appears in comments is documentation,
    // not an import).
    const importLines = file.content
      .split("\n")
      .filter((line) => /^import\s/.test(line.trim()));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toBe('import { useEffect, useMemo, useRef, useState } from "react";');
    expect(file.content).not.toContain('from "@/');
  });

  it("keeps the sandbox + runtime guarantees intact", () => {
    const file = generateCustomBlockComponent();
    expect(file.content).toContain("sandbox={CUSTOM_CODE_SANDBOX}");
    expect(file.content).toContain("event.source !== iframe.contentWindow");
    expect(file.content).toContain("recoveryAttempts >= CUSTOM_CODE_MAX_RECOVERY_ATTEMPTS");
    expect(file.content).not.toContain("allow-same-origin");
    expect(file.content).not.toContain("allow-popups");
    expect(file.content).not.toContain("eval(");
    expect(file.content).not.toContain("new Function");
    expect(file.content).not.toContain("dangerouslySetInnerHTML");
  });
});

// ---------------------------------------------------------------------------
// Export pipeline
// ---------------------------------------------------------------------------

describe("export pipeline — custom code (P23-C)", () => {
  it("emits the srcdocs page data and the sandboxed frame component", () => {
    const tree = treeWithNodes({ n1: makeNode("n1", { customCode: ENABLED }) });
    const { files } = generateExportProject(makeProject(tree));
    const page = files.find((f) => f.path === "app/page.tsx");
    const component = files.find((f) => f.path === "components/sections/custom-block.tsx");

    expect(page?.content).toContain("srcdocs={");
    expect(component?.content).toContain("function CustomCodeFrame");
    expect(component?.content).toContain("sandbox={CUSTOM_CODE_SANDBOX}");
  });

  it("multi-page generation keeps srcdocs per custom-block section", () => {
    const tree = treeWithNodes({ n1: makeNode("n1", { customCode: ENABLED }) });
    const files = generatePageRoutes(makeProject(tree));
    const page = files.find((f) => f.path === "app/page.tsx");
    expect(page?.content).toContain("srcdocs={");
    expect(page?.content).toContain('import { CustomBlock } from "@/components/sections/custom-block";');
  });
});
