// ---------------------------------------------------------------------------
// Sandbox document builder (Phase P23-B)
// The document is the ONLY surface where custom code may eventually execute;
// these tests pin the shell structure, the CSP, the escaping, and the
// emission-time clamping.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { ElementCustomCode } from "../../types";
import {
  MAX_CUSTOM_CODE_LENGTH,
  MAX_CUSTOM_CODE_TOTAL,
  SANDBOX_CSP,
} from "../constants";
import {
  buildCustomCodeDocument,
  buildValidatedCustomCodeSrcdoc,
} from "../srcdoc";

function enabledCode(overrides: Partial<ElementCustomCode> = {}): ElementCustomCode {
  return { enabled: true, ...overrides };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Extract the user JS — the LAST inline <script> block. The fixed runtime
 * shell script (Phase P23-G) always runs first in the head, so the user's
 * block is always the last one; when no user JS was emitted (or the payload
 * had none) this returns "".
 */
function extractScript(doc: string): string {
  const matches = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (matches.length < 2) return "";
  return matches[matches.length - 1][1];
}

/** Extract the user CSS between the shell's <style> tags. */
function extractStyle(doc: string): string {
  const match = doc.match(/<style>([\s\S]*?)<\/style>/);
  return match ? match[1] : "";
}

describe("disabled custom code", () => {
  it("returns null for undefined/null/absent code", () => {
    expect(buildCustomCodeDocument(undefined)).toBeNull();
    expect(buildCustomCodeDocument(null)).toBeNull();
  });

  it("returns null when enabled is missing or false", () => {
    expect(buildCustomCodeDocument({ css: "p {}" })).toBeNull();
    expect(buildCustomCodeDocument({ enabled: false, css: "p {}" })).toBeNull();
    expect(buildCustomCodeDocument({ enabled: "yes", css: "p {}" } as unknown as ElementCustomCode)).toBeNull();
  });

  it("never produces an executable payload when disabled", () => {
    expect(buildCustomCodeDocument({ css: "p {} " , js: "alert(1)", html: "<b>x</b>" })).toBeNull();
  });
});

describe("enabled custom code — shell structure", () => {
  it("produces a complete document with the exact CSP meta as the first CSP", () => {
    const doc = buildCustomCodeDocument(enabledCode());
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(doc).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">`,
    );
    // The CSP meta appears in the head, before any body content.
    const cspIndex = doc.indexOf("Content-Security-Policy");
    const bodyIndex = doc.indexOf("<body>");
    expect(cspIndex).toBeGreaterThan(-1);
    expect(cspIndex).toBeLessThan(bodyIndex);
    expect(countOccurrences(doc, "Content-Security-Policy")).toBe(1);
  });

  it("emits the user html/css/js", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "<h1>Hello</h1>", css: "h1 { color: red; }", js: "console.log(1)" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(doc).toContain("<h1>Hello</h1>");
    expect(extractStyle(doc)).toBe("h1 { color: red; }");
    expect(extractScript(doc)).toBe("console.log(1)");
    expect(doc).toContain('id="buildora-root"');
    expect(doc).toContain('data-buildora-custom-code="1"');
  });

  it("emits only the fixed runtime shell when all fields are empty", () => {
    const doc = buildCustomCodeDocument(enabledCode());
    expect(doc).not.toBeNull();
    if (!doc) return;
    // No user <style> and no user <script> — the ONLY script is the fixed
    // child-side runtime shell (Phase P23-G).
    expect(doc).not.toContain("<style>");
    expect(countOccurrences(doc, "<script>")).toBe(1);
    expect(extractScript(doc)).toBe("");
  });

  it("introduces no eval / new Function / unsafe-eval", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "<p>x</p>", css: "p {}", js: "const n = 1;" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc).not.toContain("unsafe-eval");
    expect(doc).not.toContain("eval(");
    expect(doc).not.toContain("new Function");
  });
});

