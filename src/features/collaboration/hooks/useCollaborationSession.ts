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

import { useEffect, useRef } from "react";
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

  useEffect(() => {
    const clearSession = () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      scopeRef.current = null;
      registerCollabSession(null);
      exposeTestControls(undefined);
      if (session) void session.stop();
    };

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
    });
    sessionRef.current = session;
    scopeRef.current = scopeKey;
    registerCollabSession(session);
    void session.start().catch((err) => {
      const error = toWorkspaceError(err);
      if (
        error.code === "PERMISSION_DENIED" ||
        error.code === "SESSION_EXPIRED"
      ) {
        useWorkspaceAccessStore.getState().setAccess({
          mode: "readonly",
          reason: "unauthorized",
        });
        clearSession();
      }
    });

    return clearSession;
    // `provider` is a stable singleton; the remaining deps describe the
    // session scope exactly.
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
  ]);
}
