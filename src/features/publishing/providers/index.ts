// ---------------------------------------------------------------------------
// Publishing provider registry (Phase P7)
//
// Environment conventions:
//   - PUBLISH_PROVIDER=mock enables the mock provider (dev/E2E). Defaults to
//     mock in development, empty in production.
//   - A real provider requires server-side credentials (never NEXT_PUBLIC_);
//     none are configured in P7, so only Local Export + Mock are registered.
//
// Missing env vars gracefully disable a provider — publishing always works
// through the Local Export fallback.
// ---------------------------------------------------------------------------

import type { PublishingProvider } from "../types";
import { LocalExportPublishingProvider } from "./local-export-provider";
import { MockPublishingProvider } from "./mock-provider";

export type ProviderEnv = "development" | "test" | "production";

function resolveEnv(): ProviderEnv {
  if (typeof process !== "undefined" && process.env?.NODE_ENV) {
    return process.env.NODE_ENV as ProviderEnv;
  }
  return "production";
}

/** Build the provider list for the current environment. */
export function getPublishingProviders(env?: ProviderEnv): PublishingProvider[] {
  const nodeEnv = env ?? resolveEnv();
  const providers: PublishingProvider[] = [new LocalExportPublishingProvider()];

  const requested = (
    typeof process !== "undefined" ? process.env?.PUBLISH_PROVIDER : undefined
  )?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  const mockEnabled =
    nodeEnv !== "production" ||
    (requested?.includes("mock") ?? false);

  if (mockEnabled) {
    providers.push(new MockPublishingProvider());
  }

  return providers;
}

/**
 * Stable provider instances per id.
 *
 * Providers (especially the mock) keep session state (deployment history,
 * rollback targets). Rebuilding a provider on every lookup would wipe that
 * state, breaking rollback through DeploymentHistory. Cache by id so a
 * publish and a later rollback share the same instance.
 */
const providerCache = new Map<string, PublishingProvider>();

export function getPublishingProvider(
  providerId: string,
  env?: ProviderEnv,
): PublishingProvider | undefined {
  const cached = providerCache.get(providerId);
  if (cached) return cached;
  const provider = getPublishingProviders(env).find((p) => p.id === providerId);
  if (provider) providerCache.set(providerId, provider);
  return provider;
}

/** Test hook — clear the provider cache (used between test suites). */
export function _resetProviderCacheForTests(): void {
  providerCache.clear();
}