describe("emission-time clamping (defense in depth)", () => {
  it("clamps a single field over 20,000 chars", () => {
    const doc = buildCustomCodeDocument(enabledCode({ js: "x".repeat(MAX_CUSTOM_CODE_LENGTH + 1) }));
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(extractScript(doc).length).toBe(MAX_CUSTOM_CODE_LENGTH);
  });

  it("respects the 48,000 aggregate limit, trimming js last", () => {
    const atCap = "x".repeat(MAX_CUSTOM_CODE_LENGTH);
    // 20,000 + 20,000 + 20,000 = 60,000 > 48,000 → js trimmed to 8,000.
    const doc = buildCustomCodeDocument(
      enabledCode({ html: atCap, css: atCap, js: atCap }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    const html = extractShellBodyHtml(doc);
    const css = extractStyle(doc);
    const js = extractScript(doc);
    expect(html.length).toBe(MAX_CUSTOM_CODE_LENGTH);
    expect(css.length).toBe(MAX_CUSTOM_CODE_LENGTH);
    expect(js.length).toBe(MAX_CUSTOM_CODE_TOTAL - 2 * MAX_CUSTOM_CODE_LENGTH);
    expect(html.length + css.length + js.length).toBeLessThanOrEqual(MAX_CUSTOM_CODE_TOTAL);
  });

  it("keeps html intact under aggregate pressure (structure first)", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "y".repeat(MAX_CUSTOM_CODE_LENGTH), css: "z".repeat(MAX_CUSTOM_CODE_LENGTH), js: "w".repeat(MAX_CUSTOM_CODE_LENGTH) }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(extractShellBodyHtml(doc).length).toBe(MAX_CUSTOM_CODE_LENGTH);
  });

  it("treats non-string fields as empty at emission", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ js: 42 as unknown as string, css: null as unknown as string, html: undefined }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(extractScript(doc)).toBe("");
    expect(doc).not.toContain("<style>");
  });
});

describe("shell cannot be trivially broken by closing sequences", () => {
  it("escapes </script inside user JS so it cannot close the script block", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ js: 'alert("</script><script>evil()</script>")' }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    // Only the shell's and the user block's OWN closers remain (2 total).
    // The user's inline occurrences were escaped to <\/script (semantics
    // preserved — "\/" is a valid JS escape, so the code still evaluates
    // identically).
    expect(countOccurrences(doc, "</script")).toBe(2);
    // The full user code survives in escaped form.
    expect(extractScript(doc)).toBe('alert("<\\/script><script>evil()<\\/script>")');
  });

  it("escapes </style inside user CSS so it cannot close the style block", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ css: 'a::after { content: "</style><style>p{color:red}</style>"; }' }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(countOccurrences(doc, "</style")).toBe(1);
    expect(extractStyle(doc)).toBe('a::after { content: "<\\/style><style>p{color:red}<\\/style>"; }');
  });

  it("neutralizes document-level closers in the user HTML fragment", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "</head></body></html><div>payload</div>" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    // Exactly one of each closer remains — the shell's own.
    expect(countOccurrences(doc, "</body>")).toBe(1);
    expect(countOccurrences(doc, "</html>")).toBe(1);
    expect(countOccurrences(doc, "</head>")).toBe(1);
    // The user's attempts were neutralized into text entities.
    expect(doc).toContain("&lt;/head");
    expect(doc).toContain("&lt;/body");
    expect(doc).toContain("&lt;/html");
    // And the payload itself survives inside the wrapper.
    expect(doc).toContain("<div>payload</div>");
  });
});

describe("custom attributes on the shell wrapper", () => {
  it("emits safe validated attributes", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({
        html: "<p>x</p>",
        attributes: { "data-x": "y", "aria-label": "widget" },
      }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc).toContain('data-x="y"');
    expect(doc).toContain('aria-label="widget"');
  });

  it("drops event handlers, shell controls, and malformed names at emission", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({
        attributes: {
          onclick: "alert(1)",
          srcdoc: "<script>x</script>",
          style: "position:fixed",
          "bad key": "z",
          "onmouseover": "x",
        },
      }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc).not.toContain("onclick");
    expect(doc).not.toContain("onmouseover");
    expect(doc).not.toContain("srcdoc");
    expect(doc).not.toContain("bad key");
    expect(doc).not.toContain("position:fixed");
  });

  it("escapes attribute values", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ attributes: { "data-v": 'a"b<c>d&e' } }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(doc).toContain('data-v="a&quot;b&lt;c&gt;d&amp;e"');
  });
});

