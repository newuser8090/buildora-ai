// ---------------------------------------------------------------------------
// Phase P15 — Presence & Activity: SupabasePresenceProvider (production path)
//
// Uses Supabase Realtime Presence channels (presence:{workspaceId}) with
// channel authorization enforced by RLS on the workspace_presence table (added
// to the supabase_realtime publication; SELECT policy = workspace member).
//
// Presence payloads are a FIXED allow-listed shape — the client only ever
// tracks its own server-resolved mode (it cannot claim "editing" without
// actually holding the edit lease from the server).
//
// Lifecycle guarantees:
//   - one channel per workspace (cached per provider instance)
//   - removeChannel() on unsubscribe / leave — StrictMode-safe
//   - no duplicate subscriptions (callback set per channel)
//   - reads never bypass RPCs/RLS (getPresence resolves from the live channel
//     state only, which the client was authorized to join)
// ---------------------------------------------------------------------------

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/features/auth/supabase-client";
import { makeWorkspaceError } from "../errors";
import { logger } from "@/lib/logger";
import type { WorkspacePresence, WorkspacePresenceMode } from "../types";
import { emailToDisplayName } from "../utils/display-name";
import type { PresenceJoinInput, PresenceProvider } from "./presence-provider";

interface PresencePayload {
  sessionId: string;
  userId: string;
  mode: WorkspacePresenceMode;
  displayName: string;
  joinedAt: string;
  projectId: string | null;
}

interface ChannelEntry {
  channel: RealtimeChannel;
  callbacks: Set<(presence: WorkspacePresence[]) => void>;
  trackOnReady: (() => void) | null;
  /**
   * Project scope of the LAST join on this channel. Preserved across
   * heartbeats (Phase P18 F1) — a heartbeat must never re-track with
   * `projectId: null`, which would wipe the scope the user joined with and
   * drop them from project-scoped presence. Mirrors the mock backend, which
   * keeps the session's projectId until the next explicit join.
   */
  projectId: string | null;
  /**
   * First-seen join timestamp, preserved across heartbeats (mock parity:
   * the mock's session keeps `joinedAt` and only refreshes the TTL).
   */
  joinedAt: string;
}

export class SupabasePresenceProvider implements PresenceProvider {
  readonly kind = "supabase" as const;

  private entries = new Map<string, ChannelEntry>();

  private client() {
    const client = getSupabaseClient();
    if (!client) {
      throw makeWorkspaceError("NOT_CONFIGURED", "Workspaces aren't set up yet.");
    }
    return client;
  }

  private async currentUser(): Promise<{ id: string; email: string } | null> {
    const { data } = await this.client().auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    return { id: user.id, email: user.email ?? "" };
  }

