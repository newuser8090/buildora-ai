// ---------------------------------------------------------------------------
// Phase P23-F — custom-code attribute validation
//   - names are trimmed + lowercased and must be well-formed HTML attribute
//     names (letter first, then alnum / - _ :)
//   - event-handler names ("on*") and reserved shell attributes (style/srcdoc)
//     are rejected outright
//   - URL-bearing attributes reject javascript:/vbscript:/data:text/html
//     values after ASCII whitespace/control normalization
//   - legitimate attributes (id, class, aria-*, data-*, target, rel, …) pass
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  MAX_ATTRIBUTE_NAME_LENGTH,
  URL_BEARING_ATTRIBUTE_NAMES,
  attributeNameProblem,
  attributeValueProblem,
  findCustomCodeAttributeProblems,
  firstCustomCodeAttributeProblem,
  hasUnsafeUrlScheme,
  isEventHandlerAttributeName,
  isSafeAttributeValue,
  isUrlBearingAttributeName,
  normalizeAttributeName,
} from "../attribute-validation";

// ---------------------------------------------------------------------------
// normalizeAttributeName
// ---------------------------------------------------------------------------

describe("normalizeAttributeName (P23-F)", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeAttributeName("  data-x  ")).toBe("data-x");
  });

  it("lowercases for consistent storage/comparison", () => {
    expect(normalizeAttributeName("ARIA-Label")).toBe("aria-label");
    expect(normalizeAttributeName("DATA-X")).toBe("data-x");
    expect(normalizeAttributeName("ID")).toBe("id");
  });

  it("accepts legitimate names", () => {
    for (const name of [
      "id",
      "title",
      "aria-label",
      "aria-describedby",
      "role",
      "data-x",
      "data-item-id",
      "class",
      "target",
      "rel",
      "download",
      "tabindex",
    ]) {
      expect(normalizeAttributeName(name)).toBe(name);
    }
  });

  it("rejects empty and whitespace-only names", () => {
    expect(normalizeAttributeName("")).toBeNull();
    expect(normalizeAttributeName("   ")).toBeNull();
  });

  it("rejects names with whitespace or invalid characters", () => {
    expect(normalizeAttributeName("bad key")).toBeNull();
    expect(normalizeAttributeName("data x")).toBeNull();
    expect(normalizeAttributeName("data@x")).toBeNull();
    expect(normalizeAttributeName("data=x")).toBeNull();
    expect(normalizeAttributeName("1data")).toBeNull();
    expect(normalizeAttributeName("-data")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(normalizeAttributeName(undefined)).toBeNull();
    expect(normalizeAttributeName(null)).toBeNull();
    expect(normalizeAttributeName(42)).toBeNull();
  });

  it("rejects names over the length cap", () => {
    expect(normalizeAttributeName("k".repeat(MAX_ATTRIBUTE_NAME_LENGTH + 1))).toBeNull();
    expect(normalizeAttributeName("k".repeat(MAX_ATTRIBUTE_NAME_LENGTH))).toBe("k".repeat(MAX_ATTRIBUTE_NAME_LENGTH));
  });
});

// ---------------------------------------------------------------------------
// Event handlers / URL-bearing detection
// ---------------------------------------------------------------------------

describe("isEventHandlerAttributeName (P23-F)", () => {
  it("rejects every on* handler regardless of case", () => {
    for (const name of [
      "onclick",
      "ondblclick",
      "onmousedown",
      "onmouseup",
      "onmouseenter",
      "onmouseleave",
      "onmousemove",
      "onkeydown",
      "onkeyup",
      "onkeypress",
      "onsubmit",
      "onchange",
      "oninput",
      "onfocus",
      "onblur",
      "onload",
      "onerror",
      "onmessage",
    ]) {
      expect(isEventHandlerAttributeName(name)).toBe(true);
      expect(isEventHandlerAttributeName(name.toUpperCase())).toBe(true);
    }
  });

  it("allows names that merely contain 'on'", () => {
    expect(isEventHandlerAttributeName("data-onclick")).toBe(false);
    expect(isEventHandlerAttributeName("background")).toBe(false);
    expect(isEventHandlerAttributeName("icon")).toBe(false);
  });
});

