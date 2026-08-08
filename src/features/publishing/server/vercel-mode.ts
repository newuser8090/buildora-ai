// ---------------------------------------------------------------------------
// Publishing — Vercel mode resolution + client factory (server-only)
//
//   real:        VERCEL_API_TOKEN is set → talk to api.vercel.com
//   mock:        no token + development → in-process MockVercelServer (E2E)
//   unavailable: production without credentials (or PUBLISH_PROVIDER excludes
//                "vercel") → the provider is hidden, never a broken action
//
// Credentials are read ONLY here, in server modules, never NEXT_PUBLIC_,
// never persisted, never logged.
// ---------------------------------------------------------------------------

import type { ProviderStatusData } from "./publish-api-types";
import { NodeFetchProviderHttpClient } from "./provider-http-client";
import { HttpVercelApiClient, MockVercelApiClient, type VercelApiClient } from "./vercel-api-client";
import type { ProviderEnv } from "../providers";

export type VercelMode = "real" | "mock" | "unavailable";

const PROVIDER_ID = "vercel";

export function buildoraProjectName(
  projectId: string,
  prefix?: string,
): string {
  // Deterministic, provider-valid, collision-resistant. Never derived from
  // arbitrary untrusted title text — only from the Buildora project id.
  const safe = projectId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const core = safe.slice(0, 48) || "project";
  const trimmedPrefix = (prefix ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return trimmedPrefix ? `${trimmedPrefix}-${core}` : `buildora-${core}`;
}

function resolveEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) return {};
  return {
    VERCEL_API_TOKEN: process.env.VERCEL_API_TOKEN,
    VERCEL_TEAM_ID: process.env.VERCEL_TEAM_ID,
    VERCEL_PROJECT_PREFIX: process.env.VERCEL_PROJECT_PREFIX,
    VERCEL_API_BASE_URL: process.env.VERCEL_API_BASE_URL,
    PUBLISH_PROVIDER: process.env.PUBLISH_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/** Resolve the mode without constructing any client (cheap, cacheable). */
export function resolveVercelMode(
  env: Record<string, string | undefined> = resolveEnv(),
): VercelMode {
  if (env.VERCEL_API_TOKEN && env.VERCEL_API_TOKEN.trim().length > 0) {
    return "real";
  }
  const requested = (env.PUBLISH_PROVIDER ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  // An explicit PUBLISH_PROVIDER list that omits vercel disables it even in dev.
  if (requested.length > 0 && !requested.includes(PROVIDER_ID)) {
    return "unavailable";
  }
  if ((env.NODE_ENV ?? "production") === "development") {
    return "mock";
  }
  return "unavailable";
}

let cachedClient: VercelApiClient | null = null;

/**
 * Build (and cache) the Vercel API client for the current mode.
 * Returns null when the provider is unavailable.
 */
export function getVercelApiClient(): VercelApiClient | null {
  const env = resolveEnv();
  const mode = resolveVercelMode(env);
  if (mode === "unavailable") return null;
  if (cachedClient) return cachedClient;

  if (mode === "real") {
    cachedClient = new HttpVercelApiClient({
      http: new NodeFetchProviderHttpClient({
        baseUrl: env.VERCEL_API_BASE_URL || undefined,
      }),
      token: env.VERCEL_API_TOKEN!.trim(),
      teamId: env.VERCEL_TEAM_ID?.trim() || undefined,
      baseUrl: env.VERCEL_API_BASE_URL || undefined,
    });
  } else {
    cachedClient = new MockVercelApiClient();
  }
  return cachedClient;
}

/** Test hook — reset the cached client (used between test suites). */
export function _resetVercelApiClientForTests(): void {
  cachedClient = null;
}

/** Availability + configuration status for the status endpoint. */
export function vercelProviderStatus(): ProviderStatusData {
  const env = resolveEnv();
  const mode = resolveVercelMode(env);
  switch (mode) {
    case "real":
      return {
        providerId: PROVIDER_ID,
        available: true,
        configured: true,
      };
    case "mock":
      return {
        providerId: PROVIDER_ID,
        available: true,
        devOnly: true,
        configured: false,
      };
    default:
      return {
        providerId: PROVIDER_ID,
        available: false,
        configured: false,
        reason:
          "Vercel publishing isn't configured on this Buildora installation.",
      };
  }
}

/** Provider environment for the registry (kept in sync with providers/index). */
export function providerEnv(): ProviderEnv {
  if (typeof process !== "undefined" && process.env?.NODE_ENV) {
    return process.env.NODE_ENV as ProviderEnv;
  }
  return "production";
}
