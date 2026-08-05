import { describe, expect, it } from "vitest";

import {
  FINDING_DANGEROUS_HTML,
  FINDING_DANGEROUS_KEY,
  FINDING_DOCUMENT_WRITE,
  FINDING_DYNAMIC_IMPORT,
  FINDING_EVAL,
  FINDING_EVENT_HANDLER_REMOVED,
  FINDING_FUNCTION_CONSTRUCTOR,
  FINDING_HOOK_UNSUPPORTED,
  FINDING_IFRAME_REMOVED,
  FINDING_NETWORK_CALL,
  FINDING_RAW_SCRIPT,
  FINDING_REQUIRE,
  FINDING_UNSAFE_URL,
  FINDING_WINDOW_LOCATION,
} from "../constants";
import { scanSourceForSecurityRisks } from "../security/security-preflight";

function codesFor(source: string): string[] {
  return scanSourceForSecurityRisks(source).map((f) => f.code);
}

describe("scanSourceForSecurityRisks", () => {
  it("detects eval(", () => {
    expect(codesFor("eval(code)")).toContain(FINDING_EVAL);
  });

  it("detects the Function constructor", () => {
    expect(codesFor("new Function('return 1')")).toContain(FINDING_FUNCTION_CONSTRUCTOR);
    expect(codesFor("Function('x')")).toContain(FINDING_FUNCTION_CONSTRUCTOR);
  });

  it("detects <script>", () => {
    expect(codesFor("<script>alert(1)</script>")).toContain(FINDING_RAW_SCRIPT);
  });

  it("detects iframes", () => {
    expect(codesFor('<iframe src="https://x"></iframe>')).toContain(
      FINDING_IFRAME_REMOVED,
    );
  });

  it("detects event handler attributes", () => {
    expect(codesFor('<button onclick="go()">')).toContain(
      FINDING_EVENT_HANDLER_REMOVED,
    );
  });

  it("detects javascript: URLs", () => {
    expect(codesFor('href="javascript:void(0)"')).toContain(FINDING_UNSAFE_URL);
  });

  it("detects control-character obfuscated schemes", () => {
    expect(codesFor("java\nscript:alert(1)")).toContain(FINDING_UNSAFE_URL);
    expect(codesFor("java\tscript:alert(1)")).toContain(FINDING_UNSAFE_URL);
  });

  it("detects dangerouslySetInnerHTML", () => {
    expect(codesFor("dangerouslySetInnerHTML={{ __html: x }}")).toContain(
      FINDING_DANGEROUS_HTML,
    );
  });

  it("detects document.write", () => {
    expect(codesFor("document.write('<b>')")).toContain(FINDING_DOCUMENT_WRITE);
  });

  it("detects window.location mutation", () => {
    expect(codesFor("window.location = 'https://x'")).toContain(
      FINDING_WINDOW_LOCATION,
    );
  });

  it("detects dynamic import(", () => {
    expect(codesFor('import("./lazy")')).toContain(FINDING_DYNAMIC_IMPORT);
  });

  it("detects require(", () => {
    expect(codesFor('require("fs")')).toContain(FINDING_REQUIRE);
  });

  it("detects external import statements", () => {
    expect(
      scanSourceForSecurityRisks('import React from "react";').some(
        (f) => f.code === "external-import-ignored",
      ),
    ).toBe(true);
  });

  it("detects React hooks", () => {
    expect(codesFor("useState(0)")).toContain(FINDING_HOOK_UNSUPPORTED);
    expect(codesFor("useEffect(() => {})")).toContain(FINDING_HOOK_UNSUPPORTED);
  });

  it("detects network calls", () => {
    expect(codesFor("fetch('/api')")).toContain(FINDING_NETWORK_CALL);
    expect(codesFor("new WebSocket('wss://x')")).toContain(FINDING_NETWORK_CALL);
  });

  it("detects prototype-pollution key syntax", () => {
    expect(codesFor('{"__proto__": {}}')).toContain(FINDING_DANGEROUS_KEY);
  });

  it("does not flag prose containing dangerous words", () => {
    const findings = scanSourceForSecurityRisks(
      "This prose mentions constructor, prototype and __proto__ but is just text.",
    );
    expect(findings).toHaveLength(0);
  });

  it("reports source locations", () => {
    const findings = scanSourceForSecurityRisks("line one\nline two\neval(x)");
    const evalFinding = findings.find((f) => f.code === FINDING_EVAL);
    expect(evalFinding?.sourceLocation?.startLine).toBe(3);
    expect(evalFinding?.sourceLocation?.startOffset).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const source =
      '<script>x</script><a href="javascript:y">z</a><button onclick="w()">';
    const first = scanSourceForSecurityRisks(source);
    const second = scanSourceForSecurityRisks(source);
    expect(second).toEqual(first);
  });
});