describe("isUrlBearingAttributeName (P23-F)", () => {
  it("covers the mandated URL-bearing names (case-insensitive)", () => {
    expect([...URL_BEARING_ATTRIBUTE_NAMES].sort()).toEqual([
      "action",
      "background",
      "cite",
      "formaction",
      "href",
      "poster",
      "src",
    ]);
    expect(isUrlBearingAttributeName("href")).toBe(true);
    expect(isUrlBearingAttributeName("SRC")).toBe(true);
    expect(isUrlBearingAttributeName("action")).toBe(true);
    expect(isUrlBearingAttributeName("formaction")).toBe(true);
    expect(isUrlBearingAttributeName("poster")).toBe(true);
    expect(isUrlBearingAttributeName("cite")).toBe(true);
    expect(isUrlBearingAttributeName("background")).toBe(true);
  });

  it("does not treat plain attributes as URL-bearing", () => {
    for (const name of ["id", "title", "class", "data-x", "aria-label", "role", "target"]) {
      expect(isUrlBearingAttributeName(name)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// URL scheme safety
// ---------------------------------------------------------------------------

describe("hasUnsafeUrlScheme (P23-F)", () => {
  it("rejects javascript: values", () => {
    expect(hasUnsafeUrlScheme("javascript:alert(1)")).toBe(true);
    expect(hasUnsafeUrlScheme("JavaScript:alert(1)")).toBe(true);
    expect(hasUnsafeUrlScheme("  javascript:alert(1)")).toBe(true);
  });

  it("rejects whitespace/control-obfuscated javascript: values", () => {
    expect(hasUnsafeUrlScheme("java\nscript:alert(1)")).toBe(true);
    expect(hasUnsafeUrlScheme("java\tscript:alert(1)")).toBe(true);
    expect(hasUnsafeUrlScheme("java script:alert(1)")).toBe(true);
    expect(hasUnsafeUrlScheme("javascript\u0000:alert(1)")).toBe(true);
  });

  it("rejects vbscript: and data:text/html", () => {
    expect(hasUnsafeUrlScheme("vbscript:msgbox(1)")).toBe(true);
    expect(hasUnsafeUrlScheme("data:text/html,<script>x</script>")).toBe(true);
  });

  it("accepts safe URLs and non-URL strings", () => {
    expect(hasUnsafeUrlScheme("https://example.com")).toBe(false);
    expect(hasUnsafeUrlScheme("/relative/path")).toBe(false);
    expect(hasUnsafeUrlScheme("mailto:hello@example.com")).toBe(false);
    expect(hasUnsafeUrlScheme("data:image/png;base64,AA==")).toBe(false);
    expect(hasUnsafeUrlScheme("")).toBe(false);
  });
});

describe("isSafeAttributeValue (P23-F)", () => {
  it("rejects javascript: only for URL-bearing names", () => {
    expect(isSafeAttributeValue("href", "javascript:alert(1)")).toBe(false);
    expect(isSafeAttributeValue("src", "javascript:alert(1)")).toBe(false);
    // Non-URL-bearing names may hold any inert string.
    expect(isSafeAttributeValue("title", "javascript:alert(1)")).toBe(true);
    expect(isSafeAttributeValue("id", "javascript:alert(1)")).toBe(true);
  });

  it("accepts safe values for URL-bearing names", () => {
    expect(isSafeAttributeValue("href", "https://example.com")).toBe(true);
    expect(isSafeAttributeValue("href", "#section")).toBe(true);
    expect(isSafeAttributeValue("src", "data:image/png;base64,AA==")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Problem messages
// ---------------------------------------------------------------------------

describe("attributeNameProblem (P23-F)", () => {
  it("rejects event-handler names", () => {
    expect(attributeNameProblem("onclick")).toContain("on");
    expect(attributeNameProblem("onload")).toContain("on");
    expect(attributeNameProblem("onerror")).toContain("on");
  });

  it("rejects reserved shell attributes", () => {
    expect(attributeNameProblem("style")).not.toBeNull();
    expect(attributeNameProblem("srcdoc")).not.toBeNull();
  });

  it("accepts legitimate names", () => {
    for (const name of ["id", "class", "data-x", "aria-label", "role", "tabindex", "href", "target"]) {
      expect(attributeNameProblem(name)).toBeNull();
    }
  });
});

describe("attributeValueProblem (P23-F)", () => {
  it("rejects javascript: values for URL-bearing attributes", () => {
    expect(attributeValueProblem("href", "javascript:alert(1)")).toContain("href");
    expect(attributeValueProblem("src", "  JavaScript:alert(1)")).toContain("src");
  });

  it("allows non-script values for URL-bearing attributes", () => {
    expect(attributeValueProblem("href", "https://example.com")).toBeNull();
    expect(attributeValueProblem("src", "data:image/png;base64,AA==")).toBeNull();
    expect(attributeValueProblem("href", "")).toBeNull();
  });

  it("ignores URL checks for non-URL-bearing attributes", () => {
    expect(attributeValueProblem("title", "javascript:alert(1)")).toBeNull();
    expect(attributeValueProblem("data-x", "javascript:alert(1)")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Record-level scans (schema refine uses these)
// ---------------------------------------------------------------------------

describe("findCustomCodeAttributeProblems (P23-F)", () => {
  it("returns no problems for an empty record", () => {
    expect(findCustomCodeAttributeProblems({})).toEqual([]);
    expect(firstCustomCodeAttributeProblem({})).toBeNull();
  });

  it("returns no problems for legitimate attributes", () => {
    expect(
      findCustomCodeAttributeProblems({
        id: "widget",
        "aria-label": "Widget",
        "data-count": "3",
        class: "hero",
        target: "_blank",
      }),
    ).toEqual([]);
  });

  it("flags event-handler attributes", () => {
    expect(findCustomCodeAttributeProblems({ onclick: "alert(1)" })).toHaveLength(1);
    expect(findCustomCodeAttributeProblems({ "data-x": "1", onload: "x()" })).toHaveLength(1);
  });

  it("flags javascript: values for URL-bearing attributes", () => {
    expect(findCustomCodeAttributeProblems({ href: "javascript:alert(1)" })).toHaveLength(1);
    expect(
      findCustomCodeAttributeProblems({ src: "java\nscript:alert(1)", id: "ok" }),
    ).toHaveLength(1);
  });

  it("flags malformed attribute names", () => {
    expect(findCustomCodeAttributeProblems({ "bad key": "v" })).toHaveLength(1);
    expect(findCustomCodeAttributeProblems({ "1digit": "v" })).toHaveLength(1);
  });

  it("flags reserved shell attributes", () => {
    expect(findCustomCodeAttributeProblems({ style: "position:fixed" })).toHaveLength(1);
    expect(findCustomCodeAttributeProblems({ srcdoc: "<script>x</script>" })).toHaveLength(1);
  });

  it("reports every problem across mixed entries", () => {
    const problems = findCustomCodeAttributeProblems({
      onclick: "x()",
      href: "javascript:y()",
      "bad key": "z",
    });
    expect(problems).toHaveLength(3);
  });

  it("ignores non-record input", () => {
    expect(findCustomCodeAttributeProblems(undefined)).toEqual([]);
    expect(findCustomCodeAttributeProblems(null)).toEqual([]);
    expect(findCustomCodeAttributeProblems(["a"])).toEqual([]);
    expect(findCustomCodeAttributeProblems("nope")).toEqual([]);
  });
});
