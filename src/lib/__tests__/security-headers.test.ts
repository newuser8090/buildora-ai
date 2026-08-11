// ---------------------------------------------------------------------------
// Phase P20 — regression tests for the security headers applied in
// next.config.ts. Verifies the exact header list the production server will
// emit: every response gets the safe standard set, nothing unsafe sneaks in,
// and the deliberately-excluded CSP is NOT present (documented decision).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { SECURITY_HEADERS } from "../security-headers";

describe("SECURITY_HEADERS", () => {
  it("applies nosniff to prevent MIME-type sniffing", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
  });

  it("denies framing (the app is never embedded in a frame)", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "X-Frame-Options",
      value: "DENY",
    });
  });

  it("restricts referrer leakage to same-origin by default", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    });
  });

  it("disables browser features the app does not use", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=()",
    });
  });

  it("disables DNS prefetching of link targets", () => {
    expect(SECURITY_HEADERS).toContainEqual({
      key: "X-DNS-Prefetch-Control",
      value: "off",
    });
  });

  it("does NOT include a Content-Security-Policy (deliberate P3 decision)", () => {
    expect(
      SECURITY_HEADERS.some((h) => h.key === "Content-Security-Policy"),
    ).toBe(false);
  });

  it("does not set Strict-Transport-Security (platform-terminated TLS)", () => {
    // Deliberate: the deployment target (Vercel) sends HSTS itself for
    // production deployments, so app-level HSTS would be redundant and could
    // conflict with platform header management. Documented decision — see
    // docs/phase-p20-architecture.md §4.2 (F2) and the P20 report.
    const keys = SECURITY_HEADERS.map((h) => h.key);
    expect(keys).not.toContain("Strict-Transport-Security");
  });

  it("keeps the header list small and bounded", () => {
    expect(SECURITY_HEADERS.length).toBeGreaterThan(0);
    expect(SECURITY_HEADERS.length).toBeLessThanOrEqual(10);
    for (const h of SECURITY_HEADERS) {
      expect(typeof h.key).toBe("string");
      expect(h.key.length).toBeGreaterThan(0);
      expect(typeof h.value).toBe("string");
    }
  });
});
