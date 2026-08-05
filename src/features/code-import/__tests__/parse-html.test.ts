import { describe, expect, it } from "vitest";

import {
  CODE_AST_TOO_DEEP,
  CODE_TEXT_TOO_LARGE,
  CODE_TOO_MANY_ATTRIBUTES,
  CODE_TOO_MANY_CLASSES,
  CODE_TOO_MANY_NODES,
  FINDING_EVENT_HANDLER_REMOVED,
  FINDING_IFRAME_REMOVED,
  FINDING_SCRIPT_REMOVED,
  FINDING_UNSAFE_URL,
  MAX_ATTRIBUTES_PER_ELEMENT,
  MAX_CLASS_TOKENS_PER_ELEMENT,
  MAX_IMPORT_DEPTH,
  MAX_IMPORT_NODES,
  MAX_TEXT_NODE_LENGTH,
} from "../constants";

import { normalizeHtmlAst } from "../normalization/normalize-html-ast";
import { parseHtmlSource } from "../parsing/parse-html";
import type { ImportNode } from "../types";
import { expectFatalError, findElement, makeIdFactory } from "./test-utils";

function parseHtml(source: string) {
  return normalizeHtmlAst(parseHtmlSource(source).root, {
    idFactory: makeIdFactory(),
  });
}

function elementsOf(nodes: ImportNode[]): Array<{ tagName: string }> {
  const out: Array<{ tagName: string }> = [];
  const queue = [...nodes];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) continue;
    if (node.kind === "element") {
      out.push({ tagName: node.tagName });
      queue.push(...node.children);
    } else if (node.kind === "fragment") {
      queue.push(...node.children);
    }
  }
  return out;
}

