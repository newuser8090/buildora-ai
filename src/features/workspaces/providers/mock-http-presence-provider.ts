// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: MockHttpPresenceProvider (dev/test backend)
//
// Implements PresenceProvider against the in-memory mock presence transport
// (/api/presence/...). Only active when the cloud environment is "mock". The
// mock keeps state server-side so E2E can simulate two accounts observing
// each other's presence against the same "cloud".
// ---------------------------------------------------------------------------

import { getMockSessionToken } from "@/features/cloud-sync/providers/mock-session";
import { makeWorkspaceError } from "../errors";
import type { WorkspacePresence } from "../types";
import type { PresenceJoinInput, PresenceProvider } from "./presence-provider";

interface MockEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function presenceFetch<T>(
  path: string,
  options: { method?: string; body?: unknown },
): Promise<T> {
  const token = getMockSessionToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api/presence/${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw makeWorkspaceError(
      "NETWORK_FAILED",
      "Couldn't reach the presence service. Please try again.",
    );
  }

  const envelope = (await response.json().catch(() => null)) as MockEnvelope<T> | null;
  if (response.ok && envelope?.ok) return envelope.data as T;
  throw makeWorkspaceError(
    "NETWORK_FAILED",
    envelope?.error?.message ?? "This couldn't be completed right now.",
  );
}

export class MockHttpPresenceProvider implements PresenceProvider {
  readonly kind = "mock" as const;

  async join(input: PresenceJoinInput): Promise<void> {
    await presenceFetch<void>("join", {
      method: "POST",
      body: {
        workspaceId: input.workspaceId,
        projectId: input.projectId ?? null,
        sessionId: input.sessionId,
      },
    });
  }

  async heartbeat(
    _workspaceId: string,
    sessionId: string,
    _mode: import("../types").WorkspacePresenceMode,
  ): Promise<void> {
    await presenceFetch<void>("heartbeat", {
      method: "POST",
      body: { sessionId },
    });
  }

  async leave(sessionId: string): Promise<void> {
    await presenceFetch<void>("leave", {
      method: "POST",
      body: { sessionId },
    });
  }

  async getPresence(
    workspaceId: string,
    projectId?: string | null,
  ): Promise<WorkspacePresence[]> {
    const query = projectId
      ? `?projectId=${encodeURIComponent(projectId)}`
      : "";
    return presenceFetch<WorkspacePresence[]>(
      `workspace/${encodeURIComponent(workspaceId)}${query}`,
      {},
    );
  }

  subscribe(
    _workspaceId: string,
    _onPresence: (presence: WorkspacePresence[]) => void,
  ): () => void {
    // The mock transport has no push channel — the hook polls getPresence.
    return () => {};
  }
}
