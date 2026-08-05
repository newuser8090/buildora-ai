import { describe, expect, it } from "vitest";

import {
  CODE_AST_TOO_DEEP,
  CODE_LANGUAGE_UNKNOWN,
} from "../constants";
import { parseImportSource } from "../parsing/parse-import-source";
import type { ImportNode } from "../types";
import { expectFatalError, makeIdFactory } from "./test-utils";

describe("parseImportSource", () => {
  it("routes HTML sources to the HTML normalizer", () => {
    const result = parseImportSource("<p>Hi</p>", "html");
    expect(result.rootNodes).toHaveLength(1);
    const p = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(p.tagName).toBe("p");
    expect(result.cssRules).toHaveLength(0);
  });

  it("routes JSX sources to the JSX normalizer", () => {
    const result = parseImportSource('<div className="x">Hi</div>', "jsx");
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.tagName).toBe("div");
    expect(div.classNames).toEqual(["x"]);
  });

  it("routes TSX sources to the JSX normalizer", () => {
    const result = parseImportSource(
      "const Card: React.FC = () => <div>Hi</div>",
      "tsx",
    );
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.tagName).toBe("div");
  });

  it("routes React component sources to the JSX normalizer", () => {
    const result = parseImportSource(
      "function Card() { return <div>Hi</div> }",
      "react",
    );
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.tagName).toBe("div");
  });

  it("routes CSS sources to the CSS normalizer", () => {
    const result = parseImportSource(".a { color: red; }", "css");
    expect(result.cssRules).toHaveLength(1);
    expect(result.rootNodes).toHaveLength(0);
  });

  it("throws a structured error for unknown languages", () => {
    expectFatalError(() => parseImportSource("hello", "unknown"), CODE_LANGUAGE_UNKNOWN);
  });

  it("propagates structural limit errors", () => {
    expectFatalError(
      () => parseImportSource("<div/>".repeat(41), "html"),
      CODE_AST_TOO_DEEP,
    );
  });

  it("uses an injected ID factory", () => {
    const factory = makeIdFactory("t");
    const result = parseImportSource("<div><p>Hi</p></div>", "html", {
      idFactory: factory,
    });
    const div = result.rootNodes[0] as Extract<ImportNode, { kind: "element" }>;
    expect(div.id).toBe("t1");
    expect((div.children[0] as Extract<ImportNode, { kind: "element" }>).id).toBe("t2");
  });
});
