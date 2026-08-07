"use client";

// ---------------------------------------------------------------------------
// Cloud Sync (Phase P6) — lifecycle provider
//
// Wires the sync runtime to app events:
//   - auth state changes → cancel/start sync; initial merge flow on sign-in
//   - online/offline → status + immediate sync on reconnect
//   - periodic low-frequency sync while signed in and active
//   - local mutations → durable queue via the change listener (debounced)
//
// Local-first: when no cloud provider is configured, all listeners are no-ops
// and the app runs purely on IndexedDB.
// ---------------------------------------------------------------------------

import { useEffect, useRef, type ReactNode } from "react";
import {
  AUTH_STATE_CHANGED_EVENT,
  type AuthStateSnapshot,
} from "@/features/auth/auth-provider";
import { useAuthStore } from "@/features/auth/auth-store";
import { useCloudSyncStore } from "./store/cloud-sync-store";
import {
  getInitialMergeService,
  getSyncConflictStore,
  getSyncEngine,
  getSyncQueue,
  syncNow,
  wireMutationListener,
  SYNC_PERIODIC_INTERVAL,
} from "./sync-runtime";
import { clearCachedSharedDataForUser } from "@/features/shared-libraries/services/shared-library-cache";
import { InitialMergeDialog } from "./components/InitialMergeDialog";
import { CloudConflictDialog } from "./components/CloudConflictDialog";
import { SharedLibrariesPanel } from "@/features/shared-libraries/components/SharedLibrariesPanel";

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const engine = getSyncEngine();
    if (!engine) {
      // Local-only mode: keep the status honest, no listeners.
      useCloudSyncStore.setState({ status: "signed-out", online: true });
      return;
    }

    const store = useCloudSyncStore;
    const authStore = useAuthStore;

    // ---- Auth lifecycle ----
    const handleAuthChanged = (event: Event) => {
      const detail = (event as CustomEvent<AuthStateSnapshot>).detail;
      if (detail.signedIn && detail.userId) {
        store.getState().setActiveUser(detail.userId);
        void handleSignIn(detail.userId);
      } else {
        store.getState().resetForSignOut();
        engine.cancel();
        if (detail.userId) {
          // Sign-out policy: never retain another user's cached shared data.
          clearCachedSharedDataForUser(detail.userId);
        }
      }
    };

    const handleSignIn = async (userId: string) => {
      try {
        await engine.prepareForSignIn(userId);
        const mergeService = getInitialMergeService();
        if (mergeService) {
          const decided = await mergeService.hasDecision(userId);
          if (!decided) {
            const summary = await mergeService.computeSummary(userId);
            if (summary.localCount > 0 || summary.cloudCount > 0) {
              store.getState().openInitialMerge();
              return; // the merge dialog drives the next step
            }
            await mergeService.recordDecision(userId, "merge");
          }
        }
        await syncNow();
      } catch {
        // Sign-in sync failure never blocks local editing.
        store.getState().setStatus("error");
      }
    };

    // ---- Online / offline ----
    const handleOnline = () => {
      store.setState({ online: true });
      const auth = authStore.getState();
      if (auth.status === "signed-in") void syncNow();
    };
    const handleOffline = () => {
      store.setState({ online: false, status: "offline" });
    };

    // ---- Local mutation listener (enqueue + debounced sync) ----
    const unwireMutations = wireMutationListener();

    // ---- Periodic low-frequency sync while signed in + active ----
    const periodic = setInterval(() => {
      const auth = authStore.getState();
      const ui = store.getState();
      if (
        auth.status === "signed-in" &&
        ui.online &&
        ui.status !== "syncing"
      ) {
        void syncNow();
      }
    }, SYNC_PERIODIC_INTERVAL);

    // ---- Initial state refresh of counts ----
    const refreshCounts = async () => {
      const auth = authStore.getState();
      if (auth.status !== "signed-in" || !auth.session) return;
      const conflictsStore = getSyncConflictStore();
      const queue = getSyncQueue();
      const open = await conflictsStore?.countOpen(auth.session.user.id) ?? 0;
      const pending = await queue?.countPending(auth.session.user.id) ?? 0;
      store.setState({ conflictCount: open, pendingUploadCount: pending });
    };
    void refreshCounts();

    window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // The auth store may already be signed in (session restored before mount).
    const initial = authStore.getState();
    if (initial.status === "signed-in" && initial.session) {
      handleAuthChanged(
        new CustomEvent<AuthStateSnapshot>(AUTH_STATE_CHANGED_EVENT, {
          detail: {
            signedIn: true,
            userId: initial.session.user.id,
            email: initial.session.user.email,
          },
        }),
      );
    }

    return () => {
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(periodic);
      unwireMutations();
      engine.cancel();
    };
  }, []);

  return (
    <>
      {children}
      {/* App-wide overlays: initial merge prompt, conflict review, shared libraries. */}
      <InitialMergeDialog />
      <CloudConflictDialog />
      <SharedLibrariesPanel />
    </>
  );
}
