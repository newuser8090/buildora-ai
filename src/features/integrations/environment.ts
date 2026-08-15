// ---------------------------------------------------------------------------
// Data integrations (Phase P22-J) — environment resolution
//
// Mirrors cloud-sync's cloud-environment conventions (local-first):
//   1. NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY → "supabase"
//   2. NEXT_PUBLIC_DATA_PROVIDER=mock  → "mock" (dev/test backend)
//   3. NODE_ENV === "development"      → "mock" (demo backend)
//   4. otherwise                       → "none" (pure local-only mode)
//
// NEXT_PUBLIC_DATA_PROVIDER can force "none" (NEXT_PUBLIC_DATA_PROVIDER=none)
// or force "mock"/"supabase". Secrets (service-role keys) never appear here —
// only the public anon key, exactly like cloud sync.
// ---------------------------------------------------------------------------

export type DataProviderKind = "none" | "mock" | "supabase";

export interface DataIntegrationEnvironment {
  kind: DataProviderKind;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  /** True when a data provider is available at all. */
  configured: boolean;
}

let cached: DataIntegrationEnvironment | null = null;

function readEnv(): Record<string, string | undefined> {
  if (typeof process === "undefined" || !process.env) return {};
  // Direct process.env.X access so bundlers inline the literals (see the
  // cloud-environment convention — indirection breaks browser inlining).
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_DATA_PROVIDER: process.env.NEXT_PUBLIC_DATA_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
  };
}

/** Resolve the data integration environment (cached; test hook below). */
export function getDataIntegrationEnvironment(): DataIntegrationEnvironment {
  if (cached) return cached;
  const env = readEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const forced = env.NEXT_PUBLIC_DATA_PROVIDER;
  const nodeEnv =
    typeof process !== "undefined" ? process.env.NODE_ENV : undefined;

  let kind: DataProviderKind = "none";
  if (url && anonKey && forced !== "none") {
    kind = "supabase";
  } else if (forced === "supabase") {
    kind = "none"; // requested Supabase but no credentials — stay local-only
  } else if (forced === "mock") {
    kind = "mock";
  } else if (forced === undefined && nodeEnv === "development") {
    kind = "mock";
  }

  const envOut: DataIntegrationEnvironment = {
    kind,
    supabaseUrl: kind === "supabase" ? url : undefined,
    supabaseAnonKey: kind === "supabase" ? anonKey : undefined,
    configured: kind !== "none",
  };
  cached = envOut;
  return envOut;
}

/** Test hook: clear the cached environment. */
export function resetDataIntegrationEnvironmentForTests(): void {
  cached = null;
}
