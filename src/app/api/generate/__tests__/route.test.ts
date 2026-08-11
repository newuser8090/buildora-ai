// ---------------------------------------------------------------------------
// Phase P21 (F3) — /api/generate observability + 429 behavior
//
// 1. Provider-failure diagnostics: a Gemini failure that falls back to the
//    rule-based engine used to be logged at `warn` — which the logger DROPS in
//    production — so a paid-provider outage was invisible to operators. The
//    fallback is now an error-level record embedding ONLY a bounded code
//    (never the raw provider message, which can carry URLs / request echoes).
// 2. The top-level catch embeds a bounded error-class token.
// 3. The 429 rate-limit response carries a `Retry-After` header matching the
//    fixed window (standard operational hint).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST, boundedErrorToken } from "../route";
import { logger } from "@/lib/logger";
import { ProviderError, ERROR_CODES } from "@/features/generation/providers/provider-errors";
import {
  _resetGenerateRateLimitForTests,
  RATE_WINDOW_SECONDS,
} from "@/features/generation/server/generate-rate-limit";

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  _resetGenerateRateLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("boundedErrorToken (Phase P21 F3)", () => {
  it("prefers an uppercase ProviderError code", () => {
    expect(boundedErrorToken(new ProviderError(ERROR_CODES.PROVIDER_TIMEOUT, "timed out", true))).toBe(
      "PROVIDER_TIMEOUT",
    );
  });

  it("falls back to the error's constructor name for plain errors", () => {
    expect(boundedErrorToken(new TypeError("fetch failed"))).toBe("TypeError");
    expect(boundedErrorToken("a string")).toBe("string");
  });

  it("never returns arbitrary content", () => {
    // A hostile/accidental error with content-shaped fields must not leak.
    const weird = new Error("GEMINI_API_KEY=sk-1234 secret prompt content");
    const token = boundedErrorToken(weird);
    expect(token).toBe("Error"); // constructor name only
    expect(token).not.toContain("sk-1234");
    expect(token).not.toContain("secret");
  });

  it("is bounded (short identifier, never content)", () => {
    const token = boundedErrorToken({ code: "x".repeat(500) });
    // Whatever the fallback is, it must be a short identifier — never the
    // 500-char payload.
    expect(token.length).toBeLessThanOrEqual(64);
    expect(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(token)).toBe(true);
    expect(token).not.toContain("xxxx");
  });
});

describe("POST /api/generate — provider-failure observability (Phase P21 F3)", () => {
  it("falls back to rule-based and logs a PRODUCTION-visible bounded code (never the raw message)", async () => {
    // Deterministic: with GEMINI_API_KEY unset the real provider throws
    // ProviderError(MISSING_API_KEY) and the route falls back to rule-based.
    vi.stubEnv("GEMINI_API_KEY", "");
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const response = await post({ prompt: "Build a saas landing page", mode: "create" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { success: boolean; source: string };
    expect(json.success).toBe(true);
    expect(json.source).toBe("rule-based");

    // The failure boundary is recorded at error level with a bounded code…
    const messages = errorSpy.mock.calls.map((c) => String(c[1]));
    expect(
      messages.some((m) => m.includes("Gemini failed, falling back to rule-based (MISSING_API_KEY)")),
    ).toBe(true);
    // …and the raw provider message is never embedded.
    expect(messages.some((m) => m.includes("GEMINI_API_KEY is not configured"))).toBe(false);
  });
});

describe("POST /api/generate — 429 behavior (Phase P21 F3)", () => {
  it("returns 429 with a Retry-After header once the production ceiling is hit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = { "x-forwarded-for": "203.0.113.7" };

    // Requests are counted before validation (anti-DoS), so invalid bodies
    // still consume the budget — exactly like production.
    for (let i = 0; i < 60; i += 1) {
      const res = await post({}, headers);
      expect(res.status).toBe(400); // invalid input — but counted
    }

    const limited = await post({}, headers);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe(String(RATE_WINDOW_SECONDS));
    const envelope = (await limited.json()) as { success: boolean; error: { code: string } };
    expect(envelope.success).toBe(false);
    expect(envelope.error.code).toBe("RATE_LIMITED");

    // A different client identity is unaffected (per-client isolation).
    const other = await post({}, { "x-forwarded-for": "198.51.100.9" });
    expect(other.status).toBe(400);
  });
});
