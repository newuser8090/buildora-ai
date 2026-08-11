// ---------------------------------------------------------------------------
// Collaborative editing (Phase P16) — SupabaseCollabTransport (production path)
//
// Real-time relay: one Realtime Broadcast channel per workspace project
// (collab:{workspaceId}:{projectId}). Broadcast payloads are binary Yjs
// updates encoded as base64 — small, incremental, never whole-project JSON.
//
// Channel authorization: the channel itself carries no durable state; sending
// is gated by an RLS-checked RPC (ws_collab_append_update — editor/owner only,
// actor from auth.uid()). Receiving is allowed for members (viewers included —
// they must see live updates without mutating). Realtime channel read access
// for members is enforced via RLS on the collab updates table being in the
// realtime publication.
//
// Durability: the P15 workspace save path is the durable checkpoint; this
// transport exposes checkpoint() to prune the update log the server retains
// (the save RPC advances the frontier automatically). The maintenance lock
// (restore/import) is owner-only RPC (ws_collab_lock / ws_collab_unlock).
//
// Lifecycle: one channel per room, unsubscribe on disconnect, no duplicate
// subscriptions, rejoin on reconnect. Account/project switches tear the
// channel down (the session service destroys and recreates the transport).
// ---------------------------------------------------------------------------

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/features/auth/supabase-client";
import {
  makeWorkspaceError,
  type WorkspaceErrorCode,
} from "@/features/workspaces/errors";
import {
  COLLAB_MAX_UPDATE_BYTES,
  COLLAB_OFFLINE_QUEUE_MAX,
  COLLAB_OFFLINE_QUEUE_MAX_BYTES,
} from "../types";

/** Codes the collab RPCs raise; recognized inside the generic error message. */
const COLLAB_RPC_CODES: readonly string[] = [
  "PERMISSION_DENIED",
  "PAYLOAD_TOO_LARGE",
  "LOCKED",
  "NOT_FOUND",
  "NOT_CONFIGURED",
];

function COLLAB_RPC_CODE_IN_MESSAGE(message: string): string | null {
  const upper = message.toUpperCase();
  for (const code of COLLAB_RPC_CODES) {
    if (upper.includes(code)) return code;
  }
  return null;
}
import type {
  CollabRoomRef,
  CollabSeedResult,
  CollabTestControls,
  CollabTransportMessage,
  CollabTransportPhase,
} from "../types";
import type {
  CollabConnectOptions,
  CollabJoinResult,
  CollabTransport,
} from "./collab-transport";
import { arrayToBase64 } from "./mock-http-collab-transport";

interface CollabDurableState {
  seq: number;
  checkpointSeq: number;
  base: unknown;
  state?: string;
}

export class SupabaseCollabTransport implements CollabTransport {
  readonly kind = "supabase" as const;

  private room: CollabRoomRef | null = null;
  private options: CollabConnectOptions | null = null;
  private channel: RealtimeChannel | null = null;
  private seq = -1;
  private disposed = false;
  private messageCbs = new Set<(m: CollabTransportMessage) => void>();
  private statusCbs = new Set<(p: CollabTransportPhase) => void>();
  private authErrorCbs = new Set<() => void>();
  private phase: CollabTransportPhase = "disconnected";
  // Bounded offline queue (architecture §23/§32) — mirrors the mock transport
  // so both paths behave identically offline: Yjs updates are idempotent, so
  // flushing on reconnect merges safely with edits made while offline. Never
  // grows unbounded — count + byte caps; excess offline edits are dropped and
  // the session falls back to rebase-from-checkpoint on reconnect. Authorization
  // errors are NEVER queued (they propagate and end the session).
  private offlineQueue: Uint8Array[] = [];
  private offlineQueueBytes = 0;
  /**
   * Bumped whenever the channel errors/closes. The async SUBSCRIBED handler
   * captures the epoch when it STARTS and only claims "connected" when no
   * newer close/error superseded it — a stale catch-up completion (its
   * readDurable was in flight across a network drop) must never flip a
   * genuinely-offline transport back to connected, which would silently skip
   * the offline queue for subsequent sends.
   */
  private channelEpoch = 0;

  private client() {
    const client = getSupabaseClient();
    if (!client) {
      throw makeWorkspaceError("NOT_CONFIGURED", "Collaboration isn't set up yet.");
    }
    return client;
  }

