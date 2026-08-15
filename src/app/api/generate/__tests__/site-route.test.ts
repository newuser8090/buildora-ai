// ---------------------------------------------------------------------------
// Phase P22-I — POST /api/generate site generation
//
// 1. mode:"site" produces a multi-page project through the existing pipeline
// 2. server-side site-intent detection on ordinary create requests
// 3. ordinary create prompts stay single-page
// 4. Gemini failure falls back to the deterministic rule-based site engine
// 5. the existing rate limiter, prompt cap and body cap still apply
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "../route";
import { _resetGenerateRateLimitForTests } from "@/features/generation/server/generate-rate-limit";

function post(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const FORCE_LOCAL = { "x-buildora-force-local": "true" };

beforeEach(() => {
  _resetGenerateRateLimitForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/generate — Phase P22-I site mode", () => {
  it("accepts mode:\"site\" and returns a multi-page project (rule-based, forced local)", async () => {
    const response = await post(
      {
        prompt: "Build a multi-page SaaS website for Nimbus with features, pricing, about, and contact pages",
        mode: "site",
      },
      FORCE_LOCAL,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      success: boolean;
      source: string;
      project: { pages: Array<{ title: string; slug: string; sections: unknown[] }> };
    };
    expect(json.success).toBe(true);
    expect(json.source).toBe("rule-based");
    expect(json.project.pages.length).toBeGreaterThanOrEqual(2);
    expect(json.project.pages[0].slug).toBe("/");
    expect(json.project.pages[0].title).toBe("Home");
    expect(json.project.pages[0].sections.length).toBeGreaterThan(0);
  });

  it("detects clear site intent on ordinary create requests (server-side)", async () => {
    const response = await post(
      {
        prompt: "Build a restaurant website with menu, about, and contact pages",
      },
      FORCE_LOCAL,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      success: boolean;
      project: { pages: unknown[] };
    };
    expect(json.success).toBe(true);
    expect(json.project.pages.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps ordinary create prompts single-page (regression)", async () => {
    const response = await post(
      { prompt: "Build a dark SaaS website for Huddle" },
      FORCE_LOCAL,
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      success: boolean;
      project: { pages: unknown[] };
    };
    expect(json.success).toBe(true);
    expect(json.project.pages).toHaveLength(1);
  });

  it("falls back to the deterministic rule-based site engine when Gemini is unavailable", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const response = await post({
      prompt: "Build a multi-page ecommerce website called Acme with shop, about, and contact pages",
      mode: "site",
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      success: boolean;
      source: string;
      project: { pages: unknown[] };
    };
    expect(json.success).toBe(true);
    expect(json.source).toBe("rule-based");
    expect(json.project.pages.length).toBeGreaterThanOrEqual(2);
  });

  it("returns every generated page route-valid (homepage '/', unique slugs)", async () => {
    const response = await post(
      { prompt: "Build a multi-page portfolio website called Aanya with projects, about, and contact pages" },
      FORCE_LOCAL,
    );
    const json = (await response.json()) as {
      project: { pages: Array<{ slug: string }> };
    };
    const slugs = json.project.pages.map((p) => p.slug);
    expect(slugs[0]).toBe("/");
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("rejects unknown modes", async () => {
    const response = await post({ prompt: "hi", mode: "bogus" }, FORCE_LOCAL);
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_INPUT");
  });

  it("rejects oversized prompts for site mode too", async () => {
    const long = "multi-page site " + "x".repeat(5000);
    const response = await post({ prompt: long, mode: "site" }, FORCE_LOCAL);
    expect(response.status).toBe(400);
  });

  it("applies the production rate limiter to site requests", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const headers = { "x-forwarded-for": "203.0.113.77" };

    // Requests are counted before validation (anti-DoS) — invalid bodies
    // consume the shared budget without running generation, exactly like
    // the existing create-mode rate-limit test.
    for (let i = 0; i < 60; i += 1) {
      const res = await post({}, headers);
      expect(res.status).toBe(400);
    }

    // A legitimate site request from the same client is now limited.
    const limited = await post(
      { prompt: "Build a multi-page SaaS website", mode: "site" },
      headers,
    );
    expect(limited.status).toBe(429);
  });
});
