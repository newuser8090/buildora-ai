// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: provider factory
// ---------------------------------------------------------------------------

import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import { MockHttpPresenceProvider } from "../providers/mock-http-presence-provider";
import type { PresenceProvider } from "../providers/presence-provider";
import { SupabasePresenceProvider } from "../providers/supabase-presence-provider";

let presenceSingleton: PresenceProvider | null = null;

/**
 * Get the presence provider for the current cloud environment, or null when no
 * backend is configured (pure local mode — presence unavailable).
 */
export function getPresenceProvider(): PresenceProvider | null {
  if (presenceSingleton) return presenceSingleton;
  const env = getCloudEnvironment();
  if (env.kind === "supabase") {
    presenceSingleton = new SupabasePresenceProvider();
  } else if (env.kind === "mock") {
    presenceSingleton = new MockHttpPresenceProvider();
  }
  return presenceSingleton;
}

/** Test hook. */
export function setPresenceProviderForTests(provider: PresenceProvider | null): void {
  presenceSingleton = provider;
}
