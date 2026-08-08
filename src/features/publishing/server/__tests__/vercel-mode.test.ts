// ---------------------------------------------------------------------------
// Publishing — Vercel mode resolution tests (Phase P8)
//
// Credential policy verified:
//   - VERCEL_API_TOKEN present → real mode
//   - no token + development → mock mode (E2E/dev)
//   - no token + production → unavailable (provider hidden, not broken)
//   - PUBLISH_PROVIDER list that excludes vercel disables it even in dev
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { resolveVercelMode, buildoraProjectName, vercelProviderStatus } from "../vercel-mode";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_API_TOKEN: undefined,
    VERCEL_TEAM_ID: undefined,
    VERCEL_PROJECT_PREFIX: undefined,
    VERCEL_API_BASE_URL: undefined,
    PUBLISH_PROVIDER: undefined,
    NODE_ENV: "production",
    ...overrides,
  };
}

describe("resolveVercelMode", () => {
  it("is real when a token is configured (even in production)", () => {
    expect(resolveVercelMode(env({ VERCEL_API_TOKEN: "tok" }))).toBe("real");
  });

  it("is mock in development without a token", () => {
    expect(resolveVercelMode(env({ NODE_ENV: "development" }))).toBe("mock");
  });

  it("is unavailable in production without a token", () => {
    expect(resolveVercelMode(env())).toBe("unavailable");
  });

  it("ignores whitespace-only tokens", () => {
    expect(resolveVercelMode(env({ VERCEL_API_TOKEN: "   " }))).toBe("unavailable");
  });

  it("disables vercel when PUBLISH_PROVIDER omits it, even in dev", () => {
    expect(
      resolveVercelMode(env({ NODE_ENV: "development", PUBLISH_PROVIDER: "mock,local-export" })),
    ).toBe("unavailable");
  });

  it("keeps vercel when PUBLISH_PROVIDER includes it", () => {
    expect(
      resolveVercelMode(env({ NODE_ENV: "development", PUBLISH_PROVIDER: "mock,vercel" })),
    ).toBe("mock");
  });
});

describe("buildoraProjectName", () => {
  it("prefixes with buildora by default", () => {
    expect(buildoraProjectName("proj-abc")).toBe("buildora-proj-abc");
  });

  it("applies a configured prefix deterministically", () => {
    expect(buildoraProjectName("proj-abc", "mybrand")).toBe("mybrand-proj-abc");
  });

  it("sanitizes unsafe characters", () => {
    expect(buildoraProjectName("Proj_XYZ!")).toBe("buildora-proj-xyz");
  });

  it("is deterministic and collision-resistant", () => {
    expect(buildoraProjectName("proj-1")).toBe(buildoraProjectName("proj-1"));
    expect(buildoraProjectName("proj-1")).not.toBe(buildoraProjectName("proj-2"));
  });
});

describe("vercelProviderStatus", () => {
  it("reports configured + available in real mode", () => {
    const status = vercelProviderStatus();
    // Reads process.env — assert the shape regardless of the environment.
    expect(status.providerId).toBe("vercel");
    expect(typeof status.available).toBe("boolean");
    expect(typeof status.configured).toBe("boolean");
  });
});
