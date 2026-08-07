"use client";

// ---------------------------------------------------------------------------
// Auth (Phase P6) — useAuth hook
// ---------------------------------------------------------------------------

import { useAuthStore } from "./auth-store";
import type { AuthError, AuthSession, AuthStatus } from "./types";

export interface UseAuthResult {
  status: AuthStatus;
  session: AuthSession | null;
  user: AuthSession["user"] | null;
  busy: boolean;
  error: AuthError | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  clearError: () => void;
}

export function useAuth(): UseAuthResult {
  const status = useAuthStore((s) => s.status);
  const session = useAuthStore((s) => s.session);
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const signOut = useAuthStore((s) => s.signOut);
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const clearError = useAuthStore((s) => s.clearError);

  return {
    status,
    session,
    user: session?.user ?? null,
    busy,
    error,
    signIn,
    signUp,
    signOut,
    resetPassword,
    clearError,
  };
}