  private entryFor(workspaceId: string): ChannelEntry {
    const existing = this.entries.get(workspaceId);
    if (existing) return existing;

    const client = this.client();
    const channel = client.channel(`presence:${workspaceId}`);
    const entry: ChannelEntry = {
      channel,
      callbacks: new Set(),
      trackOnReady: null,
      projectId: null,
      joinedAt: "",
    };
    this.entries.set(workspaceId, entry);

    channel
      .on("presence", { event: "sync" }, () => {
        const list = this.buildPresenceList(entry);
        entry.callbacks.forEach((cb) => cb(list));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && entry.trackOnReady) {
          entry.trackOnReady();
          entry.trackOnReady = null;
        }
      });
    return entry;
  }

  private track(workspaceId: string, payload: PresencePayload): void {
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    const send = () => {
      void entry.channel.track(payload).catch(() => {
        // Presence is best-effort — a failed track never breaks editing.
      });
    };
    if (entry.channel.state === "joined") {
      send();
    } else {
      entry.trackOnReady = send;
    }
  }

  private payloadFor(
    user: { id: string; email: string },
    input: PresenceJoinInput,
    entry: ChannelEntry,
  ): PresencePayload {
    return {
      sessionId: input.sessionId,
      userId: user.id,
      mode: input.mode,
      displayName: emailToDisplayName(user.email),
      joinedAt: entry.joinedAt,
      projectId: entry.projectId,
    };
  }

  private buildPresenceList(entry: ChannelEntry): WorkspacePresence[] {
    const state = entry.channel.presenceState<PresencePayload & { [key: string]: unknown }>();
    const list: WorkspacePresence[] = [];
    for (const presences of Object.values(state)) {
      for (const payload of presences) {
        list.push({
          workspaceId: entry.channel.topic.replace(/^presence:/, ""),
          projectId: payload.projectId ?? null,
          userId: payload.userId,
          sessionId: payload.sessionId,
          mode: payload.mode,
          joinedAt: payload.joinedAt,
          lastSeenAt: payload.joinedAt,
          displayName: payload.displayName,
        });
      }
    }
    return list;
  }

  async join(input: PresenceJoinInput): Promise<void> {
    const user = await this.currentUser();
    if (!user) return; // signed out — nothing to track
    // Realtime presence channels do NOT evaluate table RLS (RLS authorization
    // applies only to postgres_changes channels), so membership is enforced by
    // a SECURITY DEFINER RPC that must succeed before any track(). A
    // non-member's join raises PERMISSION_DENIED and the client never tracks.
    const client = this.client();
    const { error } = await client.rpc("ws_join_presence", {
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      // Phase P18 (F2) — a presence gate rejection (removed member / expired
      // session) is otherwise swallowed by the best-effort hook; log it so a
      // production auth incident is diagnosable. The code is embedded in the
      // message (survives production redaction) and is only ever a known
      // short RPC code — never the raw message (which may embed internals).
      const safeCode =
        typeof error.code === "string" && error.code.length <= 24 ? error.code : "P0001";
      logger.error("presence", `join gate rejected (${safeCode})`, {
        workspaceId: input.workspaceId,
      });
      throw makeWorkspaceError(
        "PERMISSION_DENIED",
        "You don't have access to that workspace.",
        error.code,
      );
    }
    // Remember the joined project scope on the channel entry (Phase P18 F1):
    // heartbeats re-track the same fixed payload and must preserve it — the
    // mock backend keeps projectId across heartbeats, and a re-track with
    // `projectId: null` would silently drop the user from project-scoped
    // presence after the first 10 s heartbeat.
    const entry = this.entryFor(input.workspaceId);
    entry.projectId = input.projectId ?? null;
    // First join on this entry records the timestamp; later joins preserve it
    // (mock parity: the mock keeps `joinedAt` for an existing session). The
    // hook recreates the entry on every scope change, so a project switch
    // still starts a fresh timestamp.
    if (!entry.joinedAt) {
      entry.joinedAt = new Date().toISOString();
    }
    this.track(input.workspaceId, this.payloadFor(user, input, entry));
  }

  async heartbeat(
    workspaceId: string,
    _sessionId: string,
    mode: WorkspacePresenceMode,
  ): Promise<void> {
    const user = await this.currentUser();
    if (!user) return;
    const entry = this.entries.get(workspaceId);
    if (!entry) return;
    // Re-track the fixed payload with the latest server-resolved mode
    // (e.g. a lost lease flips editing → viewing), PRESERVING the joined
    // project scope and first-seen timestamp (Phase P18 F1 — parity with the
    // mock, which never loses projectId/joinedAt on heartbeat). Defensive
    // fallback: an entry that never saw a successful join carries no
    // timestamp yet — default to now rather than tracking an empty one.
    this.track(workspaceId, {
      sessionId: _sessionId,
      userId: user.id,
      mode,
      displayName: emailToDisplayName(user.email),
      joinedAt: entry.joinedAt || new Date().toISOString(),
      projectId: entry.projectId,
    });
  }

  async leave(_sessionId: string): Promise<void> {
    const client = this.client();
    for (const [workspaceId, entry] of [...this.entries]) {
      try {
        await entry.channel.untrack();
      } catch {
        // Best-effort.
      }
      if (entry.callbacks.size === 0) {
        client.removeChannel(entry.channel);
        this.entries.delete(workspaceId);
      }
    }
  }

  async getPresence(
    workspaceId: string,
    projectId?: string | null,
  ): Promise<WorkspacePresence[]> {
    const entry = this.entries.get(workspaceId);
    if (!entry) return [];
    const all = this.buildPresenceList(entry);
    return projectId ? all.filter((p) => p.projectId === projectId) : all;
  }

  subscribe(
    workspaceId: string,
    onPresence: (presence: WorkspacePresence[]) => void,
  ): () => void {
    const entry = this.entryFor(workspaceId);
    entry.callbacks.add(onPresence);
    // Emit the current state immediately so the UI never waits for a sync.
    onPresence(this.buildPresenceList(entry));
    return () => {
      entry.callbacks.delete(onPresence);
      if (entry.callbacks.size === 0) {
        this.client().removeChannel(entry.channel);
        this.entries.delete(workspaceId);
      }
    };
  }
}
