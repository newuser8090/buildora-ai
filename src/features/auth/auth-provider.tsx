"use client";

// ---------------------------------------------------------------------------
// Auth (Phase P6) — provider
//
// Initializes the auth store on mount, subscribes to provider auth-state
// changes (Supabase push; mock store-driven), and reacts to state changes:
//   - sign-in  → notify the cloud-sync layer to start (initial merge / sync)
//   - sign-out → notify the cloud-sync layer to cancel active sync and clear
//                remote session state (local data is retained)
// ---------------------------------------------------------------------------

import { useEffect, useRef, type ReactNode } from "react";
import { useAuthStore } from "./auth-store";
import { getAuthService } from "./auth-service";

export const AUTH_STATE_CHANGED_EVENT = "buildora:auth-state-changed";

export interface AuthStateSnapshot {
  signedIn: boolean;
  userId?: string;
  email?: string;
}

function emitAuthChanged(snapshot: AuthStateSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuthStateSnapshot>(AUTH_STATE_CHANGED_EVENT, { detail: snapshot }),
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const store = useAuthStore;
    void store.getState().initialize();

    const service = getAuthService();
    const unsubscribe = service.onAuthStateChange((session) => {
      // Provider push (Supabase). Keep the store in sync.
      if (session) {
        store.setState({ status: "signed-in", session, error: null });
        emitAuthChanged({ signedIn: true, userId: session.user.id, email: session.user.email });
      } else {
        store.setState({ status: "signed-out", session: null, error: null });
        emitAuthChanged({ signedIn: false });
      }
    });

    // React to store-driven transitions too (mock service + store sign-in/out).
    const unsubscribeStore = store.subscribe((state, prev) => {
      if (state.status === prev.status) return;
      if (state.status === "signed-in" && state.session) {
        emitAuthChanged({
          signedIn: true,
          userId: state.session.user.id,
          email: state.session.user.email,
        });
      } else if (state.status === "signed-out") {
        emitAuthChanged({ signedIn: false });
      }
    });

    return () => {
      unsubscribe();
      unsubscribeStore();
    };
  }, []);

  return <>{children}</>;
}
