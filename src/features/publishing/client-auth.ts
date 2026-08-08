// ---------------------------------------------------------------------------
// Publishing — client bearer token (Phase P8)
//
// The Vercel provider proxies privileged calls through Buildora server
// routes. Those routes verify the Buildora session server-side; this helper
// only supplies the current session token from the existing auth layer.
// No provider credentials ever touch the browser.
// ---------------------------------------------------------------------------

import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import { getMockSessionToken } from "@/features/cloud-sync/providers/mock-session";
import { getSupabaseClient } from "@/features/auth/supabase-client";

/** Current Buildora session token (mock or Supabase), or null. */
export async function getPublishBearerToken(): Promise<string | null> {
  const env = getCloudEnvironment();
  if (env.kind === "mock") {
    return getMockSessionToken();
  }
  if (env.kind === "supabase") {
    const client = getSupabaseClient();
    if (!client) return null;
    try {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }
  return null;
}
