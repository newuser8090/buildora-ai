// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — MockHttpCollabTransport
//
// Implements CollaborationTransport against the in-memory mock room backend
// exposed through Next.js API routes (/api/collab/...). Only active when the
// cloud environment is "mock". State lives in the dev-server process so two
// browser contexts share ONE room (deterministic multi-user E2E).
//
// Semantics mirror the production (Supabase) path:
//   - join returns { seq, checkpointSeq, base } where `base` is the current
//     durable workspace project payload (atomically consistent with the room)
//   - the client inits its Y.Doc from `base`, then polls updates after seq
//   - a poll that falls behind the pruned frontier returns `rebase: true` and
//     the client re-inits from the durable base (never a silent overwrite)
//   - sends are async (no fake synchronous behavior); viewer/removed members
//     are rejected server-side
// ---------------------------------------------------------------------------

import { makeWorkspaceError } from "@/features/workspaces/errors";
import { getMockSessionToken } from "@/features/cloud-sync/providers/mock-session";
import {
  COLLAB_MAX_UPDATE_BYTES,
  COLLAB_OFFLINE_QUEUE_MAX,
  COLLAB_OFFLINE_QUEUE_MAX_BYTES,
} from "../types";
import type { CollabConnectOptions, CollabJoinResult, CollabTransport } from "./collab-transport";
import type {
  CollabRoomRef,
  CollabSeedResult,
  CollabTestControls,
  CollabTransportMessage,
  CollabTransportPhase,
} from "../types";

interface RoomEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface JoinResponse {
  seq: number;
  checkpointSeq: number;
  base: unknown;
  state?: string;
}

interface PollResponse {
  seq: number;
  checkpointSeq: number;
  rebase: boolean;
  base?: unknown;
  updates: Array<{ seq: number; data: string; actorClientId?: string }>;
}

const POLL_MS = 500;