  private setPhase(phase: CollabTransportPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.statusCbs.forEach((cb) => cb(phase));
  }

  /**
   * Call an RPC and normalize failures into workspace error codes. PL/pgSQL
   * `raise exception 'CODE'` surfaces as error.code "P0001" with the code text
   * in the message — the session's authorization/lock handling depends on the
   * REAL code (PERMISSION_DENIED / LOCKED / PAYLOAD_TOO_LARGE / …), so it is
   * extracted here for parity with the mock transport.
   */
  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client().rpc(fn, args);
    if (error) {
      const message = error.message ?? "";
      const code = COLLAB_RPC_CODE_IN_MESSAGE(message) ?? error.code ?? "UNKNOWN";
      throw makeWorkspaceError(
        code as WorkspaceErrorCode,
        message,
        error.code ?? undefined,
      );
    }
    return data as T;
  }

  /** Read the durable base + frontier for a room (member-visible via RLS). */
  private async readDurable(room: CollabRoomRef): Promise<CollabDurableState> {
    return this.rpc<CollabDurableState>("ws_collab_get_state", {
      p_workspace_id: room.workspaceId,
      p_project_id: room.projectId,
    });
  }

  async connect(room: CollabRoomRef, options: CollabConnectOptions): Promise<CollabJoinResult> {
    this.room = room;
    this.options = options;
    this.disposed = false;
    this.setPhase("connecting");

    const durable = await this.readDurable(room);
    this.seq = durable.checkpointSeq;
    this.openChannel(room);
    this.setPhase("connected");
    return {
      base: durable.base,
      seq: durable.checkpointSeq,
      ...(durable.state ? { state: durable.state } : {}),
    };
  }

  async seed(state: Uint8Array): Promise<CollabSeedResult> {
    if (!this.room) {
      throw makeWorkspaceError("PERMISSION_DENIED", "You can't join this room right now.");
    }
    return this.rpc<CollabSeedResult>("ws_collab_seed", {
      p_workspace_id: this.room.workspaceId,
      p_project_id: this.room.projectId,
      p_state: arrayToBase64(state),
    });
  }

  private openChannel(room: CollabRoomRef): void {
    if (this.channel) return;
    const client = this.client();
    const channelName = `collab:${room.workspaceId}:${room.projectId}`;
    const channel = client.channel(channelName);

    channel
      .on("broadcast", { event: "update" }, (payload) => {
        if (this.disposed) return;
        const data = payload as {
          payload?: { update?: string; seq?: number; actorClientId?: string };
        };
        const update = data.payload?.update;
        if (typeof update !== "string") return;
        const seq = typeof data.payload?.seq === "number" ? data.payload.seq : -1;
        if (seq >= 0 && seq <= this.seq) return; // dedupe
        this.messageCbs.forEach((cb) =>
          cb({
            update,
            seq,
            actorClientId: data.payload?.actorClientId,
          }),
        );
        if (seq >= 0) this.seq = Math.max(this.seq, seq);
      })
      .on("broadcast", { event: "rebase" }, async (payload) => {
        if (this.disposed) return;
        const data = payload as { payload?: { base?: unknown; seq?: number } };
        if (data.payload?.base) {
          this.messageCbs.forEach((cb) =>
            cb({
              update: "",
              seq: -1,
              snapshot: true,
              rebase: true,
              base: data.payload?.base,
            } as CollabTransportMessage),
          );
          if (typeof data.payload?.seq === "number") {
            this.seq = Math.max(this.seq, data.payload.seq);
          }
        }
      });

    channel.subscribe(async (status) => {
      if (this.disposed) return;
      const epoch = this.channelEpoch;
      if (status === "SUBSCRIBED") {
        try {
          // Came back online: flush queued local edits FIRST (idempotent),
          // then catch up on anything missed — mirrors the mock transport's
          // reconnect ordering (queue before room updates).
          await this.flushOfflineQueue();
          if (this.disposed) return;
          // Catch up on anything missed between the durable read and subscribe.
          const durable = await this.readDurable(this.room!);
          if (durable.seq > this.seq) {
            const missed = await this.rpc<Array<{ seq: number; data: string; actorClientId?: string }>>(
              "ws_collab_list_updates",
              {
                p_workspace_id: this.room!.workspaceId,
                p_project_id: this.room!.projectId,
                p_after_seq: this.seq,
              },
            );
            for (const item of missed) {
              if (item.seq <= this.seq) continue;
              this.messageCbs.forEach((cb) =>
                cb({ update: item.data, seq: item.seq, actorClientId: item.actorClientId }),
              );
              this.seq = Math.max(this.seq, item.seq);
            }
          }
        } catch {
          // Best-effort catch-up; the next broadcast/checkpoint converges.
        }
        // Only claim connected when no CLOSED/error superseded this
        // subscription while the catch-up was in flight.
        if (this.channelEpoch === epoch) {
          this.setPhase("connected");
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        this.channelEpoch += 1;
        this.setPhase("reconnecting");
        this.channel = null;
        // Rejoin the channel (deduped by the session's single transport).
        if (!this.disposed && this.room) {
          this.openChannel(this.room);
        }
      } else if (status === "CLOSED") {
        this.channelEpoch += 1;
        this.setPhase("offline");
      }
    });

    this.channel = channel;
  }

  async send(update: Uint8Array): Promise<void> {
    if (!this.room || !this.options?.canSend) {
      throw makeWorkspaceError("PERMISSION_DENIED", "You can't edit this project right now.");
    }
    if (update.byteLength > COLLAB_MAX_UPDATE_BYTES) {
      throw makeWorkspaceError("PAYLOAD_TOO_LARGE", "That change is too large to share.");
    }
    if (this.phase === "offline") {
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
    await this.sendNow(update);
  }

  /** Core send path: RPC append + channel broadcast. */
  private async sendNow(update: Uint8Array): Promise<void> {
    // Server validates editor/owner + room membership; actor is auth.uid().
    const seq = await this.rpc<number>("ws_collab_append_update", {
      p_workspace_id: this.room!.workspaceId,
      p_project_id: this.room!.projectId,
      p_update: arrayToBase64(update),
    });
    // Relay to the channel so other members see it live (server durable log
    // is the authoritative record; broadcasts are a delivery hint).
    if (this.channel) {
      await this.channel.send({
        type: "broadcast",
        event: "update",
        payload: {
          update: arrayToBase64(update),
          seq,
          actorClientId: this.options?.clientId,
        },
      });
    }
    this.seq = Math.max(this.seq, seq);
  }

  /** Replay queued offline updates (idempotent Yjs merges) after reconnect. */
  private async flushOfflineQueue(): Promise<void> {
    if (this.offlineQueue.length === 0) return;
    const queued = this.offlineQueue;
    this.offlineQueue = [];
    this.offlineQueueBytes = 0;
    for (const update of queued) {
      try {
        await this.sendNow(update);
      } catch (err) {
        // Authorization loss while flushing is NOT transient — surface it so
        // the session transitions to the honest read-only state (queued
        // uploads after permission loss must never silently retry forever;
        // the server rejects them regardless).
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
        // Transient failure — re-queue (bounded); the next flush/send retries.
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
      await this.rpc("ws_collab_checkpoint", {
        p_workspace_id: this.room.workspaceId,
        p_project_id: this.room.projectId,
        p_seq: seq,
        ...(state ? { p_state: arrayToBase64(state) } : {}),
      });
    } catch {
      // Best-effort — the room prunes at the next successful checkpoint.
    }
  }

  async lock(room: CollabRoomRef): Promise<void> {
    await this.rpc("ws_collab_lock", {
      p_workspace_id: room.workspaceId,
      p_project_id: room.projectId,
    });
  }

  async unlock(room: CollabRoomRef): Promise<void> {
    await this.rpc("ws_collab_unlock", {
      p_workspace_id: room.workspaceId,
      p_project_id: room.projectId,
    });
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
    this.authErrorCbs.forEach((cb) => cb());
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    if (this.channel) {
      const client = this.client();
      void client.removeChannel(this.channel).catch(() => undefined);
      this.channel = null;
    }
    this.room = null;
    this.options = null;
    this.messageCbs.clear();
    this.statusCbs.clear();
    this.authErrorCbs.clear();
    this.setPhase("disconnected");
  }

  testControls: CollabTestControls | undefined = undefined;
}
