"use client";

// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: useWorkspacePresence
//
// Owns the ephemeral presence session for the active workspace project:
//   - joins when a workspace project is open and the user is signed in
//   - heartbeats on a bounded interval (10 s) so the server TTL never expires
//     while the project is open
//   - reads the presence list (poll for mock / realtime for Supabase)
//   - leaves on unmount / project switch / workspace switch / sign-out
//   - mode is DERIVED from the P14 access store (editable+lease → editing),
//     which itself is server-resolved — the client can never claim editing
//   - StrictMode-safe: join is idempotent per sessionId; cleanup is registered
//     on every run; a simulated remount re-joins the same session
//
// Presence is best-effort: any failure is swallowed, never breaks editing, and
// never shows fake live state (a failed read clears the visible sessions).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/features/auth/useAuth";
import { useEditorStore } from "@/features/editor/store/editor-store";
import {
  PRESENCE_HEARTBEAT_MS,
  PRESENCE_POLL_MS,
} from "../constants";
import { getPresenceProvider } from "../services/presence-service";
import { useWorkspaceAccessStore } from "../store/workspace-access-store";
import {
  useWorkspacePresenceStore,
} from "../store/workspace-presence-store";
import type { WorkspacePresenceMode } from "../types";

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pres-${crypto.randomUUID()}`;
  }
  return `pres-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function useWorkspacePresence(): void {
  const { status, user } = useAuth();
  const activeProjectId = useEditorStore((s) => s.activeProjectId);
  const isHydrated = useEditorStore((s) => s.isHydrated);
  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);

  const sessionIdRef = useRef<string | null>(null);
  const scopeRef = useRef<{ workspaceId: string; projectId: string | null } | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRealtimeRef = useRef<(() => void) | null>(null);
  const joinedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (unsubRealtimeRef.current) {
      unsubRealtimeRef.current();
      unsubRealtimeRef.current = null;
    }
  }, []);

  const resetPresence = useCallback(async () => {
    clearTimers();
    const provider = getPresenceProvider();
    const sessionId = sessionIdRef.current;
    const joined = joinedRef.current;
    sessionIdRef.current = null;
    scopeRef.current = null;
    joinedRef.current = false;
    useWorkspacePresenceStore.getState().reset();
    if (provider && sessionId && joined) {
      try {
        await provider.leave(sessionId);
      } catch {
        // Best-effort — an expired session is fine.
      }
    }
  }, [clearTimers]);

  // Sign-out while mounted → leave + clear (idempotent).
  useEffect(() => {
    if (status === "signed-out" && sessionIdRef.current) {
      void resetPresence();
    }
  }, [status, resetPresence]);

  useEffect(() => {
    if (!isHydrated || !activeProjectId || status !== "signed-in" || !user) return;
    if (!workspaceId) return;

    const scope = { workspaceId, projectId: activeProjectId };
    const provider = getPresenceProvider();
    if (!provider) return;

    // Scope switch: leave the previous session and reset before joining the
    // new one. Every run returns a cleanup so unmounts release the session.
    const prevScope = scopeRef.current;
    if (prevScope && (prevScope.workspaceId !== scope.workspaceId || prevScope.projectId !== scope.projectId)) {
      void resetPresence();
    }

    if (!sessionIdRef.current) {
      sessionIdRef.current = newSessionId();
    }
    const sessionId = sessionIdRef.current;
    scopeRef.current = scope;
    joinedRef.current = true;

    useWorkspacePresenceStore
      .getState()
      .setScope(scope.workspaceId, scope.projectId);

    const currentMode = (): WorkspacePresenceMode =>
      useWorkspaceAccessStore.getState().access.mode === "editable"
        ? "editing"
        : "viewing";

    let cancelled = false;

    const join = async () => {
      try {
        await provider.join({
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          sessionId,
          mode: currentMode(),
        });
        if (!cancelled) useWorkspacePresenceStore.getState().setActive(true);
      } catch {
        // Best-effort — presence never breaks the editor.
        if (!cancelled) useWorkspacePresenceStore.getState().setDisconnected(true);
      }
    };
    void join();

    // Heartbeat: keeps the server TTL alive; Supabase re-tracks the latest
    // mode (a lost lease flips editing → viewing immediately).
    heartbeatRef.current = setInterval(() => {
      void provider
        .heartbeat(scope.workspaceId, sessionId, currentMode())
        .then(() => {
          if (!cancelled) useWorkspacePresenceStore.getState().setActive(true);
        })
        .catch(() => {
          // A failed heartbeat means the session may expire — stop pretending
          // we're live and let a future successful read repopulate.
          if (!cancelled) {
            useWorkspacePresenceStore.getState().setDisconnected(true);
          }
        });
    }, PRESENCE_HEARTBEAT_MS);

    // Read loop: mock polls the HTTP transport; Supabase uses the realtime
    // channel (no polling). A failed read clears visible sessions (honest).
    if (provider.kind === "mock") {
      const read = async () => {
        try {
          const list = await provider.getPresence(scope.workspaceId);
          if (!cancelled) useWorkspacePresenceStore.getState().setSessions(list);
        } catch {
          if (!cancelled) {
            useWorkspacePresenceStore.getState().setSessions([]);
          }
        }
      };
      void read();
      pollRef.current = setInterval(() => void read(), PRESENCE_POLL_MS);
    } else {
      unsubRealtimeRef.current = provider.subscribe(
        scope.workspaceId,
        (list) => {
          if (!cancelled) useWorkspacePresenceStore.getState().setSessions(list);
        },
      );
    }

    // Mode transitions while open (e.g. lease loss) → re-track immediately so
    // the presence list reflects truth without waiting for the next heartbeat.
    const unsubAccess = useWorkspaceAccessStore.subscribe((next, prev) => {
      if (next.access.mode !== prev.access.mode) {
        void provider
          .heartbeat(scope.workspaceId, sessionId, currentMode())
          .catch(() => {
            // Best-effort.
          });
      }
    });

    return () => {
      cancelled = true;
      unsubAccess();
      void resetPresence();
    };
    // `provider` is a stable factory singleton; the mode watch is re-created
    // per scope. The remaining deps describe the session scope exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, isHydrated, status, user?.id, workspaceId, resetPresence]);
}