describe("user HTML fragment cannot break the shell (P23-C hardening)", () => {
  it("neutralizes opening/closing script and style tags in the html fragment", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({
        html: "<script>evil()</script><style>p{}</style><SCRIPT>more()</SCRIPT>",
        css: "p { color: red; }",
        js: "console.log(1)",
      }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    // Only the shell's + user's script blocks remain (one each); the
    // user's fragment tags were neutralized and never create blocks.
    expect(countOccurrences(doc, "<script>")).toBe(2);
    expect(countOccurrences(doc, "</script>")).toBe(2);
    expect(countOccurrences(doc, "<style>")).toBe(1);
    expect(countOccurrences(doc, "</style>")).toBe(1);
    // The user's tags became text entities inside the wrapper.
    expect(doc).toContain("&lt;script>evil()&lt;/script>");
    expect(doc).toContain("&lt;style>p{}&lt;/style>");
    expect(doc).toContain("&lt;SCRIPT>more()&lt;/SCRIPT>");
    // The dedicated js/css fields are untouched.
    expect(extractStyle(doc)).toBe("p { color: red; }");
    expect(extractScript(doc)).toBe("console.log(1)");
  });

  it("an unclosed script in the html fragment cannot swallow the runtime shell", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "<script>alert('x')", js: "console.log(1)" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    // The shell document is still complete and its own script block intact.
    expect(doc.endsWith("</body>\n</html>")).toBe(true);
    expect(countOccurrences(doc, "</html>")).toBe(1);
    expect(extractScript(doc)).toBe("console.log(1)");
    expect(doc).toContain("&lt;script>alert('x')");
  });

  it("an unclosed style in the html fragment cannot swallow the shell", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "<style>.x { color: red", css: "p { color: blue; }" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(doc.endsWith("</body>\n</html>")).toBe(true);
    expect(countOccurrences(doc, "</html>")).toBe(1);
    expect(extractStyle(doc)).toBe("p { color: blue; }");
  });

  it("handles case variations and attribute-bearing script tags", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({
        html: "<ScRiPt type='text/javascript' src='https://evil/x'> </SCRIPT>",
        css: "p {}",
        js: "x()",
      }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(countOccurrences(doc, "<script")).toBe(2); // runtime shell + user
    expect(doc).toContain("&lt;ScRiPt type='text/javascript'");
    expect(doc).toContain("&lt;/SCRIPT>");
  });

  it("keeps the CSP and never weakens the sandbox posture", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ html: "<script>evil()</script>", css: "p{}", js: "x()" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(countOccurrences(doc, "Content-Security-Policy")).toBe(1);
    expect(doc).toContain(`content="${SANDBOX_CSP}"`);
    expect(doc).not.toContain("allow-same-origin");
    expect(doc).not.toContain("unsafe-eval");
    expect(doc).not.toContain("eval(");
    expect(doc).not.toContain("new Function");
  });
});

