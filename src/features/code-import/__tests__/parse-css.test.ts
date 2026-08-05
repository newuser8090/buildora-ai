import { describe, expect, it } from "vitest";

import {
  CODE_CSS_TOO_LARGE,
  FINDING_CSS_BEHAVIOR,
  FINDING_CSS_EXPRESSION,
  FINDING_CSS_IMPORT,
  FINDING_CSS_MALFORMED,
  FINDING_UNSAFE_URL,
  MAX_CSS_DECLARATIONS,
  MAX_CSS_DECLARATIONS_PER_RULE,
  MAX_CSS_RULES,
} from "../constants";
import { normalizeCssAst } from "../normalization/normalize-css-ast";
import { parseCssSource } from "../parsing/parse-css";
import { expectFatalError } from "./test-utils";

function parseCss(source: string) {
  return normalizeCssAst(parseCssSource(source).root);
}

describe("normalizeCssAst / parseCssSource", () => {
  it("normalizes a basic rule", () => {
    const result = parseCss(".btn { color: red; }");
    expect(result.cssRules).toHaveLength(1);
    expect(result.cssRules[0].selector).toBe(".btn");
    expect(result.cssRules[0].declarations).toEqual([
      { property: "color", value: "red", important: false },
    ]);
  });

  it("preserves multiple selectors", () => {
    const result = parseCss(".a, .b { color: red; }");
    expect(result.cssRules[0].selector).toBe(".a, .b");
  });

  it("normalizes multiple declarations in order", () => {
    const result = parseCss(".x { color: red; margin: 0; }");
    expect(result.cssRules[0].declarations.map((d) => d.property)).toEqual([
      "color",
      "margin",
    ]);
  });

  it("preserves the !important flag", () => {
    const result = parseCss(".x { color: red !important; }");
    expect(result.cssRules[0].declarations[0].important).toBe(true);
  });

  it("ignores comments", () => {
    const result = parseCss("/* hi */ .x { color: red; }");
    expect(result.cssRules).toHaveLength(1);
  });

  it("rejects malformed declarations", () => {
    const result = parseCss(".x { color: ; }");
    expect(
      result.securityFindings.some((f) => f.code === FINDING_CSS_MALFORMED),
    ).toBe(true);
  });

  it("rejects @import", () => {
    const result = parseCss('@import url("x.css");\n.a { color: red; }');
    const finding = result.securityFindings.find((f) => f.code === FINDING_CSS_IMPORT);
    expect(finding?.removed).toBe(true);
    expect(result.cssRules).toHaveLength(1);
    expect(result.cssRules[0].selector).toBe(".a");
  });

  it("rejects javascript: URLs in declarations", () => {
    const result = parseCss(".x { background: url(javascript:alert(1)); }");
    expect(result.cssRules[0].declarations).toHaveLength(0);
    expect(
      result.securityFindings.some((f) => f.code === FINDING_UNSAFE_URL),
    ).toBe(true);
  });

  it("rejects expression( declarations", () => {
    const result = parseCss(".x { width: expression(document.body.clientWidth); }");
    expect(result.cssRules[0].declarations).toHaveLength(0);
    expect(
      result.securityFindings.some((f) => f.code === FINDING_CSS_EXPRESSION),
    ).toBe(true);
  });

  it("rejects behavior/binding properties", () => {
    const result = parseCss(".x { behavior: url(x.htc); color: red; }");
    expect(result.cssRules[0].declarations.map((d) => d.property)).toEqual(["color"]);
    expect(
      result.securityFindings.some((f) => f.code === FINDING_CSS_BEHAVIOR),
    ).toBe(true);
  });

  it("flattens @media blocks with a note", () => {
    const result = parseCss("@media (max-width: 600px) { .a { color: red; } }");
    expect(result.cssRules).toHaveLength(1);
    expect(result.cssRules[0].selector).toBe(".a");
    expect(
      result.unsupportedFeatures.some((f) => f.message.includes("flattened")),
    ).toBe(true);
  });

  it("rejects sources with too many rules", () => {
    const source = Array.from(
      { length: MAX_CSS_RULES + 1 },
      (_, i) => `.r${i} { color: red; }`,
    ).join("\n");
    expectFatalError(
      () => parseCss(source),
      CODE_CSS_TOO_LARGE,
      { limit: MAX_CSS_RULES, actual: MAX_CSS_RULES + 1 },
    );
  });

  it("rejects sources with too many declarations in total", () => {
    // 1700 rules x 6 declarations = 10,200 > 10,000 (before the rule cap).
    const source = Array.from(
      { length: 1700 },
      (_, i) => `.r${i} { ${"color: red; ".repeat(6)}}`,
    ).join("\n");
    expectFatalError(() => parseCss(source), CODE_CSS_TOO_LARGE, {
      limit: MAX_CSS_DECLARATIONS,
    });
  });

  it("rejects a single rule with too many declarations", () => {
    const source = `.x { ${"a: 1; ".repeat(MAX_CSS_DECLARATIONS_PER_RULE + 1)}}`;
    expectFatalError(() => parseCss(source), CODE_CSS_TOO_LARGE, {
      limit: MAX_CSS_DECLARATIONS_PER_RULE,
      actual: MAX_CSS_DECLARATIONS_PER_RULE + 1,
    });
  });

  it("preserves Unicode selectors and values", () => {
    const result = parseCss('.héro { content: "日本語"; }');
    expect(result.cssRules[0].selector).toBe(".héro");
    // postcss keeps the literal source value (including string quotes).
    expect(result.cssRules[0].declarations[0].value).toBe('"日本語"');
  });

  it("reports source locations", () => {
    const result = parseCss("\n.x { color: red; }");
    expect(result.cssRules[0].sourceLocation?.startLine).toBe(2);
  });

  it("produces deterministic output", () => {
    const source = ".a { color: red; }\n.b { margin: 0 !important; }";
    expect(JSON.stringify(parseCss(source))).toBe(JSON.stringify(parseCss(source)));
  });
});
