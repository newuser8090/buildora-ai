// ---------------------------------------------------------------------------
// Auth (Phase P6) — transient auth store
//
// Holds the current session state and drives sign-in/out/reset through the
// injected AuthService. Transient UI state only — never persisted into
// ProjectSchema or editor history. Signing out NEVER deletes local data; it
// only clears the remote session state.
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type { AuthError, AuthStatus, AuthSession } from "./types";
import { getAuthService } from "./auth-service";

export interface AuthState {
  status: AuthStatus;
  session: AuthSession | null;
  error: AuthError | null;
  /** True while a sign-in/sign-up request is in flight (blocks double submits). */
  busy: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: "loading",
  session: null,
  error: null,
  busy: false,

  initialize: async () => {
    const service = getAuthService();
    if (!service.isConfigured()) {
      set({ status: "signed-out", session: null, error: null });
      return;
    }
    try {
      const session = await service.getSession();
      set({ status: session ? "signed-in" : "signed-out", session });
    } catch {
      set({ status: "signed-out", session: null });
    }
  },

  signIn: async (email, password) => {
    if (get().busy) return false;
    set({ busy: true, error: null });
    const service = getAuthService();
    const result = await service.signIn(email.trim(), password);
    if (result.ok) {
      set({ busy: false, status: "signed-in", session: result.value, error: null });
      return true;
    }
    set({ busy: false, error: result.error });
    return false;
  },

  signUp: async (email, password) => {
    if (get().busy) return false;
    set({ busy: true, error: null });
    const service = getAuthService();
    const result = await service.signUp(email.trim(), password);
    if (result.ok) {
      set({ busy: false, status: "signed-in", session: result.value, error: null });
      return true;
    }
    set({ busy: false, error: result.error });
    return false;
  },

  signOut: async () => {
    const service = getAuthService();
    await service.signOut();
    // Local data is intentionally retained. Only the remote session state is
    // cleared. Cached shared-library data is scoped by user id and re-checked
    // online, and queued entries stay isolated to their prior userId.
    set({ status: "signed-out", session: null, error: null });
  },

  resetPassword: async (email) => {
    if (get().busy) return false;
    set({ busy: true, error: null });
    const service = getAuthService();
    const result = await service.resetPassword(email.trim());
    set({ busy: false, error: result.ok ? null : result.error });
    return result.ok;
  },

  clearError: () => set({ error: null }),
}));
