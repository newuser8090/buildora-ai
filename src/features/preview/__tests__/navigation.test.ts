// ---------------------------------------------------------------------------
// Preview — safe navigation engine tests (Phase P7)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { classifyPreviewLink, isUnsafeHref, safeAnchorHref } from "../engine/navigation";

const ROUTES = ["/", "/about", "/contact"];

describe("isUnsafeHref", () => {
  it("flags javascript:, vbscript:, and data:text/html", () => {
    expect(isUnsafeHref("javascript:alert(1)")).toBe(true);
    expect(isUnsafeHref("JavaScript:void(0)")).toBe(true);
    expect(isUnsafeHref("vbscript:msgbox(1)")).toBe(true);
    expect(isUnsafeHref("data:text/html,<script>1</script>")).toBe(true);
  });

  it("allows safe schemes", () => {
    expect(isUnsafeHref("https://example.com")).toBe(false);
    expect(isUnsafeHref("mailto:a@b.com")).toBe(false);
    expect(isUnsafeHref("/about")).toBe(false);
    expect(isUnsafeHref("#section")).toBe(false);
    expect(isUnsafeHref("")).toBe(false);
  });
});

describe("classifyPreviewLink", () => {
  it("returns noop for empty or non-string hrefs", () => {
    expect(classifyPreviewLink("", ROUTES)).toEqual({ kind: "noop" });
    expect(classifyPreviewLink("   ", ROUTES)).toEqual({ kind: "noop" });
    expect(classifyPreviewLink(null, ROUTES)).toEqual({ kind: "noop" });
    expect(classifyPreviewLink(undefined, ROUTES)).toEqual({ kind: "noop" });
  });

  it("classifies internal routes", () => {
    expect(classifyPreviewLink("/about", ROUTES)).toEqual({ kind: "internal", route: "/about" });
    expect(classifyPreviewLink("/about/", ROUTES)).toEqual({ kind: "internal", route: "/about" });
    expect(classifyPreviewLink("/", ROUTES)).toEqual({ kind: "internal", route: "/" });
    expect(classifyPreviewLink("about", ROUTES)).toEqual({ kind: "internal", route: "/about" });
    expect(classifyPreviewLink("/about#team", ROUTES)).toEqual({ kind: "internal", route: "/about" });
  });

  it("classifies external http(s) links", () => {
    expect(classifyPreviewLink("https://example.com", ROUTES)).toEqual({
      kind: "external", href: "https://example.com",
    });
    expect(classifyPreviewLink("http://example.com", ROUTES)).toEqual({
      kind: "external", href: "http://example.com",
    });
    expect(classifyPreviewLink("www.example.com", ROUTES)).toEqual({
      kind: "external", href: "www.example.com",
    });
  });

  it("classifies mailto/tel as special", () => {
    expect(classifyPreviewLink("mailto:hi@example.com", ROUTES)).toEqual({
      kind: "special", href: "mailto:hi@example.com",
    });
    expect(classifyPreviewLink("tel:+15551234567", ROUTES)).toEqual({
      kind: "special", href: "tel:+15551234567",
    });
  });

  it("classifies anchors", () => {
    expect(classifyPreviewLink("#pricing", ROUTES)).toEqual({ kind: "anchor", href: "#pricing" });
  });

  it("blocks unsafe hrefs", () => {
    expect(classifyPreviewLink("javascript:alert(1)", ROUTES)).toEqual({
      kind: "blocked", href: "javascript:alert(1)",
    });
  });

  it("treats unknown internal-looking paths as external (no dead end)", () => {
    expect(classifyPreviewLink("/future-page", ROUTES).kind).toBe("external");
  });
});

describe("safeAnchorHref", () => {
  it("maps internal to route, safe schemes to themselves, blocked to #", () => {
    expect(safeAnchorHref("/about", ROUTES)).toBe("/about");
    expect(safeAnchorHref("mailto:a@b.com", ROUTES)).toBe("mailto:a@b.com");
    expect(safeAnchorHref("#team", ROUTES)).toBe("#team");
    expect(safeAnchorHref("https://example.com", ROUTES)).toBe("https://example.com");
    expect(safeAnchorHref("javascript:alert(1)", ROUTES)).toBe("#");
    expect(safeAnchorHref("", ROUTES)).toBe("#");
  });
});
