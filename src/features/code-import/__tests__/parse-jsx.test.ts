import { describe, expect, it } from "vitest";

import {
  CODE_PARSE_FAILED,
  FINDING_CUSTOM_COMPONENT,
  FINDING_CUSTOM_COMPONENT_INLINED,
  FINDING_EVENT_HANDLER_REMOVED,
  FINDING_HOOK_UNSUPPORTED,
  FINDING_SPREAD_REMOVED,
  FINDING_UNRESOLVED_IDENTIFIER,
} from "../constants";
import { normalizeJsxAst } from "../normalization/normalize-jsx-ast";
import { parseJsxSource } from "../parsing/parse-jsx";
import type { ImportNode } from "../types";
import { expectFatalError, findElement, makeIdFactory } from "./test-utils";

function parseJsx(source: string) {
  return normalizeJsxAst(parseJsxSource(source), { idFactory: makeIdFactory() });
}

function rootElement(nodes: ImportNode[]) {
  const root = nodes[0] as Extract<ImportNode, { kind: "element" }>;
  return root;
}

describe("normalizeJsxAst / parseJsxSource", () => {
  it("normalizes a JSX fragment", () => {
    const result = parseJsx("<>Hello <b>world</b></>");
    const fragment = result.rootNodes[0] as Extract<ImportNode, { kind: "fragment" }>;
    expect(fragment.kind).toBe("fragment");
    const first = fragment.children[0] as Extract<ImportNode, { kind: "text" }>;
    expect(first.value).toBe("Hello ");
    const b = fragment.children[1] as Extract<ImportNode, { kind: "element" }>;
    expect(b.tagName).toBe("b");
    expect((b.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("world");
  });

  it("normalizes a TSX component", () => {
    const result = parseJsx(
      'const Card: React.FC<{ title: string }> = () => <div>Hi</div>;',
    );
    const div = rootElement(result.rootNodes);
    expect(div.tagName).toBe("div");
    expect((div.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Hi");
  });

  it("extracts a function component's return tree", () => {
    const result = parseJsx(
      "function Card() { return (<div><h2>Hello</h2></div>); }",
    );
    const div = rootElement(result.rootNodes);
    expect(div.tagName).toBe("div");
    const h2 = div.children[0] as Extract<ImportNode, { kind: "element" }>;
    expect(h2.tagName).toBe("h2");
    expect((h2.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Hello");
  });

  it("extracts an arrow component's return tree", () => {
    const result = parseJsx("const Card = () => (<div><p>Hello</p></div>);");
    const div = rootElement(result.rootNodes);
    expect(div.tagName).toBe("div");
    const p = div.children[0] as Extract<ImportNode, { kind: "element" }>;
    expect(p.tagName).toBe("p");
  });

  it("extracts a default-export function component (P2 conversion support)", () => {
    const result = parseJsx(
      "export default function Hero() { return (<div><h1>Hi</h1></div>); }",
    );
    const div = rootElement(result.rootNodes);
    expect(div.tagName).toBe("div");
    expect(result.rootNodes.length).toBe(1);
  });

  it("extracts a default-export arrow component", () => {
    const result = parseJsx("export default () => <div><p>Hello</p></div>;");
    const div = rootElement(result.rootNodes);
    expect(div.tagName).toBe("div");
  });

  it("extracts named-export components and const exports", () => {
    const named = parseJsx("export function Card() { return <div>Hi</div>; }");
    expect(rootElement(named.rootNodes).tagName).toBe("div");

    const constant = parseJsx("export const Card = () => <div>Hi</div>;");
    expect(rootElement(constant.rootNodes).tagName).toBe("div");
  });

  it("normalizes static string, number and boolean attribute literals", () => {
    const result = parseJsx(
      '<div title="Hello" data-n={5} data-b={true} data-s="x" />',
    );
    const div = rootElement(result.rootNodes);
    expect(div.attributes).toEqual({
      title: "Hello",
      "data-n": 5,
      "data-b": true,
      "data-s": "x",
    });
  });

  it("normalizes boolean shorthand attributes to true", () => {
    const result = parseJsx("<input disabled />");
    const input = rootElement(result.rootNodes);
    expect(input.attributes.disabled).toBe(true);
  });

  it("normalizes className into classNames", () => {
    const result = parseJsx('<div className="a b c">x</div>');
    const div = rootElement(result.rootNodes);
    expect(div.classNames).toEqual(["a", "b", "c"]);
  });

  it("normalizes a static style object", () => {
    const result = parseJsx('<div style={{ color: "red", fontSize: 14 }} />');
    const div = rootElement(result.rootNodes);
    expect(div.inlineStyles).toEqual({ color: "red", fontSize: "14" });
  });

  it("resolves top-level const string bindings statically", () => {
    const result = parseJsx('const TITLE = "Hello"; const App = () => <h1>{TITLE}</h1>;');
    const h1 = rootElement(result.rootNodes);
    expect((h1.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Hello");
  });

  it("turns static string arrays into text nodes", () => {
    const result = parseJsx('<div>{["One", "Two"]}</div>');
    const div = rootElement(result.rootNodes);
    const texts = div.children.map(
      (child) => (child as Extract<ImportNode, { kind: "text" }>).value,
    );
    expect(texts).toEqual(["One", "Two"]);
  });

  it("records unknown custom components without executing them", () => {
    const result = parseJsx('<Card title="x">Hello</Card>');
    const card = rootElement(result.rootNodes);
    expect(card.tagName).toBe("Card");
    expect(card.attributes.title).toBe("x");
    expect((card.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("Hello");
    const unsupported = result.unsupportedFeatures.find(
      (f) => f.code === FINDING_CUSTOM_COMPONENT,
    );
    expect(unsupported).toBeDefined();
    expect(unsupported?.message).toContain("Card");
  });

  it("inlines trivially static local components", () => {
    const source =
      "const App = () => <div><Badge /></div>;\n" +
      "function Badge() { return <span>New</span> }";
    const result = parseJsx(source);
    const div = rootElement(result.rootNodes);
    expect(div.tagName).toBe("div");
    const span = div.children[0] as Extract<ImportNode, { kind: "element" }>;
    expect(span.tagName).toBe("span");
    expect(result.securityFindings.some((f) => f.code === FINDING_CUSTOM_COMPONENT_INLINED)).toBe(true);
  });

  it("removes event handler attributes", () => {
    const result = parseJsx("<button onClick={() => doEvil()}>x</button>");
    const button = rootElement(result.rootNodes);
    expect(button.attributes.onClick).toBeUndefined();
    const finding = result.securityFindings.find(
      (f) => f.code === FINDING_EVENT_HANDLER_REMOVED,
    );
    expect(finding?.removed).toBe(true);
  });

  it("removes unknown spread props", () => {
    const result = parseJsx('<div {...props} id="a" />');
    const div = rootElement(result.rootNodes);
    expect(div.attributes).toEqual({ id: "a" });
    expect(
      result.securityFindings.some((f) => f.code === FINDING_SPREAD_REMOVED),
    ).toBe(true);
  });

  it("reports hook usage as unsupported", () => {
    const result = parseJsx(
      "function App() { const [x] = useState(0); return <div>{x}</div>; }",
    );
    expect(
      result.securityFindings.some((f) => f.code === FINDING_HOOK_UNSUPPORTED),
    ).toBe(true);
    expect(
      result.unsupportedFeatures.some(
        (f) => f.code === FINDING_UNRESOLVED_IDENTIFIER,
      ),
    ).toBe(true);
  });

  it("reports .map() as unsupported", () => {
    const result = parseJsx(
      "const List = () => <ul>{items.map((item) => <li>{item}</li>)}</ul>;",
    );
    expect(
      result.unsupportedFeatures.some((f) => f.message.includes(".map()")),
    ).toBe(true);
  });

  it("reports ternaries as unsupported", () => {
    const result = parseJsx("<div>{ok ? <p>A</p> : <p>B</p>}</div>");
    expect(
      result.unsupportedFeatures.some((f) => f.message.includes("ternary")),
    ).toBe(true);
  });

  it("reports function calls as unsupported", () => {
    const result = parseJsx("<div>{format()}</div>");
    expect(
      result.unsupportedFeatures.some((f) => f.message.includes("function call")),
    ).toBe(true);
  });

  it("throws a structured error on syntax errors", () => {
    expectFatalError(() => parseJsxSource("<div"), CODE_PARSE_FAILED);
  });

  it("reports source locations", () => {
    const result = parseJsx("<div>\n  <p>x</p>\n</div>");
    const p = findElement(result.rootNodes, "p") as Extract<
      ImportNode,
      { kind: "element" }
    >;
    expect(p.sourceLocation?.startLine).toBe(2);
  });

  it("preserves Unicode text", () => {
    const result = parseJsx("<div>日本語 Привет</div>");
    const div = rootElement(result.rootNodes);
    expect((div.children[0] as Extract<ImportNode, { kind: "text" }>).value).toBe("日本語 Привет");
  });

  it("never executes source", () => {
    const result = parseJsx("<div>{globalThis.__imported = true}</div>");
    expect((globalThis as unknown as { __imported?: boolean }).__imported).toBeUndefined();
    expect(
      result.unsupportedFeatures.some((f) => f.message.includes("not statically")),
    ).toBe(true);
  });

  it("produces deterministic ids and output", () => {
    const source = '<div className="x"><h2>Hi</h2></div>';
    const first = parseJsx(source);
    const second = parseJsx(source);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const div = rootElement(first.rootNodes);
    expect(div.id).toBe("n1");
  });

  it("rejects adjacent bare JSX elements (they must be wrapped in a fragment)", () => {
    expectFatalError(() => parseJsxSource("<div>A</div><p>B</p>"), CODE_PARSE_FAILED);
  });
});
