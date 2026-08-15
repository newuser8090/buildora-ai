// ---------------------------------------------------------------------------
// Gemini generation provider — timeout wiring regression tests
//
// Phase P22-timeout: the provider's 20s budget must be REAL. Previously the
// AbortController signal was never forwarded to the SDK, so a slow/hung
// Gemini held /api/generate open indefinitely and the rule-based fallback
// was never reached. These tests pin the fixed behavior:
//   1. the abort signal reaches the SDK as config.abortSignal,
//   2. a real SDK timeout is configured via config.httpOptions.timeout,
//   3. a timeout rejects promptly with PROVIDER_TIMEOUT and is NOT retried,
//   4. genuinely retryable failures (non-timeout) still retry once.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { generateContentMock } = vi.hoisted(() => ({
  generateContentMock: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

import { geminiProvider, callGemini } from "../gemini-generation-provider";
import { ProviderError, ERROR_CODES } from "../provider-errors";

/** A schema-valid single-page plan (create mode). */
const VALID_PLAN = {
  websiteType: "saas",
  brandName: "TaskPilot",
  theme: "modern",
  sections: [
    {
      type: "hero",
      order: 1,
      props: {
        headline: "Plan smarter",
        subheadline: "Task management for modern teams.",
        primaryCta: { text: "Get Started", href: "#start" },
      },
    },
  ],
};

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "gemini-2.0-flash";
  generateContentMock.mockReset();
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  vi.useRealTimers();
});

describe("geminiProvider.generatePlan — success", () => {
  it("returns a gemini-sourced plan on a valid response", async () => {
    generateContentMock.mockResolvedValue({ text: JSON.stringify(VALID_PLAN) });

    const result = await geminiProvider.generatePlan({
      prompt: "Build a SaaS website",
      mode: "create",
    });

    expect(result.source).toBe("gemini");
    expect(result.plan.sections.length).toBeGreaterThan(0);
    expect(result.plan.brandName).toBe("TaskPilot");
  });
});

describe("callGemini — real timeout wiring (the regression)", () => {
  it("forwards the caller's AbortSignal to the SDK as config.abortSignal", async () => {
    const controller = new AbortController();
    generateContentMock.mockResolvedValue({ text: JSON.stringify(VALID_PLAN) });

    await callGemini("prompt", "model", "key", "system", controller.signal);

    const config = generateContentMock.mock.calls[0][0].config;
    expect(config.abortSignal).toBe(controller.signal);
  });

  it("sets a real SDK request timeout via config.httpOptions.timeout", async () => {
    generateContentMock.mockResolvedValue({ text: JSON.stringify(VALID_PLAN) });

    await callGemini("prompt", "model", "key");

    const config = generateContentMock.mock.calls[0][0].config;
    // The SDK aborts the underlying fetch after this many ms — a REAL cap,
    // even for callers that pass no signal (edit/plan/inline providers).
    expect(config.httpOptions).toEqual({ timeout: 20_000 });
  });
});

describe("geminiProvider.generatePlan — timeout behavior", () => {
  it("rejects with PROVIDER_TIMEOUT after the budget and does NOT hang or retry", async () => {
    vi.useFakeTimers();

    // The mocked SDK never resolves on its own — only an aborted signal
    // settles it, mirroring a hung Gemini that must be cut off at 20s.
    generateContentMock.mockImplementation(({ config }: { config: { abortSignal: AbortSignal } }) => {
      return new Promise((_resolve, reject) => {
        config.abortSignal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });

    // Attach handlers synchronously so the eventual rejection is never
    // "unhandled" while the fake clock advances.
    const promise = geminiProvider.generatePlan({
      prompt: "Build a SaaS website",
      mode: "create",
    });
    const outcome = promise.then(
      () => ({ ok: true as const }),
      (e: ProviderError) => ({ ok: false as const, code: e.code }),
    );

    // Exactly one SDK call must ever happen — a timeout is NOT retried
    // (a retry would double the wait and blow the /api/generate budget).
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(outcome).resolves.toMatchObject({
      ok: false,
      code: ERROR_CODES.PROVIDER_TIMEOUT,
    });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it("still retries genuinely retryable (non-timeout) failures exactly once", async () => {
    // Empty response is a transient model-output failure — the architecture
    // retries it once before giving up.
    generateContentMock.mockRejectedValueOnce(
      new ProviderError(ERROR_CODES.EMPTY_RESPONSE, "Gemini returned empty response", true),
    );
    generateContentMock.mockResolvedValueOnce({ text: JSON.stringify(VALID_PLAN) });

    const result = await geminiProvider.generatePlan({
      prompt: "Build a SaaS website",
      mode: "create",
    });

    expect(result.source).toBe("gemini");
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a non-retryable ProviderError without retrying", async () => {
    generateContentMock.mockRejectedValueOnce(
      new ProviderError(ERROR_CODES.PROVIDER_AUTH, "Authentication failed"),
    );

    await expect(
      geminiProvider.generatePlan({ prompt: "Build a SaaS website", mode: "create" }),
    ).rejects.toMatchObject({ code: ERROR_CODES.PROVIDER_AUTH });
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});
