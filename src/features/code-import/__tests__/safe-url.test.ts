import { describe, expect, it } from "vitest";

import { isSafeUrl, unsafeUrlReason } from "../security/safe-url";

describe("safe-url policy", () => {
  it("allows relative paths for links", () => {
    expect(isSafeUrl("/about")).toBe(true);
    expect(isSafeUrl("about.html")).toBe(true);
    expect(isSafeUrl("../images/x.png")).toBe(true);
  });

  it("allows hash anchors and query strings", () => {
    expect(isSafeUrl("#section")).toBe(true);
    expect(isSafeUrl("?q=1")).toBe(true);
  });

  it("allows empty URLs (they carry no scheme)", () => {
    expect(isSafeUrl("")).toBe(true);
    expect(isSafeUrl("   ")).toBe(true);
  });

  it("allows https/http for links and images", () => {
    expect(isSafeUrl("https://example.com/x")).toBe(true);
    expect(isSafeUrl("http://example.com/x")).toBe(true);
    expect(isSafeUrl("https://example.com/x.png", "image")).toBe(true);
    expect(isSafeUrl("http://example.com/x.png", "image")).toBe(true);
  });

  it("allows protocol-relative URLs", () => {
    expect(isSafeUrl("//cdn.example.com/x.js")).toBe(true);
  });

  it("allows mailto and tel for links only", () => {
    expect(isSafeUrl("mailto:hi@example.com")).toBe(true);
    expect(isSafeUrl("tel:+123456")).toBe(true);
    expect(isSafeUrl("mailto:hi@example.com", "image")).toBe(false);
  });

  it("rejects javascript: URLs", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(unsafeUrlReason("javascript:alert(1)")).toBe(
      "forbidden-scheme:javascript",
    );
    expect(isSafeUrl("JavaScript:alert(1)")).toBe(false);
  });

  it("rejects vbscript: and file: URLs", () => {
    expect(isSafeUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects data: URLs for links", () => {
    expect(isSafeUrl("data:text/html,<script>1</script>")).toBe(false);
  });

  it("rejects data: images until explicitly enabled", () => {
    expect(unsafeUrlReason("data:image/png;base64,AAA", "image")).toBe(
      "data-image-not-enabled",
    );
    expect(isSafeUrl("data:image/gif;base64,R0lGOD", "image")).toBe(false);
  });

  it("rejects control-character obfuscated schemes", () => {
    expect(isSafeUrl("java\tscript:alert(1)")).toBe(false);
    expect(isSafeUrl("java\nscript:alert(1)")).toBe(false);
  });

  it("rejects percent-encoded obfuscated schemes", () => {
    expect(isSafeUrl("java%0ascript:alert(1)")).toBe(false);
    expect(isSafeUrl("jav%61script:alert(1)")).toBe(false);
  });

  it("rejects null-byte variants", () => {
    expect(isSafeUrl("java\u0000script:alert(1)")).toBe(false);
    expect(unsafeUrlReason("java\u0000script:alert(1)")).toBe(
      "control-character-or-null-byte-in-url",
    );
  });

  it("rejects malformed encoded schemes", () => {
    expect(isSafeUrl("java%zzscript:alert(1)")).toBe(false);
    expect(unsafeUrlReason("java%zzscript:alert(1)")).toBe(
      "malformed-encoded-scheme",
    );
  });

  it("allows safe image sources", () => {
    expect(isSafeUrl("/img.png", "image")).toBe(true);
    expect(isSafeUrl("https://cdn.example.com/a.jpg", "image")).toBe(true);
  });

  it("is pure and deterministic", () => {
    const url = "javascript:alert(1)";
    expect(unsafeUrlReason(url)).toBe(unsafeUrlReason(url));
    expect(isSafeUrl(url)).toBe(isSafeUrl(url));
  });
});
