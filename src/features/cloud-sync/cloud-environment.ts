// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — environment resolution
//
// Local-first principle: the app MUST work with no cloud configuration at
// all. Resolution order:
//   1. NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY  → "supabase"
//   2. NEXT_PUBLIC_CLOUD_PROVIDER=mock  → "mock" (dev/test backend only)
//   3. NODE_ENV === "development"  → "mock" (demo backend so the feature is
//      fully exercisable without a real Supabase project)
//   4. otherwise → "none" (pure local-only mode)
//
// NEXT_PUBLIC_CLOUD_PROVIDER can force "none" even in dev
// (NEXT_PUBLIC_CLOUD_PROVIDER=none) or force "mock"/"supabase".
// ---------------------------------------------------------------------------

export type CloudProviderKind = "none" | "mock" | "supabase";

export interface CloudEnvironment {
  kind: CloudProviderKind;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** True when a cloud provider is available at all. */
  configured: boolean;
}

let cached: CloudEnvironment | null = null;

function readEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) return {};
  // Access every variable via DIRECT `process.env.X` expressions so bundlers
  // (webpack/Next.js DefinePlugin) inline them as literals. Reading through a
  // variable indirection (e.g. `env.X`) is not statically visible and would
  // leave the browser bundle without these values — silently disabling the
  // configured cloud provider client-side.
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_CLOUD_PROVIDER: process.env.NEXT_PUBLIC_CLOUD_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/** Resolve the cloud environment (cached; refresh via the test hook). */
export function getCloudEnvironment(): CloudEnvironment {
  if (cached) return cached;
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const forced = env.NEXT_PUBLIC_CLOUD_PROVIDER;
  // Read NODE_ENV through a DIRECT process.env access so bundlers inline the
  // literal. (Reading it via `env.NODE_ENV` would be missed by webpack's
  // DefinePlugin, leaving the browser bundle without the "development"
  // signal — which would silently disable the dev demo backend client-side.)
  const nodeEnv = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;

  let kind: CloudProviderKind = "none";
  if (url && anonKey && forced !== "none") {
    kind = "supabase";
  } else if (forced === "supabase") {
    kind = "none"; // requested Supabase but no credentials — stay local-only
  } else if (forced === "mock") {
    kind = "mock";
  } else if (forced === undefined && nodeEnv === "development") {
    kind = "mock";
  }

  const envOut: CloudEnvironment = {
    kind,
    supabaseUrl: kind === "supabase" ? url : undefined,
    supabaseAnonKey: kind === "supabase" ? anonKey : undefined,
    configured: kind !== "none",
  };
  cached = envOut;
  return envOut;
}

/** Test hook: clear the cached environment. */
export function resetCloudEnvironmentForTests(): void {
  cached = null;
}

/** Beginner-safe label for the current provider (or null when local-only). */
export function cloudProviderLabel(): string {
  const env = getCloudEnvironment();
  switch (env.kind) {
    case "supabase":
      return "Cloud backup";
    case "mock":
      return "Demo backup";
    default:
      return "";
  }
}