describe("normalizeHtmlAst / parseHtmlSource", () => {
  it("normalizes nested HTML", () => {
    const result = parseHtml("<div><section><p>Hi</p></section></div>");
    expect(result.rootNodes).toHaveLength(1);
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.kind).toBe("element");
    expect(div.tagName).toBe("div");
    const section = div.children[0] as Extract<ImportNode, { kind: "element" }>;
    expect(section.tagName).toBe("section");
    const p = section.children[0] as Extract<ImportNode, { kind: "element" }>;
    expect(p.tagName).toBe("p");
    const text = p.children[0] as Extract<ImportNode, { kind: "text" }>;
    expect(text.value).toBe("Hi");
    expect(result.errors).toHaveLength(0);
  });

  it("recovers from incomplete fragments", () => {
    const result = parseHtml("<div><p>Hi");
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.tagName).toBe("div");
    const p = div.children[0] as Extract<ImportNode, { kind: "element" }>;
    expect(p.tagName).toBe("p");
    expect((p.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Hi");
  });

  it("keeps multiple fragment roots", () => {
    const result = parseHtml("<p>A</p><p>B</p>");
    expect(result.rootNodes).toHaveLength(2);
    expect(elementsOf(result.rootNodes).map((e) => e.tagName)).toEqual(["p", "p"]);
  });

  it("normalizes full documents without dropping the html/body structure", () => {
    const result = parseHtml("<!doctype html><html><body><p>Hi</p></body></html>");
    const html = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(html.tagName).toBe("html");
    const p = findElement(result.rootNodes, "p");
    expect(p).toBeDefined();
  });

  it("normalizes class and className into classNames", () => {
    const classResult = parseHtml('<div class="a b">x</div>');
    const divClass = classResult.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(divClass.classNames).toEqual(["a", "b"]);

    const classNameResult = parseHtml('<div className="c">x</div>');
    const divClassName = classNameResult.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(divClassName.classNames).toEqual(["c"]);
  });

  it("parses inline style strings into a map", () => {
    const result = parseHtml('<div style="color: red; font-size: 12px">x</div>');
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.inlineStyles).toEqual({ color: "red", "font-size": "12px" });
  });

  it("keeps text nodes", () => {
    const result = parseHtml("<p>Hello</p>");
    const p = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect((p.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Hello");
  });

  it("ignores comments", () => {
    const result = parseHtml("<!-- hidden --><p>x</p>");
    expect(result.rootNodes).toHaveLength(1);
  });

  it("keeps safe hrefs", () => {
    const result = parseHtml('<a href="/about">x</a>');
    const a = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(a.attributes.href).toBe("/about");
  });

  it("removes unsafe javascript: hrefs", () => {
    const result = parseHtml('<a href="javascript:alert(1)">x</a>');
    const a = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(a.attributes.href).toBeUndefined();
    const finding = result.securityFindings.find((f) => f.code === FINDING_UNSAFE_URL);
    expect(finding).toBeDefined();
    expect(finding?.removed).toBe(true);
  });

  it("removes event handler attributes", () => {
    const result = parseHtml('<button onclick="go()">x</button>');
    const button = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(button.attributes.onclick).toBeUndefined();
    const finding = result.securityFindings.find(
      (f) => f.code === FINDING_EVENT_HANDLER_REMOVED,
    );
    expect(finding?.removed).toBe(true);
  });

  it("removes script elements", () => {
    const result = parseHtml('<script>alert(1)</script><p>x</p>');
    expect(elementsOf(result.rootNodes).map((e) => e.tagName)).toEqual(["p"]);
    const finding = result.securityFindings.find(
      (f) => f.code === FINDING_SCRIPT_REMOVED,
    );
    expect(finding?.removed).toBe(true);
  });

  it("removes iframe elements", () => {
    const result = parseHtml('<iframe src="https://x"></iframe><p>ok</p>');
    expect(elementsOf(result.rootNodes).map((e) => e.tagName)).toEqual(["p"]);
    expect(
      result.securityFindings.some((f) => f.code === FINDING_IFRAME_REMOVED),
    ).toBe(true);
  });

  it("reports source locations", () => {
    const result = parseHtml("<div>\n  <p>x</p>\n</div>");
    const p = findElement(result.rootNodes, "p") as
      | (Extract<ImportNode, { kind: "element" }> & { sourceLocation?: unknown })
      | undefined;
    const element = p as Extract<ImportNode, { kind: "element" }> | undefined;
    expect(element?.sourceLocation?.startLine).toBe(2);
  });

  it("preserves Unicode text", () => {
    const result = parseHtml("<p>Привет 世界</p>");
    const p = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect((p.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Привет 世界");
  });

  it("allows depth up to the limit and rejects beyond it", () => {
    const ok = normalizeHtmlAst(parseHtmlSource("<div/>".repeat(MAX_IMPORT_DEPTH)).root);
    expect(ok.errors).toHaveLength(0);

    expectFatalError(
      () =>
        normalizeHtmlAst(
          parseHtmlSource("<div/>".repeat(MAX_IMPORT_DEPTH + 1)).root,
        ),
      CODE_AST_TOO_DEEP,
      { limit: MAX_IMPORT_DEPTH, actual: MAX_IMPORT_DEPTH + 1 },
    );
  });

  it("rejects elements with too many attributes", () => {
    const attrs = Array.from(
      { length: MAX_ATTRIBUTES_PER_ELEMENT + 1 },
      (_, i) => `a${i}="x"`,
    ).join(" ");
    const result = parseHtml(`<div ${attrs}>ok</div>`);
    const error = result.errors.find((e) => e.code === CODE_TOO_MANY_ATTRIBUTES);
    expect(error).toBeDefined();
    expect(error?.limit).toBe(MAX_ATTRIBUTES_PER_ELEMENT);
    expect(error?.actual).toBe(MAX_ATTRIBUTES_PER_ELEMENT + 1);
    expect(result.rootNodes).toHaveLength(0); // element rejected, not truncated
  });

  it("rejects elements with too many class tokens", () => {
    const classes = Array.from(
      { length: MAX_CLASS_TOKENS_PER_ELEMENT + 1 },
      () => "c",
    ).join(" ");
    const result = parseHtml(`<div class="${classes}">ok</div>`);
    const error = result.errors.find((e) => e.code === CODE_TOO_MANY_CLASSES);
    expect(error?.limit).toBe(MAX_CLASS_TOKENS_PER_ELEMENT);
    expect(error?.actual).toBe(MAX_CLASS_TOKENS_PER_ELEMENT + 1);
    expect(result.rootNodes).toHaveLength(0);
  });

  it("truncates oversized text nodes with a reported error", () => {
    const huge = "x".repeat(MAX_TEXT_NODE_LENGTH + 1);
    const result = parseHtml(`<p>${huge}</p>`);
    const error = result.errors.find((e) => e.code === CODE_TEXT_TOO_LARGE);
    expect(error).toBeDefined();
    expect(error?.limit).toBe(MAX_TEXT_NODE_LENGTH);
    expect(error?.actual).toBe(MAX_TEXT_NODE_LENGTH + 1);
    const p = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    const text = p.children[0] as Extract<ImportNode, { kind: "text" }>;
    expect(text.value).toHaveLength(MAX_TEXT_NODE_LENGTH);
  });

  it("rejects sources expanding beyond the node limit", () => {
    const paragraphs = 1001; // each <p>x</p> is 2 nodes; the 2001st node trips the cap
    const source = Array.from({ length: paragraphs }, () => "<p>x</p>").join("");
    expectFatalError(
      () => normalizeHtmlAst(parseHtmlSource(source).root),
      CODE_TOO_MANY_NODES,
      { limit: MAX_IMPORT_NODES, actual: MAX_IMPORT_NODES + 1 },
    );
  });

  it("does not mutate the input source or the parser tree", () => {
    const source = '<div class="a"><p>Hello</p></div>';
    const first = parseHtml(source);
    const second = parseHtml(source);
    expect(source).toBe('<div class="a"><p>Hello</p></div>');
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("produces deterministic node ids from an injected factory", () => {
    const result = parseHtml("<div><p>Hi</p></div>");
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.id).toBe("n1");
    expect((div.children[0] as Extract<ImportNode, { kind: "element" }>).id).toBe("n2");
    expect((div.children[0] as Extract<ImportNode, { kind: "element" }>).children[0]?.id).toBe("n3");
  });
});
