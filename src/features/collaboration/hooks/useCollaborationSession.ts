"use client";

// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — useCollaborationSession
//
// Owns the CollabSession lifecycle for the active workspace project:
//   - starts a session when a workspace project is open, access is resolved,
//     and the user is signed in (editors/owners → canSend, viewers → live
//     read-only, offline/unauthorized → no session)
//   - stops on unmount / project switch / workspace switch / sign-out / role
//     change (StrictMode-safe: cleanup registered on every run)
//   - registers the active session in the registry for maintenance-lock
//     consumers (version restore / import)
//   - on authorization loss (member removal / role downgrade while open) the
//     session is stopped and the access store transitions to read-only —
//     pending unauthorized mutations are never accepted server-side
//
// Personal projects and read-only previews never create a session.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/useAuth";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { useWorkspaceAccessStore } from "@/features/workspaces/store/workspace-access-store";
import { getWorkspaceProvider } from "@/features/workspaces/services/workspace-service";
import { toWorkspaceError } from "@/features/workspaces/errors";
import { createCollabTransport } from "../transport/collab-transport-factory";
import { CollabSession } from "../services/collab-session";
import { registerCollabSession } from "../services/collab-session-registry";
import type { CollabTestControls } from "../types";

// ---------------------------------------------------------------------------
// Dev-only test-controls bridge (deterministic E2E reconnect tests)
//
// When the collaboration session is created with exposeTestControls (mock/dev
// only — the Supabase transport never creates test controls), the active
// transport's forceDisconnect/forceReconnect are exposed on a single window
// global so Playwright can simulate network loss deterministically. Cleared on
// session teardown so a stale session can never leak controls.
// ---------------------------------------------------------------------------

const TEST_CONTROLS_KEY = "__buildoraCollabTestControls";

// ---------------------------------------------------------------------------
// Phase P21 (F2) — bounded reconnect after a TRANSIENT connect failure.
//
// Without this, a transient outage exactly at open (server restart / network
// blip / provider recovery) stranded a dead session forever: the editor kept
// working with local-only persistence (status bar "Saved" = IndexedDB), the
// workspace copy stayed stale, and a reload re-fetched the SERVER copy —
// silently discarding those local edits with no failure signal. The workspace
// access hook treats the server copy as authoritative on every open.
//
// The reconnect is bounded (max attempts, increasing delay) so a prolonged
// outage cannot cause a reconnect storm, and it only fires for codes that are
// plausibly transient. Authorization loss at connect (PERMISSION_DENIED /
// SESSION_EXPIRED) is NOT retried — it transitions to the honest read-only
// state, matching the established auth-loss contract.
// ---------------------------------------------------------------------------

/** Codes that justify re-trying the room join (fresh transport each try). */
const CONNECT_RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "NETWORK_FAILED",
  "OFFLINE",
  "RATE_LIMITED",
  "MALFORMED_RESPONSE",
  // Unknown/capped: a generic failure (e.g. a Supabase RPC error with an
  // unmapped code during an outage) is retried a bounded number of times and
  // then abandoned — the attempt budget bounds any hammering on a real bug.
  "UNKNOWN",
]);

const MAX_CONNECT_RETRIES = 3;
const CONNECT_RETRY_DELAYS_MS = [2_000, 4_000, 8_000];

function exposeTestControls(controls: CollabTestControls | undefined): void {
  if (typeof window === "undefined") return;
  if (controls) {
    (window as unknown as Record<string, CollabTestControls>)[TEST_CONTROLS_KEY] =
      controls;
  } else {
    delete (window as unknown as Record<string, unknown>)[TEST_CONTROLS_KEY];
  }
}

