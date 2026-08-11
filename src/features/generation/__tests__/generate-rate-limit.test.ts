// ---------------------------------------------------------------------------
// Phase P20 — regression tests for the /api/generate production rate limiter
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  generateRateLimited,
  clientKeyForRequest,
  generateRateLimitEnabled,
  isTestForceLocalHeader,
  _resetGenerateRateLimitForTests,
} from "../server/generate-rate-limit";

describe("generateRateLimited", () => {
  beforeEach(() => {
    _resetGenerateRateLimitForTests();
  });

  it("allows requests under the ceiling", () => {
    expect(generateRateLimited("client-a", 1_000)).toBe(false);
    expect(generateRateLimited("client-a", 2_000)).toBe(false);
  });

  it("rejects once the per-window ceiling is exceeded", () => {
    let limited = false;
    for (let i = 0; i < 60; i += 1) {
      limited = generateRateLimited("client-a", 10_000 + i);
    }
    expect(limited).toBe(false); // exactly at the ceiling
    expect(generateRateLimited("client-a", 10_060)).toBe(true); // over
  });

  it("buckets clients independently", () => {
    for (let i = 0; i < 61; i += 1) {
      generateRateLimited("client-a", 1_000 + i);
    }
    // A different client is unaffected.
    expect(generateRateLimited("client-b", 1_000)).toBe(false);
    expect(generateRateLimited("client-b", 2_000)).toBe(false);
  });

  it("resets the window after RATE_WINDOW_MS elapses", () => {
    for (let i = 0; i < 61; i += 1) {
      generateRateLimited("client-a", 1_000 + i);
    }
    expect(generateRateLimited("client-a", 2_000)).toBe(true);
    // After 60s the window rolls over and the client is allowed again.
    expect(generateRateLimited("client-a", 61_001)).toBe(false);
  });

  it("bounds the client key from X-Forwarded-For to the first entry", () => {
    const request = new Request("http://localhost/api/generate", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientKeyForRequest(request)).toBe("203.0.113.7");
  });

  it("falls back to a shared bucket when no forward header exists", () => {
    const request = new Request("http://localhost/api/generate");
    expect(clientKeyForRequest(request)).toBe("unknown-client");
  });

  it("caps an oversized forwarded header", () => {
    const long = `${"a".repeat(200)}, 10.0.0.1`;
    const request = new Request("http://localhost/api/generate", {
      headers: { "x-forwarded-for": long },
    });
    expect(clientKeyForRequest(request).length).toBeLessThanOrEqual(64);
  });

  it("evicts EXPIRED client keys when the tracked map exceeds its cap", () => {
    // Seed exactly AT the cap (10,000 keys, no sweep triggered during seed).
    for (let i = 0; i < 10_000; i += 1) {
      generateRateLimited(`client-${i}`, 1_000);
    }
    // Advance past the window and add a fresh key: size 10,001 → the sweep
    // must evict the 10,000 EXPIRED entries (not the insertion-oldest trick),
    // leaving the new client admitted.
    expect(generateRateLimited("new-client", 62_000)).toBe(false);
    // The expired entries were evicted — an old client now gets a fresh bucket.
    expect(generateRateLimited("client-0", 62_000)).toBe(false);
  });

  it("drops insertion-oldest keys when the map exceeds its cap with LIVE entries", () => {
    // Seed 10,000 keys all at the SAME now (live within the window) — the
    // expired-key sweep removes nothing, so only the insertion-order eviction
    // branch can bring the map back under the cap.
    for (let i = 0; i < 10_000; i += 1) {
      generateRateLimited(`client-${i}`, 5_000_000);
    }
    // Adding a fresh key pushes the map over the cap: the sweep must evict the
    // insertion-oldest key (client-0) while keeping the new client admitted.
    expect(generateRateLimited("brand-new-client", 5_000_000)).toBe(false);
    // client-0 was evicted, so it now gets a FRESH bucket (admitted) rather
    // than being over its limit — the eviction is observable.
    expect(generateRateLimited("client-0", 5_000_000)).toBe(false);
  });

  it("ignores the force-local test header in production", () => {
    const request = new Request("http://localhost/api/generate", {
      headers: { "x-buildora-force-local": "true" },
    });
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestForceLocalHeader(request)).toBe(false);
    vi.unstubAllEnvs();
  });

  it("honors the force-local test header outside production", () => {
    const request = new Request("http://localhost/api/generate", {
      headers: { "x-buildora-force-local": "true" },
    });
    // Default vitest NODE_ENV is "test" — the header is honored.
    expect(isTestForceLocalHeader(request)).toBe(true);
  });

  it("reports production enforcement only when NODE_ENV is production", () => {
    // Default vitest NODE_ENV is "test" — enforcement is OFF outside prod.
    expect(generateRateLimitEnabled()).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(generateRateLimitEnabled()).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
