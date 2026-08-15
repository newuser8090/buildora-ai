// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J) — provider factory
//
// Resolves the active DataIntegrationProvider from the environment:
//   - supabase env vars   → SupabaseDataProvider
//   - mock environment    → MockDataProvider (dev/test backend)
//   - otherwise           → null (pure local-only mode)
//
// Local-first: a null provider means the editor runs on static props only.
// ---------------------------------------------------------------------------

import { getDataIntegrationEnvironment } from "./environment";
import { MockDataProvider } from "./mock/mock-data-provider";
import { SupabaseDataProvider } from "./supabase/supabase-data-provider";
import type { DataIntegrationProvider } from "./types";

let providerSingleton: DataIntegrationProvider | null | undefined;

/** The active data provider, or null in local-only mode. */
export function getDataIntegrationProvider(): DataIntegrationProvider | null {
  if (providerSingleton !== undefined) return providerSingleton;
  const env = getDataIntegrationEnvironment();
  if (!env.configured) {
    providerSingleton = null;
    return null;
  }
  providerSingleton =
    env.kind === "supabase" ? new SupabaseDataProvider() : new MockDataProvider();
  return providerSingleton;
}

/** Test hooks. */
export function setDataIntegrationProviderForTests(
  provider: DataIntegrationProvider | null,
): void {
  providerSingleton = provider;
}

export function resetDataIntegrationProviderForTests(): void {
  providerSingleton = undefined;
}