async function roomFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getMockSessionToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`/api/collab/${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw makeWorkspaceError(
      "NETWORK_FAILED",
      "Couldn't reach the collaboration service. Please try again.",
    );
  }
  const envelope = (await response.json().catch(() => null)) as RoomEnvelope<T> | null;
  if (response.ok && envelope?.ok) return envelope.data as T;

  const code = envelope?.error?.code ?? "UNKNOWN";
  const message = envelope?.error?.message ?? "This couldn't be completed right now.";
  throw makeWorkspaceError(code as never, message, code);
}

export class MockHttpCollabTransport implements CollabTransport {
  readonly kind = "mock" as const;

  private room: CollabRoomRef | null = null;
  private options: CollabConnectOptions | null = null;
  private seq = -1;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private messageCbs = new Set<(m: CollabTransportMessage) => void>();
  private statusCbs = new Set<(p: CollabTransportPhase) => void>();
  private authErrorCbs = new Set<() => void>();
  private phase: CollabTransportPhase = "disconnected";
  private disposed = false;
  private forcedOffline = false;
  // Bounded offline queue (architecture §32/§39): Yjs updates are idempotent,
  // so flushing the queue on reconnect merges safely with online edits. Never
  // grows unbounded — count and byte caps; excess offline edits are dropped
  // and the session falls back to rebase-from-checkpoint on reconnect.
  private offlineQueue: Uint8Array[] = [];
  private offlineQueueBytes = 0;

  // Test controls (exposed only when explicitly enabled).
  testControls: CollabTestControls | undefined;

  constructor(options?: { exposeTestControls?: boolean }) {
    if (options?.exposeTestControls) {
      this.testControls = {
        forceDisconnect: () => {
          this.forcedOffline = true;
          this.setPhase("offline");
          this.clearPollTimer();
        },
        forceReconnect: () => {
          this.forcedOffline = false;
          if (this.room && this.options) {
            this.setPhase("reconnecting");
            void this.startPolling();
          }
        },
      };
    }
  }

  private setPhase(phase: CollabTransportPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.statusCbs.forEach((cb) => cb(phase));
  }

  private clearPollTimer(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async connect(room: CollabRoomRef, options: CollabConnectOptions): Promise<CollabJoinResult> {
    this.room = room;
    this.options = options;
    this.disposed = false;
    this.forcedOffline = false;
    this.setPhase("connecting");
    try {
      const joined = await roomFetch<JoinResponse>(
        `rooms/${room.workspaceId}/${encodeURIComponent(room.projectId)}/join`,
        { method: "POST", body: {} },
      );
      if (this.disposed) throw new Error("disposed");
      this.seq = joined.checkpointSeq;
      this.setPhase("connected");
      void this.startPolling();
      return {
        base: joined.base,
        seq: joined.checkpointSeq,
        ...(joined.state ? { state: joined.state } : {}),
      };
    } catch (err) {
      // Phase P21 (F1) — PRESERVE the underlying workspace error (do not
      // swallow it into a generic Error). roomFetch already maps failures to
      // structured workspace errors (NETWORK_FAILED on fetch loss; the server
      // code — PERMISSION_DENIED / SESSION_EXPIRED / NOT_FOUND / … — on an
      // error envelope), and the session's connect diagnostics and the
      // authorization-loss transition depend on that code:
      //   - the P18/P19 diagnostic logs the REAL code (an operator can tell a
      //     join-time PERMISSION_DENIED from a transient outage)
      //   - useCollaborationSession distinguishes connect-time authorization
      //     loss (→ honest read-only) from a transient failure (→ bounded
      //     reconnect) — parity with the Supabase transport, which already
      //     preserves the code (a stale join from a removed/downgraded member
      //     is security-under-failure relevant: the editor must NOT keep
      //     editing locally as if nothing happened)
      this.setPhase("error");
      throw err;
    }
  }

  async seed(state: Uint8Array): Promise<CollabSeedResult> {
    if (!this.room) {
      throw makeWorkspaceError("PERMISSION_DENIED", "You can't join this room right now.");
    }
    return roomFetch<CollabSeedResult>(
      `rooms/${this.room.workspaceId}/${encodeURIComponent(this.room.projectId)}/seed`,
      { method: "POST", body: { state: arrayToBase64(state) } },
    );
  }

  async send(update: Uint8Array): Promise<void> {
    if (!this.room || !this.options?.canSend) {
      throw makeWorkspaceError(
        "PERMISSION_DENIED",
        "You can't edit this project right now.",
      );
    }
    if (update.byteLength > COLLAB_MAX_UPDATE_BYTES) {
      throw makeWorkspaceError(
        "PAYLOAD_TOO_LARGE",
        "That change is too large to share.",
      );
    }
    if (this.forcedOffline || this.phase === "offline") {
      // Offline editing: queue locally (bounded). Yjs updates are idempotent,
      // so a later flush never corrupts the merged state.
      if (
        this.offlineQueue.length < COLLAB_OFFLINE_QUEUE_MAX &&
        this.offlineQueueBytes + update.byteLength <= COLLAB_OFFLINE_QUEUE_MAX_BYTES
      ) {
        this.offlineQueue.push(update);
        this.offlineQueueBytes += update.byteLength;
      }
      return; // queued — status is already honest (offline)
    }
    await roomFetch<{ seq: number }>(
      `rooms/${this.room.workspaceId}/${encodeURIComponent(this.room.projectId)}/send`,
      {
        method: "POST",
        body: {
          update: arrayToBase64(update),
          // Relay the sender's client id so receivers can attribute the live
          // change hint ("A teammate updated this project") — parity with the
          // Supabase broadcast, which always carries actorClientId.
          actorClientId: this.options?.clientId,
        },
      },
    );
  }

  /** Replay queued offline updates (idempotent Yjs merges) after reconnect. */
  private async flushOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) return;
    const queued = this.offlineQueue;
    this.offlineQueue = [];
    this.offlineQueueBytes = 0;
    for (const update of queued) {
      try {
        await roomFetch<{ seq: number }>(
          `rooms/${this.room!.workspaceId}/${encodeURIComponent(this.room!.projectId)}/send`,
          {
            method: "POST",
            body: {
              update: arrayToBase64(update),
              actorClientId: this.options?.clientId,
            },
          },
        );
      } catch (err) {
        // Authorization loss while flushing is NOT transient — surface it so
        // the session transitions to the honest read-only state (queued
        // uploads after permission loss must never silently retry forever;
        // the server rejects them regardless). Parity with the Supabase
        // transport's flush (Phase P17 F3).
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (
          code === "PERMISSION_DENIED" ||
          code === "SESSION_EXPIRED" ||
          code === "LEASE_INVALID"
        ) {
          this.fireAuthError();
          return;
        }
        // Re-queue on failure (bounded); the next reconnect retries.
        if (
          this.offlineQueue.length < COLLAB_OFFLINE_QUEUE_MAX &&
          this.offlineQueueBytes + update.byteLength <= COLLAB_OFFLINE_QUEUE_MAX_BYTES
        ) {
          this.offlineQueue.push(update);
          this.offlineQueueBytes += update.byteLength;
        }
        break;
      }
    }
  }

  async checkpoint(seq: number, state?: Uint8Array): Promise<void> {
    if (!this.room) return;
    try {
      await roomFetch(
        `rooms/${this.room.workspaceId}/${encodeURIComponent(this.room.projectId)}/checkpoint`,
        {
          method: "POST",
          body: {
            seq,
            ...(state ? { state: arrayToBase64(state) } : {}),
          },
        },
      );
    } catch {
      // Best-effort — the room prunes at the next successful checkpoint.
    }
  }

  async lock(room: CollabRoomRef): Promise<void> {
    await roomFetch(
      `rooms/${room.workspaceId}/${encodeURIComponent(room.projectId)}/lock`,
      { method: "POST", body: {} },
    );
  }

  async unlock(room: CollabRoomRef): Promise<void> {
    await roomFetch(
      `rooms/${room.workspaceId}/${encodeURIComponent(room.projectId)}/unlock`,
      { method: "POST", body: {} },
    );
  }

  onMessage(callback: (m: CollabTransportMessage) => void): () => void {
    this.messageCbs.add(callback);
    return () => this.messageCbs.delete(callback);
  }

  onStatus(callback: (p: CollabTransportPhase) => void): () => void {
    this.statusCbs.add(callback);
    return () => this.statusCbs.delete(callback);
  }

  onAuthError(callback: () => void): () => void {
    this.authErrorCbs.add(callback);
    return () => this.authErrorCbs.delete(callback);
  }

  private fireAuthError(): void {
    this.clearPollTimer();
    this.authErrorCbs.forEach((cb) => cb());
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    this.clearPollTimer();
    this.room = null;
    this.options = null;
    this.messageCbs.clear();
    this.statusCbs.clear();
    this.authErrorCbs.clear();
    this.setPhase("disconnected");
  }

  // -------------------------------------------------------------------------
  // Polling
  // -------------------------------------------------------------------------

  private async startPolling(): Promise<void> {
    if (!this.room || !this.options) return;
    if (this.disposed || this.forcedOffline) return;
    try {
      const polled = await roomFetch<PollResponse>(
        `rooms/${this.room.workspaceId}/${encodeURIComponent(this.room.projectId)}?afterSeq=${this.seq}`,
      );
      if (this.disposed || this.forcedOffline) return;
      if (this.phase === "offline" || this.offlineQueue.length > 0) {
        // Came back online: flush queued local edits FIRST (idempotent),
        // then apply anything the room has for us.
        await this.flushOfflineQueue();
        if (this.disposed) return;
      }
      if (polled.rebase) {
        // The durable base advanced past our frontier: re-init from it.
        this.messageCbs.forEach((cb) =>
          cb({
            update: "",
            seq: -1,
            snapshot: true,
            rebase: true,
            base: polled.base,
          } as CollabTransportMessage),
        );
        this.seq = polled.checkpointSeq;
      } else {
        for (const item of polled.updates) {
          if (item.seq <= this.seq) continue;
          this.messageCbs.forEach((cb) =>
            cb({ update: item.data, seq: item.seq, actorClientId: item.actorClientId }),
          );
          this.seq = Math.max(this.seq, item.seq);
        }
      }
      this.setPhase("connected");
    } catch (err) {
      if (this.disposed) return;
      // Authorization loss while polling (removed/downgraded member) is NOT a
      // network problem — surface it immediately and stop polling.
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "PERMISSION_DENIED" || code === "SESSION_EXPIRED" || code === "AUTH_REQUIRED") {
        this.fireAuthError();
        return;
      }
      this.setPhase("offline");
    } finally {
      if (!this.disposed && !this.forcedOffline) {
        this.pollTimer = setTimeout(() => void this.startPolling(), POLL_MS);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Binary helpers (base64 ↔ Uint8Array)
// ---------------------------------------------------------------------------

export function arrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
