// ---------------------------------------------------------------------------
// Auth (Phase P6) — Supabase browser client
//
// Single browser client created ONLY when NEXT_PUBLIC_SUPABASE_URL and
// NEXT_PUBLIC_SUPABASE_ANON_KEY are configured. The anon key is safe for
// browser code; the service-role key / DB password / JWT secret must NEVER
// appear here or in any client bundle. Sessions are handled by supabase-js
// (its supported secure storage) — no manual token handling.
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (client) return client;
  const env = getCloudEnvironment();
  if (env.kind !== "supabase" || !env.supabaseUrl || !env.supabaseAnonKey) {
    return null;
  }
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return client;
}

/** Test hook. */
export function setSupabaseClientForTests(next: SupabaseClient | null): void {
  client = next;
}
