import { describe, expect, it } from "vitest";

import { analyseImportSource } from "../analysis/analyse-import-source";
import {
  CODE_IMPORT_EMPTY,
  CODE_IMPORT_TOO_LARGE,
  CODE_LANGUAGE_UNKNOWN,
  CODE_PARSE_FAILED,
  FINDING_SCRIPT_REMOVED,
  MAX_SOURCE_SIZE_BYTES,
} from "../constants";
import { makeIdFactory } from "./test-utils";

describe("analyseImportSource", () => {
  it("analyses an HTML source end to end", () => {
    const result = analyseImportSource(
      '<div class="hero"><h1>Hello</h1></div>',
    );
    expect(result.detectedLanguage).toBe("html");
    expect(result.canContinueToConversion).toBe(true);
    expect(result.syntaxErrors).toHaveLength(0);
    expect(result.rootNodes).toHaveLength(1);
    expect(result.stats.elementCount).toBe(2);
    expect(result.stats.textNodeCount).toBe(1);
    expect(result.stats.nodeCount).toBe(3);
    expect(result.stats.attributeCount).toBe(0); // class moves into classNames
    expect(result.stats.classTokenCount).toBe(1);
    expect(result.stats.maxDepth).toBe(3);
    expect(result.stats.cssRuleCount).toBe(0);
  });

  it("analyses a JSX source", () => {
    const result = analyseImportSource('<div className="x">Hi</div>');
    expect(result.detectedLanguage).toBe("jsx");
    expect(result.canContinueToConversion).toBe(true);
    const div = result.rootNodes[0] as { tagName: string; classNames: string[] };
    expect(div.tagName).toBe("div");
    expect(div.classNames).toEqual(["x"]);
  });

  it("analyses a React component source", () => {
    const result = analyseImportSource(
      "function Card() { return (<div className=\"card\"><h2>Hello</h2></div>); }",
    );
    expect(result.detectedLanguage).toBe("react");
    expect(result.canContinueToConversion).toBe(true);
  });

  it("analyses a CSS source", () => {
    const result = analyseImportSource(".a { color: red; }");
    expect(result.detectedLanguage).toBe("css");
    expect(result.stats.cssRuleCount).toBe(1);
    expect(result.stats.cssDeclarationCount).toBe(1);
    expect(result.rootNodes).toHaveLength(0);
    expect(result.canContinueToConversion).toBe(true);
  });

  it("reports unknown text with CODE_LANGUAGE_UNKNOWN", () => {
    const result = analyseImportSource("Just some plain words.");
    expect(result.detectedLanguage).toBe("unknown");
    expect(result.canContinueToConversion).toBe(false);
    expect(result.syntaxErrors[0].code).toBe(CODE_LANGUAGE_UNKNOWN);
  });

  it("rejects empty and whitespace-only input", () => {
    expect(analyseImportSource("").syntaxErrors[0].code).toBe(CODE_IMPORT_EMPTY);
    expect(analyseImportSource("   \n  ").syntaxErrors[0].code).toBe(CODE_IMPORT_EMPTY);
  });

  it("rejects oversized input with limit + actual", () => {
    const source = "a".repeat(MAX_SOURCE_SIZE_BYTES + 1);
    const result = analyseImportSource(source);
    expect(result.syntaxErrors[0].code).toBe(CODE_IMPORT_TOO_LARGE);
    expect(result.syntaxErrors[0].limit).toBe(MAX_SOURCE_SIZE_BYTES);
    expect(result.syntaxErrors[0].actual).toBe(MAX_SOURCE_SIZE_BYTES + 1);
    expect(result.sourceSize).toBe(MAX_SOURCE_SIZE_BYTES + 1);
  });

  it("allows input exactly at the size limit", () => {
    const source = "a".repeat(MAX_SOURCE_SIZE_BYTES);
    const result = analyseImportSource(source);
    expect(result.syntaxErrors[0]?.code).not.toBe(CODE_IMPORT_TOO_LARGE);
  });

  it("reports parse failures for broken JSX", () => {
    const result = analyseImportSource('<div className="x"');
    expect(result.syntaxErrors[0].code).toBe(CODE_PARSE_FAILED);
    expect(result.canContinueToConversion).toBe(false);
  });

  it("removes scripts and reports security findings", () => {
    const result = analyseImportSource(
      '<script>alert(1)</script><p>ok</p>',
    );
    expect(result.rootNodes).toHaveLength(1);
    const p = result.rootNodes[0] as { tagName: string };
    expect(p.tagName).toBe("p");
    expect(
      result.securityFindings.some((f) => f.code === FINDING_SCRIPT_REMOVED),
    ).toBe(true);
    expect(result.canContinueToConversion).toBe(true);
  });

  it("reports unsupported dynamic expressions", () => {
    const result = analyseImportSource("<div>{items.map((x) => x)}</div>");
    expect(result.unsupportedFeatures.length).toBeGreaterThan(0);
    expect(result.unsupportedFeatures[0].sourceLocation).toBeDefined();
  });

  it("sorts findings deterministically by source position", () => {
    const result = analyseImportSource(
      '<a href="javascript:alert(1)">x</a><script>y</script>',
    );
    const findings = result.securityFindings;
    expect(findings.length).toBeGreaterThan(1);
    const positions = findings.map(
      (f) => f.sourceLocation?.startOffset ?? Number.MAX_SAFE_INTEGER,
    );
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
    const codes = findings.map((f) => f.code);
    expect(codes[0]).toContain("unsafe-url");
  });

  it("honours the language hint through options", () => {
    const result = analyseImportSource(
      { source: "<p>Hi</p>", languageHint: "html" },
      {},
    );
    expect(result.detectedLanguage).toBe("html");
    expect(result.confidence).toBe("high");
  });

  it("produces deterministic output across runs", () => {
    const source = '<div class="a"><script>x</script><p>Hi</p></div>';
    const first = analyseImportSource(source);
    const second = analyseImportSource(source);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("uses an injected deterministic ID factory", () => {
    const result = analyseImportSource("<div><p>Hi</p></div>", {
      idFactory: makeIdFactory("t"),
    });
    const div = result.rootNodes[0] as { id: string };
    expect(div.id).toBe("t1");
  });

  it("does not mutate the input source", () => {
    const source = "<div>Hi</div>";
    analyseImportSource(source);
    expect(source).toBe("<div>Hi</div>");
  });
});
