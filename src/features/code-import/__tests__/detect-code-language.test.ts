import { describe, expect, it } from "vitest";

import { detectCodeLanguage } from "../detection/detect-code-language";

describe("detectCodeLanguage", () => {
  it("detects an HTML fragment", () => {
    const result = detectCodeLanguage("<p>Hello</p>");
    expect(result.language).toBe("html");
    expect(result.confidence).toBe("medium");
    expect(result.reasons).toContain("html-tags-or-document-structure-detected");
  });

  it("detects a full HTML document with high confidence", () => {
    const source =
      "<!doctype html>\n<html>\n<head><title>X</title></head>\n<body><p>Hi</p></body>\n</html>";
    const result = detectCodeLanguage(source);
    expect(result.language).toBe("html");
    expect(result.confidence).toBe("high");
  });

  it("detects JSX", () => {
    const result = detectCodeLanguage(
      '<div className="x" style={{ color: "red" }}>Hi</div>',
    );
    expect(result.language).toBe("jsx");
    expect(result.confidence).toBe("medium");
  });

  it("detects JSX with high confidence when many signals are present", () => {
    const result = detectCodeLanguage(
      '<div className="x" style={{ color: "red" }} onClick={() => {}}>Hi</div>',
    );
    expect(result.language).toBe("jsx");
    expect(result.confidence).toBe("high");
  });

  it("detects TSX from type annotations plus JSX", () => {
    const source =
      "interface CardProps {\n  title: string;\n}\n" +
      'const Card = ({ title }: CardProps) => <div className="card">{title}</div>;';
    const result = detectCodeLanguage(source);
    expect(result.language).toBe("tsx");
    expect(result.reasons).toContain("jsx-plus-typescript-annotations-detected");
  });

  it("detects a static React function component", () => {
    const source =
      'function Card() { return (<div className="card"><h2>Hello</h2></div>); }';
    const result = detectCodeLanguage(source);
    expect(result.language).toBe("react");
    expect(result.reasons).toContain("static-react-function-component-detected");
  });

  it("detects CSS", () => {
    const result = detectCodeLanguage(".btn { color: red; font-size: 12px; }");
    expect(result.language).toBe("css");
    expect(result.confidence).toBe("high");
    expect(result.reasons).toContain("css-rule-or-property-declarations-detected");
  });

  it("classifies plain text as unknown with low confidence", () => {
    const result = detectCodeLanguage("Just some prose about websites.");
    expect(result.language).toBe("unknown");
    expect(result.confidence).toBe("low");
  });

  it("classifies empty input as unknown", () => {
    const result = detectCodeLanguage("   ");
    expect(result.language).toBe("unknown");
    expect(result.confidence).toBe("low");
    expect(result.reasons).toContain("empty-input");
  });

  it("classifies ambiguous input as unknown", () => {
    const result = detectCodeLanguage("color: red");
    expect(result.language).toBe("unknown");
  });

  it("confirms a matching language hint and boosts confidence", () => {
    const base = detectCodeLanguage("<p>Hello</p>");
    expect(base.confidence).toBe("medium");
    const hinted = detectCodeLanguage("<p>Hello</p>", { hint: "html" });
    expect(hinted.language).toBe("html");
    expect(hinted.confidence).toBe("high");
    expect(hinted.reasons).toContain("language-hint-html-confirmed");
  });

  it("does not let an incorrect hint override strong signals", () => {
    const result = detectCodeLanguage('<div className="x">Hi</div>', {
      hint: "css",
    });
    expect(result.language).toBe("jsx");
    expect(result.reasons).toContain(
      "language-hint-css-overridden-by-strong-signals",
    );
  });

  it("ignores a hint when the source has no signals for it", () => {
    const result = detectCodeLanguage("Just plain words", { hint: "jsx" });
    expect(result.language).toBe("unknown");
    expect(result.reasons).toContain("language-hint-jsx-ignored-no-signals");
  });

  it("handles Unicode content", () => {
    expect(detectCodeLanguage("<p>Привет мир 世界</p>").language).toBe("html");
    expect(
      detectCodeLanguage('<div className="x">日本語 Привет</div>').language,
    ).toBe("jsx");
  });

  it("produces deterministic results and reasons", () => {
    const source = '<div className="x"><h2>Hi</h2></div>';
    const first = detectCodeLanguage(source);
    const second = detectCodeLanguage(source);
    expect(second).toEqual(first);
    expect(first.reasons).toEqual(second.reasons);
  });
});
