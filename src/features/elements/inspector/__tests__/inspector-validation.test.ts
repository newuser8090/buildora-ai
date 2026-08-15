// ---------------------------------------------------------------------------
// Inspector validation tests (Phase P22-C)
// Covers: numeric bounds, px/% parsing, color validation, spacing token
// expansion/collapse, string sanitization, security rejection.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  clampNumber,
  collapseSpacingToken,
  isSafeColorValue,
  isSafeLengthValue,
  normalizeNumericStyleValue,
  parseNumberInput,
  sanitizeInspectorString,
  splitSpacingToken,
} from "../validation";

describe("parseNumberInput", () => {
  it("parses plain numbers and px/percent suffixes", () => {
    expect(parseNumberInput("12")).toBe(12);
    expect(parseNumberInput("12px")).toBe(12);
    expect(parseNumberInput("12.5%")).toBe(12.5);
    expect(parseNumberInput("  7  ")).toBe(7);
  });

  it("rejects non-numeric input", () => {
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("12rem")).toBeNull(); // only px/% stripped
  });
});

describe("clampNumber", () => {
  it("clamps into bounds and preserves in-range values", () => {
    expect(clampNumber(150, 0, 100)).toBe(100);
    expect(clampNumber(-5, 0, 100)).toBe(0);
    expect(clampNumber(42, 0, 100)).toBe(42);
    expect(clampNumber(42, undefined, undefined)).toBe(42);
  });
});

describe("normalizeNumericStyleValue", () => {
  it("numbers stay numbers; '12px' becomes 12", () => {
    expect(normalizeNumericStyleValue(24)).toBe(24);
    expect(normalizeNumericStyleValue("24px")).toBe(24);
    expect(normalizeNumericStyleValue("24")).toBe(24);
  });

  it("non-px strings pass through (schema still validates them)", () => {
    expect(normalizeNumericStyleValue("1.5rem")).toBe("1.5rem");
    expect(normalizeNumericStyleValue("50%")).toBe("50%");
  });
});

describe("isSafeColorValue", () => {
  it("accepts hex, rgb/hsl functions, var() and safe named colors", () => {
    expect(isSafeColorValue("#fff")).toBe(true);
    expect(isSafeColorValue("#aabbcc")).toBe(true);
    expect(isSafeColorValue("#aabbccdd")).toBe(true);
    expect(isSafeColorValue("rgb(1, 2, 3)")).toBe(true);
    expect(isSafeColorValue("rgba(0,0,0,0.5)")).toBe(true);
    expect(isSafeColorValue("hsl(210, 50%, 50%)")).toBe(true);
    expect(isSafeColorValue("var(--accent, #7c5cfc)")).toBe(true);
    expect(isSafeColorValue("transparent")).toBe(true);
    expect(isSafeColorValue("currentColor")).toBe(true);
  });

  it("rejects executable or malformed values", () => {
    expect(isSafeColorValue("javascript:alert(1)")).toBe(false);
    expect(isSafeColorValue("expression(alert(1))")).toBe(false);
    expect(isSafeColorValue("url(javascript:alert(1))")).toBe(false);
    expect(isSafeColorValue("not a color")).toBe(false);
  });
});

describe("spacing tokens", () => {
  it("splits 1/2/3/4-part shorthand", () => {
    expect(splitSpacingToken("1rem")).toEqual({ top: "1rem", right: "1rem", bottom: "1rem", left: "1rem" });
    expect(splitSpacingToken("1rem 2rem")).toEqual({ top: "1rem", right: "2rem", bottom: "1rem", left: "2rem" });
    expect(splitSpacingToken("1rem 2rem 3rem")).toEqual({ top: "1rem", right: "2rem", bottom: "3rem", left: "2rem" });
    expect(splitSpacingToken("1px 2px 3px 4px")).toEqual({ top: "1px", right: "2px", bottom: "3px", left: "4px" });
  });

  it("collapses equal sides into the shortest shorthand", () => {
    expect(collapseSpacingToken({ top: "1rem", right: "1rem", bottom: "1rem", left: "1rem" })).toBe("1rem");
    expect(collapseSpacingToken({ top: "1rem", right: "2rem", bottom: "1rem", left: "2rem" })).toBe("1rem 2rem");
    expect(collapseSpacingToken({ top: "1px", right: "2px", bottom: "3px", left: "2px" })).toBe("1px 2px 3px");
    expect(collapseSpacingToken({ top: "1px", right: "2px", bottom: "3px", left: "4px" })).toBe("1px 2px 3px 4px");
  });

  it("isSafeLengthValue bounds and rejects dangerous values", () => {
    expect(isSafeLengthValue("12px")).toBe(true);
    expect(isSafeLengthValue("1.5rem")).toBe(true);
    expect(isSafeLengthValue("50%")).toBe(true);
    expect(isSafeLengthValue(42)).toBe(true);
    expect(isSafeLengthValue("url(javascript:alert(1))")).toBe(false);
    expect(isSafeLengthValue("1px".repeat(50))).toBe(false);
  });
});

describe("sanitizeInspectorString", () => {
  it("trims, rejects empty, and caps length", () => {
    expect(sanitizeInspectorString("  hello  ", 100)).toBe("hello");
    expect(sanitizeInspectorString("   ", 100)).toBeNull();
    expect(sanitizeInspectorString("abcdef", 3)).toBe("abc");
    expect(sanitizeInspectorString(42, 100)).toBeNull();
  });
});
