// ---------------------------------------------------------------------------
// Auth (Phase P6) — structured errors
//
// User-safe, deterministic errors. Account-existence information is never
// leaked beyond provider-safe behavior (sign-up and sign-in share the same
// generic failure message for unknown emails).
// ---------------------------------------------------------------------------

import type { AuthError, AuthErrorCode } from "./types";

export function makeAuthError(
  code: AuthErrorCode,
  message: string,
  cause?: string,
): AuthError {
  return { code, message, cause };
}

/**
 * Map a provider error (supabase-js AuthError or plain object) to a safe
 * AuthError. No raw provider messages, tokens, or status codes leak.
 */
export function mapProviderAuthError(
  err: unknown,
  fallbackMessage = "Something went wrong. Please try again.",
): AuthError {
  const message = err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : "";

  if (message.includes("already registered") || message.includes("already been registered")) {
    // Provider-safe: same phrasing as generic sign-in failures.
    return makeAuthError("EMAIL_ALREADY_REGISTERED", "That email is already in use. Try signing in instead.");
  }
  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return makeAuthError("INVALID_CREDENTIALS", "That email or password isn't right. Try again.");
  }
  if (message.includes("password should be") || message.includes("weak password")) {
    return makeAuthError("WEAK_PASSWORD", "Your password needs to be at least 6 characters.");
  }
  if (message.includes("invalid email") || message.includes("email address invalid")) {
    return makeAuthError("INVALID_EMAIL", "Please enter a valid email address.");
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return makeAuthError("RATE_LIMITED", "Too many attempts. Please wait a moment and try again.");
  }
  if (message.includes("network") || message.includes("fetch failed")) {
    return makeAuthError("NETWORK_FAILED", "Couldn't reach the sign-in service. Check your connection and try again.");
  }
  if (message.includes("session") && message.includes("expired")) {
    return makeAuthError("SESSION_EXPIRED", "Your session ended. Please sign in again.");
  }
  return makeAuthError("UNKNOWN", fallbackMessage, message || undefined);
}
