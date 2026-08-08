// ---------------------------------------------------------------------------
// Publishing — domain validation tests (Phase P8)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  validateDomainInput,
  normalizeDomainInput,
  isSafeDeploymentUrl,
} from "../domain-utils";

describe("normalizeDomainInput", () => {
  it("trims, lowercases and strips a trailing dot", () => {
    expect(normalizeDomainInput("  Example.COM. ")).toBe("example.com");
  });
});

describe("validateDomainInput — valid", () => {
  it("accepts a plain hostname", () => {
    const r = validateDomainInput("example.com");
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe("example.com");
  });

  it("accepts subdomains, hyphens and punycode (documented IDN policy)", () => {
    expect(validateDomainInput("www.example.com").valid).toBe(true);
    expect(validateDomainInput("my-site.example.co.uk").valid).toBe(true);
    expect(validateDomainInput("xn--bcher-kva.example").valid).toBe(true);
  });

  it("normalizes harmless whitespace", () => {
    expect(validateDomainInput("  example.com  ").valid).toBe(true);
  });
});

describe("validateDomainInput — invalid", () => {
  it("rejects empty input", () => {
    expect(validateDomainInput("").valid).toBe(false);
    expect(validateDomainInput("   ").valid).toBe(false);
  });

  it("rejects protocols, paths and query strings", () => {
    expect(validateDomainInput("https://example.com").valid).toBe(false);
    expect(validateDomainInput("example.com/page").valid).toBe(false);
    expect(validateDomainInput("example.com?x=1").valid).toBe(false);
    expect(validateDomainInput("mailto:example.com").valid).toBe(false);
    expect(validateDomainInput("example.com:8080").valid).toBe(false);
  });

  it("rejects single labels without a dot", () => {
    expect(validateDomainInput("example").valid).toBe(false);
  });

  it("rejects leading/trailing dots, double dots and bad labels", () => {
    expect(validateDomainInput(".example.com").valid).toBe(false);
    expect(validateDomainInput("example.com.").normalized).toBe("example.com"); // trailing dot stripped
    expect(validateDomainInput("example..com").valid).toBe(false);
    expect(validateDomainInput("-example.com").valid).toBe(false);
    expect(validateDomainInput("example-.com").valid).toBe(false);
  });

  it("rejects oversize labels and domains", () => {
    expect(validateDomainInput(`${"a".repeat(64)}.com`).valid).toBe(false);
    expect(validateDomainInput(`${"a".repeat(254)}.com`).valid).toBe(false);
  });

  it("rejects reserved/private names", () => {
    expect(validateDomainInput("localhost").valid).toBe(false);
    expect(validateDomainInput("mysite.localhost").valid).toBe(false);
    expect(validateDomainInput("printer.local").valid).toBe(false);
    expect(validateDomainInput("10.0.0.1").valid).toBe(false);
    expect(validateDomainInput("192.168.1.1").valid).toBe(false);
    expect(validateDomainInput("172.16.0.1").valid).toBe(false);
  });

  it("rejects unsafe characters and raw unicode with IDN guidance", () => {
    expect(validateDomainInput("exa mple.com").valid).toBe(false);
    expect(validateDomainInput("example$.com").valid).toBe(false);
    expect(validateDomainInput("exämple.com").valid).toBe(false);
  });

  it("rejects a too-short TLD", () => {
    expect(validateDomainInput("example.c").valid).toBe(false);
  });
});

describe("isSafeDeploymentUrl", () => {
  it("accepts https for real providers", () => {
    expect(isSafeDeploymentUrl("https://buildora-proj-1.vercel.app", "vercel")).toBe(true);
  });

  it("rejects unsafe schemes", () => {
    expect(isSafeDeploymentUrl("javascript:alert(1)", "vercel")).toBe(false);
    expect(isSafeDeploymentUrl("data:text/html,<script>", "vercel")).toBe(false);
    expect(isSafeDeploymentUrl("file:///etc/passwd", "vercel")).toBe(false);
    expect(isSafeDeploymentUrl("http://insecure.example", "vercel")).toBe(false);
  });

  it("rejects non-strings and oversize URLs", () => {
    expect(isSafeDeploymentUrl(123 as unknown as string)).toBe(false);
    expect(isSafeDeploymentUrl(`https://x.example/${"a".repeat(3000)}`)).toBe(false);
  });

  it("allows http localhost for the mock provider only", () => {
    expect(isSafeDeploymentUrl("http://localhost:3000/preview/p1", "mock")).toBe(true);
    expect(isSafeDeploymentUrl("http://127.0.0.1:3000/x", "mock")).toBe(true);
    expect(isSafeDeploymentUrl("http://localhost:3000/x", "vercel")).toBe(false);
  });

  it("rejects control characters in URLs", () => {
    expect(isSafeDeploymentUrl("https://example.com/\u0000\u0000", "vercel")).toBe(false);
  });
});
