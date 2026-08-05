// ---------------------------------------------------------------------------
// Converter orchestrator tests (Phase P2)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";

import { validateTree } from "../../../blocks/engine/nesting-rules";
import { convertImportAnalysis, convertImportedSource } from "../converter-orchestrator";
import { analyseImportSource } from "../../analysis/analyse-import-source";
import { convertSource } from "./test-utils";

const HERO_HTML = `
<section class="hero py-20 px-6">
  <div class="flex items-center gap-8 max-w-xl">
    <h1 class="text-4xl font-bold">Build something great</h1>
    <p class="mt-4 text-lg">A description that tells visitors what you do.</p>
    <a class="btn btn-primary" href="/start">Get started</a>
  </div>
</section>`;

describe("convertImportedSource", () => {
  it("converts HTML into a valid editable block tree", () => {
    const outcome = convertSource(HERO_HTML);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { tree, report } = outcome.value;

    expect(validateTree(tree).valid).toBe(true);
    expect(tree.rootIds.length).toBe(1);
    expect(report.convertedBlockCount).toBeGreaterThan(0);
    expect(report.rootCount).toBe(1);
    expect(report.detectedFramework).toBe("tailwind");
    expect(report.confidence).toBeGreaterThan(0);
    expect(Object.keys(report.blockTypeCounts).length).toBeGreaterThan(0);

    const root = tree.nodes[tree.rootIds[0]];
    expect(root.type).toBe("container");
    expect(root.props.name).toBe("Hero");
    // The inner flex wrapper keeps its flex layout (row nesting rules don't
    // allow heading/paragraph children, so it stays a container).
    const inner = tree.nodes[root.children[0]];
    expect(inner.type).toBe("container");
    expect(inner.style.display).toBe("flex");
    expect(report.warnings.some((w) => w.code === "nesting-downgrade")).toBe(true);
  });

  it("converts JSX without executing it", () => {
    const outcome = convertSource(
      "import { useState } from 'react'; export default function Hero() { const [count, setCount] = useState(0); const title = 'Static'; return (<section className=\"flex\"><h1>{title}</h1><button onClick={handleClick}>{count}</button></section>); }",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { tree, report } = outcome.value;
    expect(validateTree(tree).valid).toBe(true);
    expect(report.detectedFramework).toBe("react-jsx");
    // Hooks + dynamic expressions are never executed — reported instead.
    expect(report.unsupportedConstructs.length).toBeGreaterThan(0);
    expect(
      report.unsupportedConstructs.some((r) => r.code === "hook-usage-unsupported"),
    ).toBe(true);
    // onClick was removed by P1 — surfaced as replaced runtime behavior.
    expect(
      report.replacedRuntimeBehavior.some((r) => r.code === "event-handler-removed"),
    ).toBe(true);
  });

  it("treats CSS-only input as an empty conversion with a report", () => {
    const outcome = convertSource(".hero { color: red; } .card { padding: 1rem; }");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { tree, report } = outcome.value;
    expect(tree.rootIds).toEqual([]);
    expect(report.detectedFramework).toBe("css");
    expect(report.confidence).toBe(0);
    expect(report.convertedBlockCount).toBe(0);
  });

  it("fails with a structured error for empty input", () => {
    const outcome = convertSource("   ");
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("CONVERSION_NOT_ALLOWED");
  });

  it("fails when the analysis cannot continue to conversion", () => {
    const outcome = convertImportAnalysis(analyseImportSource(""));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("CONVERSION_NOT_ALLOWED");
  });
});

describe("convertImportAnalysis", () => {
  it("is deterministic for identical analyses", () => {
    const source = HERO_HTML;
    const first = convertImportedSource(source);
    const second = convertImportedSource(source);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("produces trees that satisfy the Phase O engine invariants", () => {
    const samples = [
      '<div class="flex"><div><h2>A</h2></div><div><p>B</p></div></div>',
      "<form><label>Email</label><input placeholder=\"e\"><button>Send</button></form>",
      "<nav><a href=\"/\">Home</a></nav>",
      '<div class="grid grid-cols-2"><div class="card"><h3>X</h3></div></div>',
      "<ul><li>One</li><li>Two</li></ul>",
      "<header><img src=\"/l.png\" alt=\"Logo\"><nav><a href=\"/\">Home</a></nav></header>",
    ];
    for (const sample of samples) {
      const outcome = convertSource(sample);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(validateTree(outcome.value.tree).valid).toBe(true);
    }
  });
});

describe("report contents", () => {
  it("reports replaced runtime behavior for event handlers", () => {
    const outcome = convertSource('<button onclick="doThing()">Go</button>');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.value.report.replacedRuntimeBehavior.some((r) => r.code === "event-handler-removed"),
    ).toBe(true);
  });

  it("reports ignored external imports in JSX", () => {
    const outcome = convertSource(
      "import { useState } from 'react';\nexport default () => <div><h1>Hi</h1></div>;",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.value.report.ignoredCode.some((r) => r.code === "external-import-ignored"),
    ).toBe(true);
  });

  it("reports unsupported hooks", () => {
    const outcome = convertSource(
      "export default () => { const [x, setX] = useState(0); return <div>{x}</div>; };",
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(
      outcome.value.report.unsupportedConstructs.some((r) => r.code === "hook-usage-unsupported"),
    ).toBe(true);
  });
});
