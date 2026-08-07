// ---------------------------------------------------------------------------
// Auth (Phase P6) — auth service implementations
//
// SupabaseAuthService wraps supabase-js (anon key browser client). MockAuthService
// talks to the in-memory mock backend (dev/test only). Both implement the same
// AuthService interface so the store and UI are provider-independent.
// ---------------------------------------------------------------------------

import type { SupabaseClient, Session } from "@supabase/supabase-js";
import type {
  AuthResult,
  AuthService,
  AuthSession,
  AuthUser,
} from "./types";
import { makeAuthError, mapProviderAuthError } from "./errors";
import { getSupabaseClient } from "./supabase-client";
import { getCloudEnvironment } from "@/features/cloud-sync/cloud-environment";
import {
  clearMockSessionToken,
  getMockSessionToken,
  setMockSessionToken,
} from "@/features/cloud-sync/providers/mock-session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toAuthSession(session: Session): AuthSession {
  const user: AuthUser = {
    id: session.user.id,
    email: session.user.email ?? "",
    emailVerified: !!session.user.email_confirmed_at,
  };
  return {
    user,
    createdAt: new Date(session.user.created_at ?? Date.now()).toISOString(),
    expiresAt: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function sessionFromUser(user: AuthUser, now = Date.now()): AuthSession {
  return {
    user,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export class SupabaseAuthService implements AuthService {
  readonly kind = "supabase" as const;

  private client(): SupabaseClient {
    const c = getSupabaseClient();
    if (!c) throw makeAuthError("NOT_CONFIGURED", "Cloud backup isn't set up yet.");
    return c;
  }

  isConfigured(): boolean {
    return getSupabaseClient() !== null;
  }

  async getSession(): Promise<AuthSession | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    if (!data.session) return null;
    return toAuthSession(data.session);
  }

  onAuthStateChange(listener: (session: AuthSession | null) => void): () => void {
    const client = getSupabaseClient();
    if (!client) return () => undefined;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      listener(session ? toAuthSession(session) : null);
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(email: string, password: string): Promise<AuthResult<AuthSession>> {
    try {
      const { data, error } = await this.client().auth.signUp({
        email,
        password,
      });
      if (error) {
        return { ok: false, error: mapSupabaseAuthError(error.message) };
      }
      if (!data.session) {
        // Email confirmation may be required by provider policy. Still treat
        // as success — the user can sign in once verified.
        return {
          ok: true,
          value: sessionFromUser({
            id: data.user?.id ?? "",
            email: data.user?.email ?? email,
            emailVerified: false,
          }),
        };
      }
      return { ok: true, value: toAuthSession(data.session) };
    } catch (err) {
      return { ok: false, error: mapSupabaseAuthError(messageOf(err)) };
    }
  }

  async signIn(email: string, password: string): Promise<AuthResult<AuthSession>> {
    try {
      const { data, error } = await this.client().auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        return { ok: false, error: mapSupabaseAuthError(error.message) };
      }
      if (!data.session) {
        return {
          ok: false,
          error: makeAuthError("UNKNOWN", "Signing in didn't complete. Please try again."),
        };
      }
      return { ok: true, value: toAuthSession(data.session) };
    } catch (err) {
      return { ok: false, error: mapSupabaseAuthError(messageOf(err)) };
    }
  }

  async signOut(): Promise<AuthResult<void>> {
    try {
      const { error } = await this.client().auth.signOut();
      if (error) {
        return { ok: false, error: mapSupabaseAuthError(error.message) };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: mapSupabaseAuthError(messageOf(err)) };
    }
  }

  async resetPassword(email: string): Promise<AuthResult<void>> {
    try {
      const { error } = await this.client().auth.resetPasswordForEmail(email);
      if (error) {
        return { ok: false, error: mapSupabaseAuthError(error.message) };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, error: mapSupabaseAuthError(messageOf(err)) };
    }
  }
}

// ---------------------------------------------------------------------------
// Mock (dev/test HTTP backend)
// ---------------------------------------------------------------------------

interface MockApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function mockAuthRequest<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ data: T } | { error: { code: string; message: string } }> {
  let response: Response;
  try {
    response = await fetch(`/api/cloud/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      error: { code: "NETWORK_FAILED", message: "Couldn't reach the sign-in service." },
    };
  }
  const envelope = (await response.json().catch(() => null)) as MockApiEnvelope<T> | null;
  if (response.ok && envelope?.ok) {
    return { data: envelope.data as T };
  }
  return {
    error: envelope?.error ?? { code: "UNKNOWN", message: "Something went wrong." },
  };
}

export class MockAuthService implements AuthService {
  readonly kind = "mock" as const;

  isConfigured(): boolean {
    return true; // the mock backend is always available in dev builds
  }

  async getSession(): Promise<AuthSession | null> {
    const token = getMockSessionToken();
    if (!token) return null;
    const result = await mockAuthRequest<{ user: AuthUser }>("session", { token });
    if ("error" in result || !result.data) {
      clearMockSessionToken();
      return null;
    }
    return sessionFromUser(result.data.user);
  }

  onAuthStateChange(_listener: (session: AuthSession | null) => void): () => void {
    // The mock backend has no push; the store drives state transitions.
    // Poll-free: getSession covers initial restore and the store updates on
    // explicit sign-in/out. A no-op unsubscribe is returned.
    return () => undefined;
  }

  async signUp(email: string, password: string): Promise<AuthResult<AuthSession>> {
    const result = await mockAuthRequest<{ user: AuthUser; token: string }>("signup", {
      email,
      password,
    });
    if ("error" in result) {
      return { ok: false, error: mapMockAuthError(result.error) };
    }
    setMockSessionToken(result.data.token);
    return { ok: true, value: sessionFromUser(result.data.user) };
  }

  async signIn(email: string, password: string): Promise<AuthResult<AuthSession>> {
    const result = await mockAuthRequest<{ user: AuthUser; token: string }>("signin", {
      email,
      password,
    });
    if ("error" in result) {
      return { ok: false, error: mapMockAuthError(result.error) };
    }
    setMockSessionToken(result.data.token);
    return { ok: true, value: sessionFromUser(result.data.user) };
  }

  async signOut(): Promise<AuthResult<void>> {
    const token = getMockSessionToken();
    if (token) {
      await mockAuthRequest<{ ok: true }>("signout", { token }).catch(() => null);
    }
    clearMockSessionToken();
    return { ok: true, value: undefined };
  }

  async resetPassword(email: string): Promise<AuthResult<void>> {
    const result = await mockAuthRequest<{ ok: true }>("reset", { email });
    if ("error" in result) {
      return { ok: false, error: mapMockAuthError(result.error) };
    }
    return { ok: true, value: undefined };
  }
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

let authServiceSingleton: AuthService | null = null;

/** Get the auth service for the current cloud environment. */
export function getAuthService(): AuthService {
  if (authServiceSingleton) return authServiceSingleton;
  const env = getCloudEnvironment();
  authServiceSingleton =
    env.kind === "supabase" ? new SupabaseAuthService() : new MockAuthService();
  return authServiceSingleton;
}

/** Test hook. */
export function setAuthServiceForTests(service: AuthService | null): void {
  authServiceSingleton = service;
}

// ---------------------------------------------------------------------------
// Error mapping helpers
// ---------------------------------------------------------------------------

function mapSupabaseAuthError(message: string) {
  return mapProviderAuthError({ message });
}

function mapMockAuthError(error: { code: string; message: string }) {
  switch (error.code) {
    case "EMAIL_TAKEN":
      return makeAuthError("EMAIL_ALREADY_REGISTERED", "That email is already in use. Try signing in instead.");
    case "INVALID_CREDENTIALS":
      return makeAuthError("INVALID_CREDENTIALS", "That email or password isn't right. Try again.");
    case "WEAK_PASSWORD":
      return makeAuthError("WEAK_PASSWORD", "Your password needs to be at least 6 characters.");
    case "INVALID_EMAIL":
      return makeAuthError("INVALID_EMAIL", "Please enter a valid email address.");
    case "RATE_LIMITED":
      return makeAuthError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.");
    case "NETWORK_FAILED":
      return makeAuthError("NETWORK_FAILED", "Couldn't reach the sign-in service. Check your connection and try again.");
    default:
      return makeAuthError("UNKNOWN", error.message || "Something went wrong. Please try again.");
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
