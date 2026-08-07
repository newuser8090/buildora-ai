// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — provider factory
//
// Resolves the active CloudLibraryProvider from the cloud environment:
//   - supabase env vars   → SupabaseCloudLibraryProvider
//   - mock environment    → MockHttpCloudProvider (dev/test backend)
//   - otherwise           → null (pure local-only mode)
//
// Local-first: a null provider means the app runs entirely on IndexedDB.
// ---------------------------------------------------------------------------

import { getCloudEnvironment } from "../cloud-environment";
import type { CloudLibraryProvider } from "./cloud-library-provider";
import { MockHttpCloudProvider } from "./mock-http-cloud-provider";
import { SupabaseCloudLibraryProvider } from "./supabase-cloud-provider";

let providerSingleton: CloudLibraryProvider | null | undefined;

/** The active cloud provider, or null in local-only mode. */
export function getCloudProvider(): CloudLibraryProvider | null {
  if (providerSingleton !== undefined) return providerSingleton;
  const env = getCloudEnvironment();
  if (!env.configured) {
    providerSingleton = null;
    return null;
  }
  providerSingleton =
    env.kind === "supabase"
      ? new SupabaseCloudLibraryProvider()
      : new MockHttpCloudProvider();
  return providerSingleton;
}

/** Test hook. */
export function setCloudProviderForTests(provider: CloudLibraryProvider | null): void {
  providerSingleton = provider;
}
