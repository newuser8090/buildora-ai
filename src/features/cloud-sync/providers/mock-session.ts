// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — mock session token (DEV/TEST ONLY)
//
// The mock cloud backend (Next.js API routes) uses an opaque bearer token to
// identify the signed-in user. This token is stored in memory + localStorage
// UNDER A MOCK-ONLY KEY so the demo backend survives reloads in dev and e2e.
//
// SECURITY NOTE: real authentication (Supabase) never uses this path —
// supabase-js handles its own session storage and this module is never
// touched when the environment is "supabase". No real auth tokens are ever
// stored manually.
// ---------------------------------------------------------------------------

const MOCK_SESSION_KEY = "buildora.mock_session";

let memoryToken: string | null = null;

export function getMockSessionToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    return typeof localStorage !== "undefined"
      ? localStorage.getItem(MOCK_SESSION_KEY)
      : null;
  } catch {
    return null;
  }
}

export function setMockSessionToken(token: string): void {
  memoryToken = token;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(MOCK_SESSION_KEY, token);
    }
  } catch {
    // Non-fatal — the in-memory token still works for this load.
  }
}

export function clearMockSessionToken(): void {
  memoryToken = null;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(MOCK_SESSION_KEY);
    }
  } catch {
    // ignore
  }
}

/** Test hook — clear the in-memory token. */
export function resetMockSessionForTests(): void {
  memoryToken = null;
}
