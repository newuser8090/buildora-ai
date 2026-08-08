// ---------------------------------------------------------------------------
// Publishing — server-side session verification (Phase P8)
//
// Real production publishing requires a signed-in Buildora user. The session
// is verified HERE, server-side — never trusted from client auth state.
//   - mock cloud environment: opaque mock bearer token → mock session map
//   - supabase environment:  user JWT verified through a server-side
//     supabase-js client (persistSession disabled — nothing is stored)
//   - none:                    401 (no account system)
// ---------------------------------------------------------------------------

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import { getMockCloudState } from "@/features/cloud-sync/mock/mock-cloud-server";
import type { ApiError } from "./publish-api-types";

export type SessionResult = { ok: true; userId: string } | { ok: false; error: ApiError };

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

let serverClient: SupabaseClient | null = null;

function getServerSupabaseClient(): SupabaseClient | null {
  const env = getCloudEnvironment();
  if (env.kind !== "supabase" || !env.supabaseUrl || !env.supabaseAnonKey) {
    return null;
  }
  if (!serverClient) {
    serverClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serverClient;
}

/**
 * Verify the request's Bearer token server-side and return the user id.
 * Ownership of deployments is enforced per-call via this userId.
 */
export async function requireBuildoraSession(request: Request): Promise<SessionResult> {
  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "Sign in to publish to the internet." },
    };
  }

  const env = getCloudEnvironment();
  if (env.kind === "supabase") {
    const client = getServerSupabaseClient();
    if (!client) {
      return {
        ok: false,
        error: { code: "AUTH_REQUIRED", message: "Sign in to publish to the internet." },
      };
    }
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        return {
          ok: false,
          error: { code: "AUTH_REQUIRED", message: "Your session ended. Sign in again." },
        };
      }
      return { ok: true, userId: data.user.id };
    } catch {
      return {
        ok: false,
        error: { code: "AUTH_REQUIRED", message: "Your session ended. Sign in again." },
      };
    }
  }

  if (env.kind === "mock") {
    const state = getMockCloudState();
    const userId = state.sessions.get(token);
    if (!userId) {
      return {
        ok: false,
        error: { code: "AUTH_REQUIRED", message: "Your session ended. Sign in again." },
      };
    }
    return { ok: true, userId };
  }

  return {
    ok: false,
    error: { code: "AUTH_REQUIRED", message: "Sign in to publish to the internet." },
  };
}