describe("child-side runtime shell (Phase P23-G)", () => {
  it("runs in the head, BEFORE any user script, so it can catch sync errors", () => {
    const doc = buildCustomCodeDocument(
      enabledCode({ js: "console.log(1)", html: "<p>x</p>" }),
    );
    expect(doc).not.toBeNull();
    if (!doc) return;

    const shellIndex = doc.indexOf("window.parent.postMessage");
    const userIndex = doc.indexOf("console.log(1)");
    expect(shellIndex).toBeGreaterThan(-1);
    expect(userIndex).toBeGreaterThan(-1);
    expect(shellIndex).toBeLessThan(doc.indexOf("</head>"));
    expect(shellIndex).toBeLessThan(userIndex);
  });

  it("reports ready, height, and error through the allowed message types only", () => {
    const doc = buildCustomCodeDocument(enabledCode());
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(doc).toContain("buildora:ready");
    expect(doc).toContain("buildora:height");
    expect(doc).toContain("buildora:error");
    // The shell never injects anything else into the parent.
    expect(doc).not.toContain("buildora:ping");
    expect(doc).not.toContain("buildora:token");
  });

  it("sanitizes error reports to capped message/stack strings", () => {
    const doc = buildCustomCodeDocument(enabledCode());
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(doc).toContain("typeof value === 'string' ? value.slice(0, limit) : ''");
    expect(doc).toContain("message: cap(message, 512)");
    expect(doc).toContain("stack, 2048");
  });

  it("never weakens the sandbox posture or adds exec mechanisms", () => {
    const doc = buildCustomCodeDocument(enabledCode({ js: "x()" }));
    expect(doc).not.toBeNull();
    if (!doc) return;

    expect(doc).not.toContain("allow-same-origin");
    expect(doc).not.toContain("unsafe-eval");
    expect(doc).not.toContain("eval(");
    expect(doc).not.toContain("new Function");
    expect(countOccurrences(doc, "Content-Security-Policy")).toBe(1);
  });

  it("the shell is emitted (escaped) even when the payload is code-free", () => {
    const doc = buildCustomCodeDocument(enabledCode({}));
    expect(doc).not.toBeNull();
    if (!doc) return;
    expect(countOccurrences(doc, "<script>")).toBe(1);
    expect(extractScript(doc)).toBe("");
    // The shell block's own closer is the only user-visible one in the
    // no-JS document.
    expect(countOccurrences(doc, "</script>")).toBe(1);
  });
});

describe("buildValidatedCustomCodeSrcdoc — authoritative export entry point", () => {
  it("returns the sandbox document for enabled, schema-valid code", () => {
    const srcdoc = buildValidatedCustomCodeSrcdoc({
      enabled: true,
      css: "p {}",
      js: "console.log(1)",
      html: "<b>hi</b>",
    });
    expect(srcdoc).not.toBeNull();
    if (!srcdoc) return;
    expect(srcdoc.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(srcdoc).toContain(`content="${SANDBOX_CSP}"`);
    expect(extractScript(srcdoc)).toBe("console.log(1)");
  });

  it("returns null when enabled is absent or false (legacy/disabled)", () => {
    expect(buildValidatedCustomCodeSrcdoc({ css: "p {}" })).toBeNull();
    expect(buildValidatedCustomCodeSrcdoc({ enabled: false, js: "x()" })).toBeNull();
    expect(buildValidatedCustomCodeSrcdoc({ enabled: "yes", js: "x()" })).toBeNull();
    expect(buildValidatedCustomCodeSrcdoc(undefined)).toBeNull();
    expect(buildValidatedCustomCodeSrcdoc(null)).toBeNull();
  });

  it("returns null for malformed payloads (schema caps are the boundary)", () => {
    expect(
      buildValidatedCustomCodeSrcdoc({
        enabled: true,
        js: "x".repeat(MAX_CUSTOM_CODE_LENGTH + 1),
      }),
    ).toBeNull();
    const atCap = "x".repeat(MAX_CUSTOM_CODE_LENGTH);
    expect(
      buildValidatedCustomCodeSrcdoc({ enabled: true, html: atCap, css: atCap, js: atCap }),
    ).toBeNull();
    expect(buildValidatedCustomCodeSrcdoc("nope")).toBeNull();
    expect(buildValidatedCustomCodeSrcdoc(42)).toBeNull();
  });

  it("routes every successful call through the authoritative document builder", () => {
    const viaHelper = buildValidatedCustomCodeSrcdoc({
      enabled: true,
      js: "console.log(1)",
      html: "<b>hi</b>",
    });
    const viaBuilder = buildCustomCodeDocument({
      enabled: true,
      js: "console.log(1)",
      html: "<b>hi</b>",
    });
    expect(viaHelper).toBe(viaBuilder);
  });
});

/** Extract the user HTML inside the buildora-root wrapper. */
function extractShellBodyHtml(doc: string): string {
  const match = doc.match(/<div id="buildora-root"[^>]*>([\s\S]*?)<\/div>/);
  return match ? match[1] : "";
}
