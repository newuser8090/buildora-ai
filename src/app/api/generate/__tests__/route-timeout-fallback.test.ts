// ---------------------------------------------------------------------------
// POST /api/generate — Gemini timeout must fall back to rule-based (Phase P22-timeout)
//
// A hung/slow Gemini now rejects with a bounded ProviderError(PROVIDER_TIMEOUT)
// after the 20s budget (see gemini-generation-provider). The route must then
// run the deterministic rule-based engine and return a 200 within the client's
// ~30s budget instead of hanging.
//
// The provider module is mocked here so the test is deterministic and does not
// require network access. The default vitest testTimeout (10s) doubles as the
// "no hanging request" assertion: a route that awaited a never-settling Gemini
// would time out and fail.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProviderError, ERROR_CODES } from "@/features/generation/providers/provider-errors";
import { _resetGenerateRateLimitForTests } from "@/features/generation/server/generate-rate-limit";

vi.mock("@/features/generation/providers/gemini-generation-provider", () => ({
  geminiProvider: { generatePlan: vi.fn() },
  callGemini: vi.fn(),
  sanitizePrompt: (p: string) => p,
}));

import { POST } from "../route";
import { geminiProvider } from "@/features/generation/providers/gemini-generation-provider";
import { logger } from "@/lib/logger";

const generatePlanMock = vi.mocked(geminiProvider.generatePlan);

beforeEach(() => {
  _resetGenerateRateLimitForTests();
  generatePlanMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/generate — Gemini timeout fallback", () => {
  it("returns a successful rule-based response when Gemini times out", async () => {
    // Gemini is slow/hung: after the 20s budget the provider rejects with a
    // bounded PROVIDER_TIMEOUT (never the raw message).
    generatePlanMock.mockRejectedValue(
      new ProviderError(ERROR_CODES.PROVIDER_TIMEOUT, "Request timed out"),
    );
    const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => undefined);

    const response = await POST(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Build a modern SaaS website for TaskPilot", mode: "create" }),
      }),
    );

    // The route must NOT hang — it falls back to the deterministic engine.
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      success: boolean;
      source: string;
      project: { pages: Array<{ sections: unknown[] }> };
    };
    expect(json.success).toBe(true);
    expect(json.source).toBe("rule-based");
    expect(json.project.pages[0].sections.length).toBeGreaterThan(0);

    // The failure boundary is production-visible with a BOUNDED code only.
    const messages = errorSpy.mock.calls.map((c) => String(c[1]));
    expect(
      messages.some((m) =>
        m.includes("Gemini failed, falling back to rule-based (PROVIDER_TIMEOUT)"),
      ),
    ).toBe(true);
    expect(messages.some((m) => m.includes("Request timed out"))).toBe(false);
  });
});