function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `collab-${crypto.randomUUID()}`;
  }
  return `collab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function useCollaborationSession(options?: {
  exposeTestControls?: boolean;
}): void {
  const { status, user } = useAuth();
  const activeProjectId = useEditorStore((s) => s.activeProjectId);
  const isHydrated = useEditorStore((s) => s.isHydrated);
  const workspaceId = useWorkspaceAccessStore((s) => s.workspaceId);
  const role = useWorkspaceAccessStore((s) => s.role);
  const accessMode = useWorkspaceAccessStore((s) => s.access.mode);
  const loading = useWorkspaceAccessStore((s) => s.loading);
  const offline = useWorkspaceAccessStore((s) => s.offline);

  const sessionRef = useRef<CollabSession | null>(null);
  const scopeRef = useRef<string | null>(null);
  const clientIdRef = useRef<string>(newClientId());
  // Retry bookkeeping (bounded): scope → attempt count, so a scope switch
  // resets the budget and consecutive failures in the SAME scope share it.
  const retryStateRef = useRef<{ scope: string; count: number } | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumping this re-runs the effect, which re-creates the session after a
  // transient connect failure (the editor-page controller-retry pattern).
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const clearSession = () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      scopeRef.current = null;
      registerCollabSession(null);
      exposeTestControls(undefined);
      if (session) void session.stop();
    };
    // Cancel any pending reconnect timer (scope change / unmount).
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // No session when: not signed in, no workspace project, access unresolved
    // (still loading), or offline. Personal projects and read-only previews
    // never start a session (workspaceId is null for them).
    const noSession =
      status !== "signed-in" ||
      !user?.id ||
      !workspaceId ||
      !activeProjectId ||
      !isHydrated ||
      loading ||
      offline;
    if (noSession) {
      if (sessionRef.current) clearSession();
      return clearSession;
    }

    const canSend =
      accessMode === "editable" && (role === "editor" || role === "owner");
    const scopeKey = `${workspaceId}:${activeProjectId}:${canSend ? "w" : "r"}`;
    if (scopeRef.current === scopeKey && sessionRef.current) {
      return clearSession; // same scope — keep the session
    }

    clearSession();

    const provider = getWorkspaceProvider();
    if (!provider) return clearSession;

    const transport = createCollabTransport({
      exposeTestControls: options?.exposeTestControls,
    });
    exposeTestControls(transport.testControls);

    // Phase P21 (F2) — classify a CONNECT failure by its code. start()
    // resolves (the editor falls back to local persistence), so this is the
    // only signal the hook gets. A failure from a session that was already
    // torn down (unmount raced the join) is ignored.
    const handleConnectFailure = (code: string) => {
      if (sessionRef.current !== session) return;
      if (
        code === "PERMISSION_DENIED" ||
        code === "SESSION_EXPIRED"
      ) {
        // Connect-time authorization loss (removed/downgraded member, stale
        // session) → honest read-only; never retried (the server is the
        // authority and would reject every re-join).
        useWorkspaceAccessStore.getState().setAccess({
          mode: "readonly",
          reason: "unauthorized",
        });
        clearSession();
        return;
      }
      if (CONNECT_RETRYABLE_CODES.has(code)) {
        // Transient failure: tear the dead session down and retry with a
        // bounded budget. Without this the editor stays local-only forever —
        // and a reload then silently discards those edits because the
        // workspace server copy is authoritative on reopen.
        clearSession();
        const prev = retryStateRef.current;
        const attempt =
          prev && prev.scope === scopeKey ? prev.count + 1 : 1;
        retryStateRef.current = { scope: scopeKey, count: attempt };
        if (attempt <= MAX_CONNECT_RETRIES) {
          const delay =
            CONNECT_RETRY_DELAYS_MS[
              Math.min(attempt - 1, CONNECT_RETRY_DELAYS_MS.length - 1)
            ];
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            setRetryTick((t) => t + 1);
          }, delay);
        }
        // Budget exhausted → keep the standard local fallback (collab status
        // shows "error"; the room can still be re-entered on the next
        // open/scope change).
        return;
      }
      // Permanent failure (NOT_CONFIGURED / NOT_FOUND / …) → keep the local
      // fallback; retrying cannot help.
    };

    const session = new CollabSession({
      room: { workspaceId, projectId: activeProjectId },
      clientId: clientIdRef.current,
      canSend,
      transport,
      onAuthorizationLost: () => {
        // Member removal / role downgrade while open → safe read-only
        // transition. The server also rejects any pending sends.
        useWorkspaceAccessStore.getState().setAccess({
          mode: "readonly",
          reason: "unauthorized",
        });
        clearSession();
      },
      onConnectError: handleConnectFailure,
    });
    sessionRef.current = session;
    scopeRef.current = scopeKey;
    registerCollabSession(session);
    void session.start().catch((err) => {
      // Defensive: start() only rejects on unexpected (non-connect) throws;
      // classify them with the same bounded logic.
      handleConnectFailure(toWorkspaceError(err).code);
    });

    return clearSession;
    // `provider` is a stable singleton; the remaining deps describe the
    // session scope exactly (retryTick re-runs this effect after a bounded
    // reconnect delay).
  }, [
    activeProjectId,
    isHydrated,
    status,
    user?.id,
    workspaceId,
    role,
    accessMode,
    loading,
    offline,
    options?.exposeTestControls,
    retryTick,
  ]);
}
