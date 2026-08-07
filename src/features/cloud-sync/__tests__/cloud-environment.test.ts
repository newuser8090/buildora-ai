// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — environment resolution tests
//
// Local-first guarantee: without cloud configuration the app is pure
// local-only. Resolution order: supabase (both vars) → forced mock →
// dev default mock → none.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import { getCloudEnvironment, resetCloudEnvironmentForTests } from "../cloud-environment";

const ENV = process.env;

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = ENV[key];
    if (env[key] === undefined) delete ENV[key];
    else ENV[key] = env[key];
  }
  resetCloudEnvironmentForTests();
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete ENV[key];
      else ENV[key] = value;
    }
    resetCloudEnvironmentForTests();
  }
}

describe("getCloudEnvironment", () => {
  afterEach(() => {
    resetCloudEnvironmentForTests();
  });

  it("local-only mode when no cloud env vars are present", () => {
    withEnv(
      { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, NEXT_PUBLIC_CLOUD_PROVIDER: undefined, NODE_ENV: "production" },
      () => {
        const env = getCloudEnvironment();
        expect(env.kind).toBe("none");
        expect(env.configured).toBe(false);
      },
    );
  });

  it("selects supabase when URL + anon key are configured", () => {
    withEnv(
      { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NEXT_PUBLIC_CLOUD_PROVIDER: undefined, NODE_ENV: "production" },
      () => {
        const env = getCloudEnvironment();
        expect(env.kind).toBe("supabase");
        expect(env.configured).toBe(true);
        expect(env.supabaseUrl).toBe("https://x.supabase.co");
      },
    );
  });

  it("forces mock with NEXT_PUBLIC_CLOUD_PROVIDER=mock", () => {
    withEnv(
      { NEXT_PUBLIC_CLOUD_PROVIDER: "mock", NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, NODE_ENV: "production" },
      () => {
        expect(getCloudEnvironment().kind).toBe("mock");
      },
    );
  });

  it("defaults to mock in development (demo backend, no real credentials)", () => {
    withEnv(
      { NEXT_PUBLIC_CLOUD_PROVIDER: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, NODE_ENV: "development" },
      () => {
        expect(getCloudEnvironment().kind).toBe("mock");
      },
    );
  });

  it("forces local-only with NEXT_PUBLIC_CLOUD_PROVIDER=none even with supabase vars", () => {
    withEnv(
      { NEXT_PUBLIC_CLOUD_PROVIDER: "none", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", NODE_ENV: "production" },
      () => {
        expect(getCloudEnvironment().kind).toBe("none");
      },
    );
  });
});
